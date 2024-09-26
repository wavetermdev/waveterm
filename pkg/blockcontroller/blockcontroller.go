// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"io/fs"
	"log"
	"sync"
	"time"

	"github.com/wavetermdev/waveterm/pkg/filestore"
	"github.com/wavetermdev/waveterm/pkg/remote"
	"github.com/wavetermdev/waveterm/pkg/remote/conncontroller"
	"github.com/wavetermdev/waveterm/pkg/shellexec"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
	"github.com/wavetermdev/waveterm/pkg/wstore"
)

const (
	BlockController_Shell = "shell"
	BlockController_Cmd   = "cmd"
)

const (
	BlockFile_Term = "term" // used for main pty output
	BlockFile_Html = "html" // used for alt html layout
)

const (
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
	InputData []byte            `json:"inputdata,omitempty"`
	SigName   string            `json:"signame,omitempty"`
	TermSize  *waveobj.TermSize `json:"termsize,omitempty"`
}

type BlockController struct {
	Lock            *sync.Mutex
	ControllerType  string
	TabId           string
	BlockId         string
	BlockDef        *waveobj.BlockDef
	CreatedHtmlFile bool
	ShellProc       *shellexec.ShellProc
	ShellInputCh    chan *BlockInputUnion
	ShellProcStatus string
}

type BlockControllerRuntimeStatus struct {
	BlockId           string `json:"blockid"`
	ShellProcStatus   string `json:"shellprocstatus,omitempty"`
	ShellProcConnName string `json:"shellprocconnname,omitempty"`
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
		rtn.ShellProcStatus = bc.ShellProcStatus
		if bc.ShellProc != nil {
			rtn.ShellProcConnName = bc.ShellProc.ConnName
		}
	})
	return &rtn
}

func (bc *BlockController) getShellProc() *shellexec.ShellProc {
	bc.Lock.Lock()
	defer bc.Lock.Unlock()
	return bc.ShellProc
}

type RunShellOpts struct {
	TermSize waveobj.TermSize `json:"termsize,omitempty"`
}

