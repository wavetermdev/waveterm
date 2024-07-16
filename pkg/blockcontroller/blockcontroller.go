// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/creack/pty"
	"github.com/wavetermdev/thenextwave/pkg/eventbus"
	"github.com/wavetermdev/thenextwave/pkg/filestore"
	"github.com/wavetermdev/thenextwave/pkg/shellexec"
	"github.com/wavetermdev/thenextwave/pkg/wavebase"
	"github.com/wavetermdev/thenextwave/pkg/waveobj"
	"github.com/wavetermdev/thenextwave/pkg/wshutil"
	"github.com/wavetermdev/thenextwave/pkg/wstore"
)

const (
	BlockController_Shell = "shell"
	BlockController_Cmd   = "cmd"
)

const (
	BlockFile_Main = "main" // used for main pty output
	BlockFile_Html = "html" // used for alt html layout
)

const (
	Status_Init    = "init"
	Status_Running = "running"
	Status_Done    = "done"
)

const (
	DefaultTermMaxFileSize = 256 * 1024
	DefaultHtmlMaxFileSize = 256 * 1024
)

const DefaultTimeout = 2 * time.Second

var globalLock = &sync.Mutex{}
var blockControllerMap = make(map[string]*BlockController)

type BlockInputUnion struct {
	InputData []byte              `json:"inputdata,omitempty"`
	SigName   string              `json:"signame,omitempty"`
	TermSize  *shellexec.TermSize `json:"termsize,omitempty"`
}

type RunCmdFnType = func(ctx context.Context, cmd wshutil.BlockCommand, cmdCtx wshutil.CmdContextType) (wshutil.ResponseDataType, error)

type BlockController struct {
	Lock            *sync.Mutex
	ControllerType  string
	TabId           string
	BlockId         string
	BlockDef        *wstore.BlockDef
	InputCh         chan wshutil.BlockCommand
	Status          string
	CreatedHtmlFile bool
	ShellProc       *shellexec.ShellProc
	ShellInputCh    chan *BlockInputUnion
	ShellProcStatus string
	RunCmdFn        RunCmdFnType
}

type BlockControllerRuntimeStatus struct {
	BlockId         string `json:"blockid"`
	Status          string `json:"status"`
	ShellProcStatus string `json:"shellprocstatus,omitempty"`
}

func (bc *BlockController) WithLock(f func()) {
	bc.Lock.Lock()
	defer bc.Lock.Unlock()
	f()
}

func (bc *BlockController) GetRuntimeStatus() *BlockControllerRuntimeStatus {
	var rtn BlockControllerRuntimeStatus
	bc.WithLock(func() {
		rtn.BlockId = bc.BlockId
		rtn.Status = bc.Status
		rtn.ShellProcStatus = bc.ShellProcStatus
	})
	return &rtn
}

func jsonDeepCopy(val map[string]any) (map[string]any, error) {
	barr, err := json.Marshal(val)
	if err != nil {
		return nil, err
	}
	var rtn map[string]any
	err = json.Unmarshal(barr, &rtn)
	if err != nil {
		return nil, err
	}
	return rtn, nil
}

func (bc *BlockController) getShellProc() *shellexec.ShellProc {
	bc.Lock.Lock()
	defer bc.Lock.Unlock()
	return bc.ShellProc
}

type RunShellOpts struct {
	TermSize shellexec.TermSize `json:"termsize,omitempty"`
}

func (bc *BlockController) UpdateControllerAndSendUpdate(updateFn func() bool) {
	var sendUpdate bool
	bc.WithLock(func() {
		sendUpdate = updateFn()
	})
	if sendUpdate {
		log.Printf("sending blockcontroller update %#v\n", bc.GetRuntimeStatus())
		go eventbus.SendEvent(eventbus.WSEventType{
			EventType: eventbus.WSEvent_BlockControllerStatus,
			ORef:      waveobj.MakeORef(wstore.OType_Block, bc.BlockId).String(),
			Data:      bc.GetRuntimeStatus(),
		})
	}
}

func HandleTruncateBlockFile(blockId string, blockFile string) error {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	err := filestore.WFS.WriteFile(ctx, blockId, blockFile, nil)
	if err == fs.ErrNotExist {
		return nil
	}
	if err != nil {
		return fmt.Errorf("error truncating blockfile: %w", err)
	}
	eventbus.SendEvent(eventbus.WSEventType{
		EventType: eventbus.WSEvent_BlockFile,
		ORef:      waveobj.MakeORef(wstore.OType_Block, blockId).String(),
		Data: &eventbus.WSFileEventData{
			ZoneId:   blockId,
			FileName: blockFile,
			FileOp:   eventbus.FileOp_Truncate,
		},
	})
	return nil

}

