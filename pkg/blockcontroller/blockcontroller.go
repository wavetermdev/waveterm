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
	"log"
	"strings"
	"sync"
	"time"

	"github.com/creack/pty"
	"github.com/wavetermdev/thenextwave/pkg/eventbus"
	"github.com/wavetermdev/thenextwave/pkg/filestore"
	"github.com/wavetermdev/thenextwave/pkg/shellexec"
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
	BlockId         string
	BlockDef        *wstore.BlockDef
	InputCh         chan wshutil.BlockCommand
	Status          string
	CreatedHtmlFile bool
	ShellProc       *shellexec.ShellProc
	ShellInputCh    chan *BlockInputUnion
}

func (bc *BlockController) WithLock(f func()) {
	bc.Lock.Lock()
	defer bc.Lock.Unlock()
	f()
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

func (bc *BlockController) setShellProc(shellProc *shellexec.ShellProc) error {
	bc.Lock.Lock()
	defer bc.Lock.Unlock()
	if bc.ShellProc != nil {
		return fmt.Errorf("shell process already running")
	}
	bc.ShellProc = shellProc
	return nil
}

func (bc *BlockController) getShellProc() *shellexec.ShellProc {
	bc.Lock.Lock()
	defer bc.Lock.Unlock()
	return bc.ShellProc
}

type RunShellOpts struct {
	TermSize shellexec.TermSize `json:"termsize,omitempty"`
}

func (bc *BlockController) Close() {
	if bc.getShellProc() != nil {
		bc.ShellProc.Close()
	}
}

const DefaultTermMaxFileSize = 256 * 1024
const DefaultHtmlMaxFileSize = 256 * 1024

func handleAppendBlockFile(blockId string, blockFile string, data []byte) error {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	err := filestore.WFS.AppendData(ctx, blockId, blockFile, data)
	if err != nil {
		return fmt.Errorf("error appending to blockfile: %w", err)
	}
	eventbus.SendEvent(eventbus.WSEventType{
		EventType: "blockfile",
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

func handleAppendIJsonFile(blockId string, blockFile string, cmd map[string]any, tryCreate bool) error {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	if blockFile == BlockFile_Html && tryCreate {
		err := filestore.WFS.MakeFile(ctx, blockId, blockFile, nil, filestore.FileOptsType{MaxSize: DefaultHtmlMaxFileSize, IJson: true})
		if err != nil && err != filestore.ErrAlreadyExists {
			return fmt.Errorf("error creating blockfile[html]: %w", err)
		}
	}
	err := filestore.WFS.AppendIJson(ctx, blockId, blockFile, cmd)
	if err != nil {
		return fmt.Errorf("error appending to blockfile(ijson): %w", err)
	}
	eventbus.SendEvent(eventbus.WSEventType{
		EventType: "blockfile",
		ORef:      waveobj.MakeORef(wstore.OType_Block, blockId).String(),
		Data: &eventbus.WSFileEventData{
			ZoneId:   blockId,
			FileName: blockFile,
			FileOp:   eventbus.FileOp_Append,
			Data64:   base64.StdEncoding.EncodeToString([]byte("{}")),
		},
	})
	return nil
}

func (bc *BlockController) resetTerminalState() {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
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

func resolveSimpleId(ctx context.Context, simpleId string) (*waveobj.ORef, error) {
	if strings.Contains(simpleId, ":") {
		rtn, err := waveobj.ParseORef(simpleId)
		if err != nil {
			return nil, fmt.Errorf("error parsing simple id: %w", err)
		}
		return &rtn, nil
	}
	return wstore.DBResolveEasyOID(ctx, simpleId)
}

func staticHandleGetMeta(ctx context.Context, cmd *wshutil.BlockGetMetaCommand) (map[string]any, error) {
	oref, err := waveobj.ParseORef(cmd.ORef)
	if err != nil {
		return nil, fmt.Errorf("error parsing oref: %w", err)
	}
	obj, err := wstore.DBGetORef(ctx, oref)
	if err != nil {
		return nil, fmt.Errorf("error getting object: %w", err)
	}
	if obj == nil {
		return nil, fmt.Errorf("object not found: %s", oref)
	}
	return waveobj.GetMeta(obj), nil
}

func staticHandleSetMeta(ctx context.Context, cmd *wshutil.BlockSetMetaCommand, curBlockId string) (map[string]any, error) {
	var oref *waveobj.ORef
	if cmd.ORef != "" {
		orefVal, err := waveobj.ParseORef(cmd.ORef)
		if err != nil {
			return nil, fmt.Errorf("error parsing oref: %w", err)
		}
		oref = &orefVal
	} else {
		orefVal := waveobj.MakeORef(wstore.OType_Block, curBlockId)
		oref = &orefVal
	}
	log.Printf("SETMETA: %s | %v\n", oref, cmd.Meta)
	obj, err := wstore.DBGetORef(ctx, *oref)
	if err != nil {
		return nil, fmt.Errorf("error getting object: %w", err)
	}
	if obj == nil {
		return nil, nil
	}
	meta := waveobj.GetMeta(obj)
	if meta == nil {
		meta = make(map[string]any)
	}
	for k, v := range cmd.Meta {
		if v == nil {
			delete(meta, k)
			continue
		}
		meta[k] = v
	}
	waveobj.SetMeta(obj, meta)
	err = wstore.DBUpdate(ctx, obj)
	if err != nil {
		return nil, fmt.Errorf("error updating block: %w", err)
	}
	// send a waveobj:update event
	updatedBlock, err := wstore.DBGetORef(ctx, *oref)
	if err != nil {
		return nil, fmt.Errorf("error getting object (2): %w", err)
	}
	eventbus.SendEvent(eventbus.WSEventType{
		EventType: "waveobj:update",
		ORef:      oref.String(),
		Data: wstore.WaveObjUpdate{
			UpdateType: wstore.UpdateType_Update,
			OType:      updatedBlock.GetOType(),
			OID:        waveobj.GetOID(updatedBlock),
			Obj:        updatedBlock,
		},
	})
	return nil, nil
}

func staticHandleResolveIds(ctx context.Context, cmd *wshutil.ResolveIdsCommand) (map[string]any, error) {
	rtn := make(map[string]any)
	for _, simpleId := range cmd.Ids {
		oref, err := resolveSimpleId(ctx, simpleId)
		if err != nil || oref == nil {
			continue
		}
		rtn[simpleId] = oref.String()
	}
	return rtn, nil
}

func (bc *BlockController) waveOSCMessageHandler(ctx context.Context, cmd wshutil.BlockCommand, respFn wshutil.ResponseFnType) (wshutil.ResponseDataType, error) {
	if strings.HasPrefix(cmd.GetCommand(), "controller:") {
		bc.InputCh <- cmd
		return nil, nil
	}
	switch cmd.GetCommand() {
	case wshutil.BlockCommand_GetMeta:
		return staticHandleGetMeta(ctx, cmd.(*wshutil.BlockGetMetaCommand))
	case wshutil.Command_ResolveIds:
		return staticHandleResolveIds(ctx, cmd.(*wshutil.ResolveIdsCommand))
	}

	ProcessStaticCommand(bc.BlockId, cmd)
	return nil, nil
}

func (bc *BlockController) DoRunShellCommand(rc *RunShellOpts) error {
	// create a circular blockfile for the output
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	err := filestore.WFS.MakeFile(ctx, bc.BlockId, "main", nil, filestore.FileOptsType{MaxSize: DefaultTermMaxFileSize, Circular: true})
	if err != nil && err != filestore.ErrAlreadyExists {
		return fmt.Errorf("error creating blockfile: %w", err)
	}
	if err == filestore.ErrAlreadyExists {
		// reset the terminal state
		bc.resetTerminalState()
	}
	if bc.getShellProc() != nil {
		return nil
	}
	shellProc, err := shellexec.StartShellProc(rc.TermSize)
	if err != nil {
		return err
	}
	err = bc.setShellProc(shellProc)
	if err != nil {
		bc.ShellProc.Close()
		return err
	}
	shellInputCh := make(chan *BlockInputUnion, 32)
	bc.ShellInputCh = shellInputCh
	messageCh := make(chan wshutil.RpcMessage, 32)
	ptyBuffer := wshutil.MakePtyBuffer(wshutil.WaveOSCPrefix, bc.ShellProc.Pty, messageCh)
	_, outputCh := wshutil.MakeWshRpc(wshutil.WaveServerOSC, messageCh, bc.waveOSCMessageHandler)
	go func() {
		// handles regular output from the pty (goes to the blockfile and xterm)
		defer func() {
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
				err := handleAppendBlockFile(bc.BlockId, BlockFile_Main, buf[:nr])
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
	return nil
}

func (bc *BlockController) Run(bdata *wstore.Block) {
	defer func() {
		bc.WithLock(func() {
			// if the controller had an error status, don't change it
			if bc.Status == "running" {
				bc.Status = "done"
			}
		})
		eventbus.SendEvent(eventbus.WSEventType{
			EventType: "block:done",
			ORef:      waveobj.MakeORef(wstore.OType_Block, bc.BlockId).String(),
			Data:      nil,
		})
		globalLock.Lock()
		defer globalLock.Unlock()
		delete(blockControllerMap, bc.BlockId)
	}()
	bc.WithLock(func() {
		bc.Status = "running"
	})

	// only controller is "shell" for now
	go func() {
		err := bc.DoRunShellCommand(&RunShellOpts{TermSize: bdata.RuntimeOpts.TermSize})
		if err != nil {
			log.Printf("error running shell: %v\n", err)
		}
	}()

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
			log.Printf("INPUT: %s | %q\n", bc.BlockId, string(inputUnion.InputData))
			bc.ShellInputCh <- inputUnion
		default:
			log.Printf("unknown command type %T\n", cmd)
		}
	}
}

func StartBlockController(ctx context.Context, blockId string) error {
	blockData, err := wstore.DBMustGet[*wstore.Block](ctx, blockId)
	if err != nil {
		return fmt.Errorf("error getting block: %w", err)
	}
	if blockData.Controller == "" {
		// nothing to start
		return nil
	}
	if blockData.Controller != BlockController_Shell {
		return fmt.Errorf("unknown controller %q", blockData.Controller)
	}
	globalLock.Lock()
	defer globalLock.Unlock()
	if _, ok := blockControllerMap[blockId]; ok {
		// already running
		return nil
	}
	bc := &BlockController{
		Lock:    &sync.Mutex{},
		BlockId: blockId,
		Status:  "init",
		InputCh: make(chan wshutil.BlockCommand),
	}
	blockControllerMap[blockId] = bc
	go bc.Run(blockData)
	return nil
}

func StopBlockController(blockId string) {
	bc := GetBlockController(blockId)
	if bc == nil {
		return
	}
	bc.Close()
	close(bc.InputCh)
}

func GetBlockController(blockId string) *BlockController {
	globalLock.Lock()
	defer globalLock.Unlock()
	return blockControllerMap[blockId]
}

func ProcessStaticCommand(blockId string, cmdGen wshutil.BlockCommand) error {
	ctx, cancelFn := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancelFn()
	switch cmd := cmdGen.(type) {
	case *wshutil.BlockSetViewCommand:
		log.Printf("SETVIEW: %s | %q\n", blockId, cmd.View)
		block, err := wstore.DBGet[*wstore.Block](ctx, blockId)
		if err != nil {
			return fmt.Errorf("error getting block: %w", err)
		}
		block.View = cmd.View
		err = wstore.DBUpdate(ctx, block)
		if err != nil {
			return fmt.Errorf("error updating block: %w", err)
		}
		// send a waveobj:update event
		updatedBlock, err := wstore.DBGet[*wstore.Block](ctx, blockId)
		if err != nil {
			return fmt.Errorf("error getting block: %w", err)
		}
		eventbus.SendEvent(eventbus.WSEventType{
			EventType: "waveobj:update",
			ORef:      waveobj.MakeORef(wstore.OType_Block, blockId).String(),
			Data: wstore.WaveObjUpdate{
				UpdateType: wstore.UpdateType_Update,
				OType:      wstore.OType_Block,
				OID:        blockId,
				Obj:        updatedBlock,
			},
		})
		return nil
	case *wshutil.BlockSetMetaCommand:
		_, err := staticHandleSetMeta(ctx, cmd, blockId)
		if err != nil {
			return err
		}
		return nil

	case *wshutil.BlockMessageCommand:
		log.Printf("MESSAGE: %s | %q\n", blockId, cmd.Message)
		return nil

	case *wshutil.BlockAppendFileCommand:
		log.Printf("APPENDFILE: %s | %q | len:%d\n", blockId, cmd.FileName, len(cmd.Data))
		err := handleAppendBlockFile(blockId, cmd.FileName, cmd.Data)
		if err != nil {
			return fmt.Errorf("error appending blockfile: %w", err)
		}
		return nil

	case *wshutil.BlockAppendIJsonCommand:
		log.Printf("APPENDIJSON: %s | %q\n", blockId, cmd.FileName)
		err := handleAppendIJsonFile(blockId, cmd.FileName, cmd.Data, true)
		if err != nil {
			return fmt.Errorf("error appending blockfile(ijson): %w", err)
		}
		return nil

	default:
		return fmt.Errorf("unknown command type %T", cmdGen)
	}
}