func (bc *BlockController) UpdateControllerAndSendUpdate(updateFn func() bool) {
	var sendUpdate bool
	bc.WithLock(func() {
		sendUpdate = updateFn()
	})
	if sendUpdate {
		rtStatus := bc.GetRuntimeStatus()
		log.Printf("sending blockcontroller update %#v\n", rtStatus)
		wps.Broker.Publish(wps.WaveEvent{
			Event: wps.Event_ControllerStatus,
			Scopes: []string{
				waveobj.MakeORef(waveobj.OType_Tab, bc.TabId).String(),
				waveobj.MakeORef(waveobj.OType_Block, bc.BlockId).String(),
			},
			Data: rtStatus,
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
	wps.Broker.Publish(wps.WaveEvent{
		Event:  wps.Event_BlockFile,
		Scopes: []string{waveobj.MakeORef(waveobj.OType_Block, blockId).String()},
		Data: &wps.WSFileEventData{
			ZoneId:   blockId,
			FileName: blockFile,
			FileOp:   wps.FileOp_Truncate,
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
	wps.Broker.Publish(wps.WaveEvent{
		Event: wps.Event_BlockFile,
		Scopes: []string{
			waveobj.MakeORef(waveobj.OType_Block, blockId).String(),
		},
		Data: &wps.WSFileEventData{
			ZoneId:   blockId,
			FileName: blockFile,
			FileOp:   wps.FileOp_Append,
			Data64:   base64.StdEncoding.EncodeToString(data),
		},
	})
	return nil
}

func (bc *BlockController) resetTerminalState() {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	var shouldTruncate bool
	blockData, getBlockDataErr := wstore.DBMustGet[*waveobj.Block](ctx, bc.BlockId)
	if getBlockDataErr == nil {
		shouldTruncate = blockData.Meta.GetBool(waveobj.MetaKey_CmdClearOnRestart, false)
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
	bcInitStatus := bc.GetRuntimeStatus()
	if bcInitStatus.ShellProcStatus == Status_Running {
		return nil
	}
	// TODO better sync here (don't let two starts happen at the same times)
	remoteName := blockMeta.GetString(waveobj.MetaKey_Connection, "")
	var cmdStr string
	cmdOpts := shellexec.CommandOptsType{
		Env: make(map[string]string),
	}
	if bc.ControllerType == BlockController_Shell {
		cmdOpts.Interactive = true
		cmdOpts.Login = true
		cmdOpts.Cwd = blockMeta.GetString(waveobj.MetaKey_CmdCwd, "")
		if cmdOpts.Cwd != "" {
			cwdPath, err := wavebase.ExpandHomeDir(cmdOpts.Cwd)
			if err != nil {
				return err
			}
			cmdOpts.Cwd = cwdPath
		}
	} else if bc.ControllerType == BlockController_Cmd {
		cmdStr = blockMeta.GetString(waveobj.MetaKey_Cmd, "")
		if cmdStr == "" {
			return fmt.Errorf("missing cmd in block meta")
		}
		cmdOpts.Cwd = blockMeta.GetString(waveobj.MetaKey_CmdCwd, "")
		if cmdOpts.Cwd != "" {
			cwdPath, err := wavebase.ExpandHomeDir(cmdOpts.Cwd)
			if err != nil {
				return err
			}
			cmdOpts.Cwd = cwdPath
		}
		cmdOpts.Interactive = blockMeta.GetBool(waveobj.MetaKey_CmdInteractive, false)
		cmdOpts.Login = blockMeta.GetBool(waveobj.MetaKey_CmdLogin, false)
		cmdEnv := blockMeta.GetMap(waveobj.MetaKey_CmdEnv)
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
		credentialCtx, cancelFunc := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancelFunc()

		opts, err := remote.ParseOpts(remoteName)
		if err != nil {
			return err
		}
		conn := conncontroller.GetConn(credentialCtx, opts, false)
		connStatus := conn.DeriveConnStatus()
		if connStatus.Status != conncontroller.Status_Connected {
			return fmt.Errorf("not connected, cannot start shellproc")
		}
		if !blockMeta.GetBool(waveobj.MetaKey_CmdNoWsh, false) {
			jwtStr, err := wshutil.MakeClientJWTToken(wshrpc.RpcContext{TabId: bc.TabId, BlockId: bc.BlockId, Conn: conn.Opts.String()}, conn.GetDomainSocketName())
			if err != nil {
				return fmt.Errorf("error making jwt token: %w", err)
			}
			cmdOpts.Env[wshutil.WaveJwtTokenVarName] = jwtStr
		}
		shellProc, err = shellexec.StartRemoteShellProc(rc.TermSize, cmdStr, cmdOpts, conn)
		if err != nil {
			return err
		}
	} else {
		// local terminal
		if !blockMeta.GetBool(waveobj.MetaKey_CmdNoWsh, false) {
			jwtStr, err := wshutil.MakeClientJWTToken(wshrpc.RpcContext{TabId: bc.TabId, BlockId: bc.BlockId}, wavebase.GetDomainSocketName())
			if err != nil {
				return fmt.Errorf("error making jwt token: %w", err)
			}
			cmdOpts.Env[wshutil.WaveJwtTokenVarName] = jwtStr
		}
		settings := wconfig.GetWatcher().GetFullConfig().Settings
		if settings.TermLocalShellPath != "" {
			cmdOpts.ShellPath = settings.TermLocalShellPath
		}
		if blockMeta.GetString(waveobj.MetaKey_TermLocalShellPath, "") != "" {
			cmdOpts.ShellPath = blockMeta.GetString(waveobj.MetaKey_TermLocalShellPath, "")
		}
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

	// make esc sequence wshclient wshProxy
	// we don't need to authenticate this wshProxy since it is coming direct
	wshProxy := wshutil.MakeRpcProxy()
	wshProxy.SetRpcContext(&wshrpc.RpcContext{TabId: bc.TabId, BlockId: bc.BlockId})
	wshutil.DefaultRouter.RegisterRoute(wshutil.MakeControllerRouteId(bc.BlockId), wshProxy)
	ptyBuffer := wshutil.MakePtyBuffer(wshutil.WaveOSCPrefix, bc.ShellProc.Cmd, wshProxy.FromRemoteCh)
	go func() {
		// handles regular output from the pty (goes to the blockfile and xterm)
		defer func() {
			log.Printf("[shellproc] pty-read loop done\n")
			bc.ShellProc.Close()
			bc.WithLock(func() {
				// so no other events are sent
				bc.ShellInputCh = nil
			})
			// to stop the inputCh loop
			time.Sleep(100 * time.Millisecond)
			close(shellInputCh) // don't use bc.ShellInputCh (it's nil)
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
		// use shellInputCh instead of bc.ShellInputCh (because we want to be attached to *this* ch.  bc.ShellInputCh can be updated)
		for ic := range shellInputCh {
			if len(ic.InputData) > 0 {
				bc.ShellProc.Cmd.Write(ic.InputData)
			}
			if ic.TermSize != nil {
				log.Printf("SETTERMSIZE: %dx%d\n", ic.TermSize.Rows, ic.TermSize.Cols)
				err = setTermSize(ctx, bc.BlockId, *ic.TermSize)
				if err != nil {
					log.Printf("error setting pty size: %v\n", err)
				}
				err = bc.ShellProc.Cmd.SetSize(ic.TermSize.Rows, ic.TermSize.Cols)
				if err != nil {
					log.Printf("error setting pty size: %v\n", err)
				}
			}
		}
	}()
	go func() {
		// handles outputCh -> shellInputCh
		for msg := range wshProxy.ToRemoteCh {
			encodedMsg := wshutil.EncodeWaveOSCBytes(wshutil.WaveServerOSC, msg)
			shellInputCh <- &BlockInputUnion{InputData: encodedMsg}
		}
	}()
	go func() {
		// wait for the shell to finish
		defer func() {
			wshutil.DefaultRouter.UnregisterRoute(wshutil.MakeControllerRouteId(bc.BlockId))
			bc.UpdateControllerAndSendUpdate(func() bool {
				bc.ShellProcStatus = Status_Done
				return true
			})
			log.Printf("[shellproc] shell process wait loop done\n")
		}()
		waitErr := shellProc.Cmd.Wait()
		exitCode := shellexec.ExitCodeFromWaitErr(waitErr)
		termMsg := fmt.Sprintf("\r\nprocess finished with exit code = %d\r\n\r\n", exitCode)
		//HandleAppendBlockFile(bc.BlockId, BlockFile_Term, []byte("\r\n"))
		HandleAppendBlockFile(bc.BlockId, BlockFile_Term, []byte(termMsg))
		shellProc.SetWaitErrorAndSignalDone(waitErr)
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

func getTermSize(bdata *waveobj.Block) waveobj.TermSize {
	if bdata.RuntimeOpts != nil {
		return bdata.RuntimeOpts.TermSize
	} else {
		return waveobj.TermSize{
			Rows: 25,
			Cols: 80,
		}
	}
}

func setTermSize(ctx context.Context, blockId string, termSize waveobj.TermSize) error {
	ctx = waveobj.ContextWithUpdates(ctx)
	bdata, err := wstore.DBMustGet[*waveobj.Block](context.Background(), blockId)
	if err != nil {
		return fmt.Errorf("error getting block data: %v", err)
	}
	if bdata.RuntimeOpts == nil {
		return fmt.Errorf("error from nil RuntimeOpts: %v", err)
	}
	bdata.RuntimeOpts.TermSize = termSize
	updates := waveobj.ContextGetUpdatesRtn(ctx)
	wps.Broker.SendUpdateEvents(updates)
	return nil
}

func (bc *BlockController) run(bdata *waveobj.Block, blockMeta map[string]any, rtOpts *waveobj.RuntimeOpts) {
	controllerName := bdata.Meta.GetString(waveobj.MetaKey_Controller, "")
	if controllerName != BlockController_Shell && controllerName != BlockController_Cmd {
		log.Printf("unknown controller %q\n", controllerName)
		return
	}
	if getBoolFromMeta(blockMeta, waveobj.MetaKey_CmdClearOnStart, false) {
		err := HandleTruncateBlockFile(bc.BlockId, BlockFile_Term)
		if err != nil {
			log.Printf("error truncating term blockfile: %v\n", err)
		}
	}
	runOnStart := getBoolFromMeta(blockMeta, waveobj.MetaKey_CmdRunOnStart, true)
	if runOnStart {
		go func() {
			var termSize waveobj.TermSize
			if rtOpts != nil {
				termSize = rtOpts.TermSize
			} else {
				termSize = getTermSize(bdata)
			}
			err := bc.DoRunShellCommand(&RunShellOpts{TermSize: termSize}, bdata.Meta)
			if err != nil {
				log.Printf("error running shell: %v\n", err)
			}
		}()
	}
}

func (bc *BlockController) SendInput(inputUnion *BlockInputUnion) error {
	var shellInputCh chan *BlockInputUnion
	bc.WithLock(func() {
		shellInputCh = bc.ShellInputCh
	})
	if shellInputCh == nil {
		return fmt.Errorf("no shell input chan")
	}
	shellInputCh <- inputUnion
	return nil
}

func CheckConnStatus(blockId string) error {
	bdata, err := wstore.DBMustGet[*waveobj.Block](context.Background(), blockId)
	if err != nil {
		return fmt.Errorf("error getting block: %w", err)
	}
	connName := bdata.Meta.GetString(waveobj.MetaKey_Connection, "")
	if connName == "" {
		return nil
	}
	opts, err := remote.ParseOpts(connName)
	if err != nil {
		return fmt.Errorf("error parsing connection name: %w", err)
	}
	conn := conncontroller.GetConn(context.Background(), opts, false)
	connStatus := conn.DeriveConnStatus()
	if connStatus.Status != conncontroller.Status_Connected {
		return fmt.Errorf("not connected: %s", connStatus.Status)
	}
	return nil
}

func (bc *BlockController) StopShellProc(shouldWait bool) {
	bc.Lock.Lock()
	defer bc.Lock.Unlock()
	if bc.ShellProc == nil || bc.ShellProcStatus == Status_Done {
		return
	}
	bc.ShellProc.Close()
	if shouldWait {
		doneCh := bc.ShellProc.DoneCh
		<-doneCh
	}
}

func getOrCreateBlockController(tabId string, blockId string, controllerName string) *BlockController {
	var createdController bool
	var bc *BlockController
	defer func() {
		if !createdController || bc == nil {
			return
		}
		bc.UpdateControllerAndSendUpdate(func() bool {
			return true
		})
	}()
	globalLock.Lock()
	defer globalLock.Unlock()
	bc = blockControllerMap[blockId]
	if bc == nil {
		bc = &BlockController{
			Lock:            &sync.Mutex{},
			ControllerType:  controllerName,
			TabId:           tabId,
			BlockId:         blockId,
			ShellProcStatus: Status_Done,
		}
		blockControllerMap[blockId] = bc
		createdController = true
	}
	return bc
}

func ResyncController(ctx context.Context, tabId string, blockId string, rtOpts *waveobj.RuntimeOpts) error {
	if tabId == "" || blockId == "" {
		return fmt.Errorf("invalid tabId or blockId passed to ResyncController")
	}
	blockData, err := wstore.DBMustGet[*waveobj.Block](ctx, blockId)
	if err != nil {
		return fmt.Errorf("error getting block: %w", err)
	}
	connName := blockData.Meta.GetString(waveobj.MetaKey_Connection, "")
	controllerName := blockData.Meta.GetString(waveobj.MetaKey_Controller, "")
	curBc := GetBlockController(blockId)
	if controllerName == "" {
		if curBc != nil {
			StopBlockController(blockId)
		}
		return nil
	}
	// check if conn is different, if so, stop the current controller
	if curBc != nil {
		bcStatus := curBc.GetRuntimeStatus()
		if bcStatus.ShellProcStatus == Status_Running && bcStatus.ShellProcConnName != connName {
			StopBlockController(blockId)
		}
	}
	// now if there is a conn, ensure it is connected
	if connName != "" {
		err = CheckConnStatus(blockId)
		if err != nil {
			return fmt.Errorf("cannot start shellproc: %w", err)
		}
	}
	if curBc == nil {
		return startBlockController(ctx, tabId, blockId, rtOpts)
	}
	bcStatus := curBc.GetRuntimeStatus()
	if bcStatus.ShellProcStatus != Status_Running {
		return startBlockController(ctx, tabId, blockId, rtOpts)
	}
	return nil
}

func startBlockController(ctx context.Context, tabId string, blockId string, rtOpts *waveobj.RuntimeOpts) error {
	blockData, err := wstore.DBMustGet[*waveobj.Block](ctx, blockId)
	if err != nil {
		return fmt.Errorf("error getting block: %w", err)
	}
	controllerName := blockData.Meta.GetString(waveobj.MetaKey_Controller, "")
	if controllerName == "" {
		// nothing to start
		return nil
	}
	if controllerName != BlockController_Shell && controllerName != BlockController_Cmd {
		return fmt.Errorf("unknown controller %q", controllerName)
	}
	connName := blockData.Meta.GetString(waveobj.MetaKey_Connection, "")
	log.Printf("start blockcontroller %s %q (%q)\n", blockId, controllerName, connName)
	err = CheckConnStatus(blockId)
	if err != nil {
		return fmt.Errorf("cannot start shellproc: %w", err)
	}
	bc := getOrCreateBlockController(tabId, blockId, controllerName)
	bcStatus := bc.GetRuntimeStatus()
	if bcStatus.ShellProcStatus == Status_Done {
		go bc.run(blockData, blockData.Meta, rtOpts)
	}
	return nil
}

func StopBlockController(blockId string) {
	bc := GetBlockController(blockId)
	if bc == nil {
		return
	}
	if bc.getShellProc() != nil {
		bc.ShellProc.Close()
		<-bc.ShellProc.DoneCh
		bc.UpdateControllerAndSendUpdate(func() bool {
			bc.ShellProcStatus = Status_Done
			return true
		})
	}

}

func getControllerList() []*BlockController {
	globalLock.Lock()
	defer globalLock.Unlock()
	var rtn []*BlockController
	for _, bc := range blockControllerMap {
		rtn = append(rtn, bc)
	}
	return rtn
}

func StopAllBlockControllers() {
	clist := getControllerList()
	for _, bc := range clist {
		if bc.ShellProcStatus == Status_Running {
			go StopBlockController(bc.BlockId)
		}
	}
}

func GetBlockController(blockId string) *BlockController {
	globalLock.Lock()
	defer globalLock.Unlock()
	return blockControllerMap[blockId]
}