func HandleAppendBlockFile(blockId string, blockFile string, data []byte) error {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	err := filestore.WFS.AppendData(ctx, blockId, blockFile, data)
	if err != nil {
		return fmt.Errorf("error appending to blockfile: %w", err)
	}
	eventbus.SendEvent(eventbus.WSEventType{
		EventType: eventbus.WSEvent_BlockFile,
		ORef:      waveobj.MakeORef(wstore.OType_Block, blockId).String(),
		Data: &eventbus.WSFileEventData{
			ZoneId:   blockId,
			FileName: blockFile,
			FileOp:   eventbus.FileOp_Append,
			Data64:   base64.StdEncoding.EncodeToString(data),
		},
	})
	return nil
}

func (bc *BlockController) resetTerminalState() {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	var shouldTruncate bool
	blockData, getBlockDataErr := wstore.DBMustGet[*wstore.Block](ctx, bc.BlockId)
	if getBlockDataErr == nil {
		shouldTruncate = getBoolFromMeta(blockData.Meta, wstore.MetaKey_CmdClearOnRestart, false)
	}
	if shouldTruncate {
		err := HandleTruncateBlockFile(bc.BlockId, BlockFile_Main)
		if err != nil {
			log.Printf("error truncating main blockfile: %v\n", err)
		}
		return
	}
	// controller type = "shell"
	var buf bytes.Buffer
	// buf.WriteString("\x1b[?1049l") // disable alternative buffer
	buf.WriteString("\x1b[0m")     // reset attributes
	buf.WriteString("\x1b[?25h")   // show cursor
	buf.WriteString("\x1b[?1000l") // disable mouse tracking
	buf.WriteString("\r\n\r\n(restored terminal state)\r\n\r\n")
	err := filestore.WFS.AppendData(ctx, bc.BlockId, "main", buf.Bytes())
	if err != nil {
		log.Printf("error appending to blockfile (terminal reset): %v\n", err)
	}
}

func (bc *BlockController) waveOSCMessageHandler(ctx context.Context, cmd wshutil.BlockCommand, respFn wshutil.ResponseFnType) (wshutil.ResponseDataType, error) {
	if strings.HasPrefix(cmd.GetCommand(), "controller:") {
		bc.InputCh <- cmd
		return nil, nil
	}
	return bc.RunCmdFn(ctx, cmd, wshutil.CmdContextType{BlockId: bc.BlockId, TabId: bc.TabId})
}

