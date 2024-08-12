// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"sync"
	"time"

	"github.com/wavetermdev/thenextwave/pkg/eventbus"
	"github.com/wavetermdev/thenextwave/pkg/filestore"
	"github.com/wavetermdev/thenextwave/pkg/shellexec"
	"github.com/wavetermdev/thenextwave/pkg/wavebase"
	"github.com/wavetermdev/thenextwave/pkg/waveobj"
	"github.com/wavetermdev/thenextwave/pkg/wshrpc"
	"github.com/wavetermdev/thenextwave/pkg/wshutil"
	"github.com/wavetermdev/thenextwave/pkg/wstore"
)

// set by main-server.go (for dependency inversion)
var WshServerFactoryFn func(inputCh chan []byte, outputCh chan []byte, initialCtx wshrpc.RpcContext) = nil

const (
	BlockController_Shell = "shell"
	BlockController_Cmd   = "cmd"
)

const (
	BlockFile_Term = "term" // used for main pty output
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

type BlockController struct {
	Lock            *sync.Mutex
	ControllerType  string
	TabId           string
	BlockId         string
	BlockDef        *wstore.BlockDef
	Status          string
	CreatedHtmlFile bool
	ShellProc       *shellexec.ShellProc
	ShellInputCh    chan *BlockInputUnion
	ShellProcStatus string
	StopCh          chan bool
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
		shouldTruncate = blockData.Meta.GetBool(wstore.MetaKey_CmdClearOnRestart, false)
	}
	if shouldTruncate {
		err := HandleTruncateBlockFile(bc.BlockId, BlockFile_Term)
		if err != nil {
			log.Printf("error truncating term blockfile: %v\n", err)
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
	err := filestore.WFS.AppendData(ctx, bc.BlockId, BlockFile_Term, buf.Bytes())
	if err != nil {
		log.Printf("error appending to blockfile (terminal reset): %v\n", err)
	}
}

// every byte is 4-bits of randomness
func randomHexString(numHexDigits int) (string, error) {
	numBytes := (numHexDigits + 1) / 2 // Calculate the number of bytes needed
	bytes := make([]byte, numBytes)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}

	hexStr := hex.EncodeToString(bytes)
	return hexStr[:numHexDigits], nil // Return the exact number of hex digits
}

func (bc *BlockController) DoRunShellCommand(rc *RunShellOpts, blockMeta waveobj.MetaMapType) error {
	// create a circular blockfile for the output
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	err := filestore.WFS.MakeFile(ctx, bc.BlockId, BlockFile_Term, nil, filestore.FileOptsType{MaxSize: DefaultTermMaxFileSize, Circular: true})
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
	var remoteDomainSocketName string
	remoteName := blockMeta.GetString(wstore.MetaKey_Connection, "")
	isRemote := remoteName != ""
	if isRemote {
		randStr, err := randomHexString(16) // 64-bits of randomness
		if err != nil {
			return fmt.Errorf("error generating random string: %w", err)
		}
		remoteDomainSocketName = fmt.Sprintf("/tmp/waveterm-%s.sock", randStr)
	}
	var cmdStr string
	cmdOpts := shellexec.CommandOptsType{
		Env: make(map[string]string),
	}
	if !blockMeta.GetBool(wstore.MetaKey_CmdNoWsh, false) {
		if isRemote {
			jwtStr, err := wshutil.MakeClientJWTToken(wshrpc.RpcContext{TabId: bc.TabId, BlockId: bc.BlockId}, remoteDomainSocketName)
			if err != nil {
				return fmt.Errorf("error making jwt token: %w", err)
			}
			cmdOpts.Env[wshutil.WaveJwtTokenVarName] = jwtStr
		} else {
			jwtStr, err := wshutil.MakeClientJWTToken(wshrpc.RpcContext{TabId: bc.TabId, BlockId: bc.BlockId}, wavebase.GetDomainSocketName())
			if err != nil {
				return fmt.Errorf("error making jwt token: %w", err)
			}
			cmdOpts.Env[wshutil.WaveJwtTokenVarName] = jwtStr
		}
	}
	if bc.ControllerType == BlockController_Shell {
		cmdOpts.Interactive = true
		cmdOpts.Login = true
		cmdOpts.Cwd = blockMeta.GetString(wstore.MetaKey_CmdCwd, "")
		if cmdOpts.Cwd != "" {
			cmdOpts.Cwd = wavebase.ExpandHomeDir(cmdOpts.Cwd)
		}
	} else if bc.ControllerType == BlockController_Cmd {
		cmdStr = blockMeta.GetString(wstore.MetaKey_Cmd, "")
		if cmdStr == "" {
			return fmt.Errorf("missing cmd in block meta")
		}
		cmdOpts.Cwd = blockMeta.GetString(wstore.MetaKey_CmdCwd, "")
		if cmdOpts.Cwd != "" {
			cmdOpts.Cwd = wavebase.ExpandHomeDir(cmdOpts.Cwd)
		}
		cmdOpts.Interactive = blockMeta.GetBool(wstore.MetaKey_CmdInteractive, false)
		cmdOpts.Login = blockMeta.GetBool(wstore.MetaKey_CmdLogin, false)
		cmdEnv := blockMeta.GetMap(wstore.MetaKey_CmdEnv)
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
	} else {
		return fmt.Errorf("unknown controller type %q", bc.ControllerType)
	}
	var shellProc *shellexec.ShellProc
	if remoteName != "" {
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
	messageCh := make(chan []byte, 32)
	ptyBuffer := wshutil.MakePtyBuffer(wshutil.WaveOSCPrefix, bc.ShellProc.Cmd, messageCh)
	outputCh := make(chan []byte, 32)
	WshServerFactoryFn(messageCh, outputCh, wshrpc.RpcContext{BlockId: bc.BlockId, TabId: bc.TabId})
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
				err := HandleAppendBlockFile(bc.BlockId, BlockFile_Term, buf[:nr])
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
				bc.ShellProc.Cmd.Write(ic.InputData)
			}
			if ic.TermSize != nil {
				log.Printf("SETTERMSIZE: %dx%d\n", ic.TermSize.Rows, ic.TermSize.Cols)
				err = bc.ShellProc.Cmd.SetSize(ic.TermSize.Rows, ic.TermSize.Cols)
				if err != nil {
					log.Printf("error setting pty size: %v\n", err)
				}
			}
		}
	}()
	go func() {
		// handles outputCh -> shellInputCh
		for msg := range outputCh {
			encodedMsg := wshutil.EncodeWaveOSCBytes(wshutil.WaveServerOSC, msg)
			shellInputCh <- &BlockInputUnion{InputData: encodedMsg}
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
		HandleAppendBlockFile(bc.BlockId, BlockFile_Term, []byte(termMsg))
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

func getTermSize(bdata *wstore.Block) shellexec.TermSize {
	if bdata.RuntimeOpts != nil {
		return bdata.RuntimeOpts.TermSize
	} else {
		return shellexec.TermSize{
			Rows: 25,
			Cols: 80,
		}
	}
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
	controllerName := bdata.Meta.GetString(wstore.MetaKey_Controller, "")
	if controllerName != BlockController_Shell && controllerName != BlockController_Cmd {
		log.Printf("unknown controller %q\n", controllerName)
		return
	}
	if getBoolFromMeta(blockMeta, wstore.MetaKey_CmdClearOnStart, false) {
		err := HandleTruncateBlockFile(bc.BlockId, BlockFile_Term)
		if err != nil {
			log.Printf("error truncating term blockfile: %v\n", err)
		}
	}
	runOnStart := getBoolFromMeta(blockMeta, wstore.MetaKey_CmdRunOnStart, true)
	if runOnStart {
		go func() {
			err := bc.DoRunShellCommand(&RunShellOpts{TermSize: getTermSize(bdata)}, bdata.Meta)
			if err != nil {
				log.Printf("error running shell: %v\n", err)
			}
		}()
	}
	<-bc.StopCh
}

func (bc *BlockController) SendInput(inputUnion *BlockInputUnion) error {
	if bc.ShellInputCh == nil {
		return fmt.Errorf("no shell input chan")
	}
	bc.ShellInputCh <- inputUnion
	return nil
}

func (bc *BlockController) RestartController() error {
	// TODO: if shell command is already running
	// we probably want to kill it off, wait, and then restart it
	bdata, err := wstore.DBMustGet[*wstore.Block](context.Background(), bc.BlockId)
	if err != nil {
		return fmt.Errorf("error getting block: %w", err)
	}
	err = bc.DoRunShellCommand(&RunShellOpts{TermSize: getTermSize(bdata)}, bdata.Meta)
	if err != nil {
		log.Printf("error running shell command: %v\n", err)
	}
	return nil
}

func StartBlockController(ctx context.Context, tabId string, blockId string) error {
	log.Printf("start blockcontroller %q\n", blockId)
	blockData, err := wstore.DBMustGet[*wstore.Block](ctx, blockId)
	if err != nil {
		return fmt.Errorf("error getting block: %w", err)
	}
	controllerName := blockData.Meta.GetString(wstore.MetaKey_Controller, "")
	if controllerName == "" {
		// nothing to start
		return nil
	}
	if controllerName != BlockController_Shell && controllerName != BlockController_Cmd {
		return fmt.Errorf("unknown controller %q", controllerName)
	}
	globalLock.Lock()
	defer globalLock.Unlock()
	if _, ok := blockControllerMap[blockId]; ok {
		// already running
		return nil
	}
	bc := &BlockController{
		Lock:            &sync.Mutex{},
		ControllerType:  controllerName,
		TabId:           tabId,
		BlockId:         blockId,
		Status:          Status_Init,
		ShellProcStatus: Status_Init,
		StopCh:          make(chan bool),
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
	close(bc.StopCh)
}

func GetBlockController(blockId string) *BlockController {
	globalLock.Lock()
	defer globalLock.Unlock()
	return blockControllerMap[blockId]
}