func (bc *BlockController) DoRunShellCommand(rc *RunShellOpts, blockMeta map[string]any) error {
	// create a circular blockfile for the output
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	err := filestore.WFS.MakeFile(ctx, bc.BlockId, "main", nil, filestore.FileOptsType{MaxSize: DefaultTermMaxFileSize, Circular: true})
	if err != nil && err != fs.ErrExist {
		err = fs.ErrExist
		return fmt.Errorf("error creating blockfile: %w", err)
	}
	if err == fs.ErrExist {
		// reset the terminal state
		bc.resetTerminalState()
	}
	err = nil
	if bc.getShellProc() != nil {
		return nil
	}
	var shellProcErr error
	bc.WithLock(func() {
		if bc.ShellProc != nil {
			shellProcErr = fmt.Errorf("shell process already running")
			return
		}
	})
	if shellProcErr != nil {
		return shellProcErr
	}
	var cmdStr string
	var cmdOpts shellexec.CommandOptsType
	if bc.ControllerType == BlockController_Shell {
		cmdOpts = shellexec.CommandOptsType{Interactive: true, Login: true}
	} else if bc.ControllerType == BlockController_Cmd {
		if _, ok := blockMeta["cmd"].(string); ok {
			cmdStr = blockMeta["cmd"].(string)
		} else {
			return fmt.Errorf("missing cmd in block meta")
		}
		if _, ok := blockMeta["cwd"].(string); ok {
			cmdOpts.Cwd = blockMeta["cwd"].(string)
			if cmdOpts.Cwd != "" {
				cmdOpts.Cwd = wavebase.ExpandHomeDir(cmdOpts.Cwd)
			}
		}
		if _, ok := blockMeta["cmd:interactive"]; ok {
			if blockMeta["cmd:interactive"].(bool) {
				cmdOpts.Interactive = true
			}
		}
		if _, ok := blockMeta["cmd:login"]; ok {
			if blockMeta["cmd:login"].(bool) {
				cmdOpts.Login = true
			}
		}
		if _, ok := blockMeta["cmd:env"].(map[string]any); ok {
			cmdEnv := blockMeta["cmd:env"].(map[string]any)
			cmdOpts.Env = make(map[string]string)
			for k, v := range cmdEnv {
				if v == nil {
					continue
				}
				if _, ok := v.(string); ok {
					cmdOpts.Env[k] = v.(string)
				}
				if _, ok := v.(float64); ok {
					cmdOpts.Env[k] = fmt.Sprintf("%v", v)
				}
			}
		}
	} else {
		return fmt.Errorf("unknown controller type %q", bc.ControllerType)
	}
	// pty buffer equivalent for ssh? i think if i have the ecmd or session i can manage it with output
	// pty write needs stdin, so if i provide that, i might be able to write that way
	// need a way to handle setsize???
	var shellProc *shellexec.ShellProc
	if remoteName, ok := blockMeta["connection"].(string); ok && remoteName != "" {
		shellProc, err = shellexec.StartRemoteShellProc(rc.TermSize, cmdStr, cmdOpts, remoteName)
		if err != nil {
			return err
		}
	} else {
		shellProc, err = shellexec.StartShellProc(rc.TermSize, cmdStr, cmdOpts)
		if err != nil {
			return err
		}
	}
	bc.UpdateControllerAndSendUpdate(func() bool {
		bc.ShellProc = shellProc
		bc.ShellProcStatus = Status_Running
		return true
	})
	shellInputCh := make(chan *BlockInputUnion, 32)
	bc.ShellInputCh = shellInputCh
	messageCh := make(chan wshutil.RpcMessage, 32)
	ptyBuffer := wshutil.MakePtyBuffer(wshutil.WaveOSCPrefix, bc.ShellProc.Pty, messageCh)
	_, outputCh := wshutil.MakeWshRpc(wshutil.WaveServerOSC, messageCh, bc.waveOSCMessageHandler)
	go func() {
		// handles regular output from the pty (goes to the blockfile and xterm)
		defer func() {
			log.Printf("[shellproc] pty-read loop done\n")

			// needs synchronization
			bc.ShellProc.Close()
			close(bc.ShellInputCh)
			bc.ShellProc = nil
			bc.ShellInputCh = nil
		}()
		buf := make([]byte, 4096)
		for {
			nr, err := ptyBuffer.Read(buf)
			if nr > 0 {
				err := HandleAppendBlockFile(bc.BlockId, BlockFile_Main, buf[:nr])
				if err != nil {
					log.Printf("error appending to blockfile: %v\n", err)
				}
			}
			if err == io.EOF {
				break
			}
			if err != nil {
				log.Printf("error reading from shell: %v\n", err)
				break
			}
		}
	}()
	go func() {
		defer func() {
			log.Printf("[shellproc] shellInputCh loop done\n")
		}()
		// handles input from the shellInputCh, sent to pty
		for ic := range shellInputCh {
			if len(ic.InputData) > 0 {
				bc.ShellProc.Pty.Write(ic.InputData)
			}
			if ic.TermSize != nil {
				log.Printf("SETTERMSIZE: %dx%d\n", ic.TermSize.Rows, ic.TermSize.Cols)
				err := pty.Setsize(bc.ShellProc.Pty, &pty.Winsize{Rows: uint16(ic.TermSize.Rows), Cols: uint16(ic.TermSize.Cols)})
				if err != nil {
					log.Printf("error setting term size: %v\n", err)
				}
			}
			// TODO signals
		}
	}()
	go func() {
		// handles outputCh -> shellInputCh
		for out := range outputCh {
			shellInputCh <- &BlockInputUnion{InputData: out}
		}
	}()
	go func() {
		// wait for the shell to finish
		defer func() {
			bc.UpdateControllerAndSendUpdate(func() bool {
				bc.ShellProcStatus = Status_Done
				return true
			})
			log.Printf("[shellproc] shell process wait loop done\n")
		}()
		waitErr := shellProc.Cmd.Wait()
		shellProc.SetWaitErrorAndSignalDone(waitErr)
		exitCode := shellexec.ExitCodeFromWaitErr(waitErr)
		termMsg := fmt.Sprintf("\r\nprocess finished with exit code = %d\r\n\r\n", exitCode)
		HandleAppendBlockFile(bc.BlockId, BlockFile_Main, []byte(termMsg))
	}()
	return nil
}

func getBoolFromMeta(meta map[string]any, key string, def bool) bool {
	ival, found := meta[key]
	if !found || ival == nil {
		return def
	}
	if val, ok := ival.(bool); ok {
		return val
	}
	return def
}

func (bc *BlockController) run(bdata *wstore.Block, blockMeta map[string]any) {
	defer func() {
		bc.UpdateControllerAndSendUpdate(func() bool {
			if bc.Status == Status_Running {
				bc.Status = Status_Done
				return true
			}
			return false
		})
		globalLock.Lock()
		defer globalLock.Unlock()
		delete(blockControllerMap, bc.BlockId)
	}()
	bc.UpdateControllerAndSendUpdate(func() bool {
		bc.Status = Status_Running
		return true
	})
	if bdata.Controller != BlockController_Shell && bdata.Controller != BlockController_Cmd {
		log.Printf("unknown controller %q\n", bdata.Controller)
		return
	}
	if getBoolFromMeta(blockMeta, wstore.MetaKey_CmdClearOnStart, false) {
		err := HandleTruncateBlockFile(bc.BlockId, BlockFile_Main)
		if err != nil {
			log.Printf("error truncating main blockfile: %v\n", err)
		}
	}
	runOnStart := getBoolFromMeta(blockMeta, wstore.MetaKey_CmdRunOnStart, true)
	if runOnStart {
		go func() {
			err := bc.DoRunShellCommand(&RunShellOpts{TermSize: bdata.RuntimeOpts.TermSize}, bdata.Meta)
			if err != nil {
				log.Printf("error running shell: %v\n", err)
			}
		}()
	}

	for genCmd := range bc.InputCh {
		switch cmd := genCmd.(type) {
		case *wshutil.BlockInputCommand:
			if bc.ShellInputCh == nil {
				continue
			}
			inputUnion := &BlockInputUnion{
				SigName:  cmd.SigName,
				TermSize: cmd.TermSize,
			}
			if len(cmd.InputData64) > 0 {
				inputBuf := make([]byte, base64.StdEncoding.DecodedLen(len(cmd.InputData64)))
				nw, err := base64.StdEncoding.Decode(inputBuf, []byte(cmd.InputData64))
				if err != nil {
					log.Printf("error decoding input data: %v\n", err)
					continue
				}
				inputUnion.InputData = inputBuf[:nw]
			}
			bc.ShellInputCh <- inputUnion
		case *wshutil.BlockRestartCommand:
			// TODO: if shell command is already running
			// we probably want to kill it off, wait, and then restart it
			err := bc.DoRunShellCommand(&RunShellOpts{TermSize: bdata.RuntimeOpts.TermSize}, bdata.Meta)
			if err != nil {
				log.Printf("error running shell command: %v\n", err)
			}

		default:
			log.Printf("unknown command type %T\n", cmd)
		}
	}
}

func StartBlockController(ctx context.Context, tabId string, blockId string, runCmdFn RunCmdFnType) error {
	blockData, err := wstore.DBMustGet[*wstore.Block](ctx, blockId)
	if err != nil {
		return fmt.Errorf("error getting block: %w", err)
	}
	if blockData.Controller == "" {
		// nothing to start
		return nil
	}
	if blockData.Controller != BlockController_Shell && blockData.Controller != BlockController_Cmd {
		return fmt.Errorf("unknown controller %q", blockData.Controller)
	}
	globalLock.Lock()
	defer globalLock.Unlock()
	if _, ok := blockControllerMap[blockId]; ok {
		// already running
		return nil
	}
	bc := &BlockController{
		Lock:            &sync.Mutex{},
		ControllerType:  blockData.Controller,
		TabId:           tabId,
		BlockId:         blockId,
		Status:          Status_Init,
		InputCh:         make(chan wshutil.BlockCommand),
		RunCmdFn:        runCmdFn,
		ShellProcStatus: Status_Init,
	}
	blockControllerMap[blockId] = bc
	go bc.run(blockData, blockData.Meta)
	return nil
}

func StopBlockController(blockId string) {
	bc := GetBlockController(blockId)
	if bc == nil {
		return
	}
	if bc.getShellProc() != nil {
		bc.ShellProc.Close()
	}
	close(bc.InputCh)
}

func GetBlockController(blockId string) *BlockController {
	globalLock.Lock()
	defer globalLock.Unlock()
	return blockControllerMap[blockId]
}
