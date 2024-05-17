// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"sync"

	"github.com/creack/pty"
	"github.com/google/uuid"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wavetermdev/thenextwave/pkg/eventbus"
	"github.com/wavetermdev/thenextwave/pkg/shellexec"
)

const (
	BlockController_Shell = "shell"
	BlockController_Cmd   = "cmd"
)

var globalLock = &sync.Mutex{}
var blockControllerMap = make(map[string]*BlockController)
var blockDataMap = make(map[string]*BlockData)

type BlockData struct {
	Lock             *sync.Mutex    `json:"-"`
	BlockId          string         `json:"blockid"`
	BlockDef         *BlockDef      `json:"blockdef"`
	Controller       string         `json:"controller"`
	ControllerStatus string         `json:"controllerstatus"`
	View             string         `json:"view"`
	Meta             map[string]any `json:"meta,omitempty"`
	RuntimeOpts      *RuntimeOpts   `json:"runtimeopts,omitempty"`
}

type FileDef struct {
	FileType string         `json:"filetype,omitempty"`
	Path     string         `json:"path,omitempty"`
	Url      string         `json:"url,omitempty"`
	Content  string         `json:"content,omitempty"`
	Meta     map[string]any `json:"meta,omitempty"`
}

type BlockDef struct {
	Controller string              `json:"controller"`
	View       string              `json:"view,omitempty"`
	Files      map[string]*FileDef `json:"files,omitempty"`
	Meta       map[string]any      `json:"meta,omitempty"`
}

type WinSize struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

type RuntimeOpts struct {
	TermSize shellexec.TermSize `json:"termsize,omitempty"`
	WinSize  WinSize            `json:"winsize,omitempty"`
}

type BlockController struct {
	Lock     *sync.Mutex
	BlockId  string
	BlockDef *BlockDef
	InputCh  chan BlockCommand

	ShellProc    *shellexec.ShellProc
	ShellInputCh chan *InputCommand
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

func CreateBlock(bdef *BlockDef, rtOpts *RuntimeOpts) (*BlockData, error) {
	blockId := uuid.New().String()
	blockData := &BlockData{
		Lock:        &sync.Mutex{},
		BlockId:     blockId,
		BlockDef:    bdef,
		Controller:  bdef.Controller,
		View:        bdef.View,
		RuntimeOpts: rtOpts,
	}
	var err error
	blockData.Meta, err = jsonDeepCopy(bdef.Meta)
	if err != nil {
		return nil, fmt.Errorf("error copying meta: %w", err)
	}
	setBlockData(blockData)
	if blockData.Controller != "" {
		StartBlockController(blockId, blockData)
	}
	return blockData, nil
}

func CloseBlock(blockId string) {
	bc := GetBlockController(blockId)
	if bc == nil {
		return
	}
	bc.Close()
	close(bc.InputCh)
	removeBlockData(blockId)
}

func GetBlockData(blockId string) *BlockData {
	globalLock.Lock()
	defer globalLock.Unlock()
	return blockDataMap[blockId]
}

func setBlockData(bd *BlockData) {
	globalLock.Lock()
	defer globalLock.Unlock()
	blockDataMap[bd.BlockId] = bd
}

func removeBlockData(blockId string) {
	globalLock.Lock()
	defer globalLock.Unlock()
	delete(blockDataMap, blockId)
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

func (bc *BlockController) DoRunShellCommand(rc *RunShellOpts) error {
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
	shellInputCh := make(chan *InputCommand)
	bc.ShellInputCh = shellInputCh
	go func() {
		defer func() {
			// needs synchronization
			bc.ShellProc.Close()
			close(bc.ShellInputCh)
			bc.ShellProc = nil
			bc.ShellInputCh = nil
		}()
		seqNum := 0
		buf := make([]byte, 4096)
		for {
			nr, err := bc.ShellProc.Pty.Read(buf)
			seqNum++
			eventbus.SendEvent(application.WailsEvent{
				Name: "block:ptydata",
				Data: map[string]any{
					"blockid":   bc.BlockId,
					"blockfile": "main",
					"ptydata":   base64.StdEncoding.EncodeToString(buf[:nr]),
					"seqnum":    seqNum,
				},
			})
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
		for ic := range shellInputCh {
			if ic.InputData64 != "" {
				inputBuf := make([]byte, base64.StdEncoding.DecodedLen(len(ic.InputData64)))
				nw, err := base64.StdEncoding.Decode(inputBuf, []byte(ic.InputData64))
				if err != nil {
					log.Printf("error decoding input data: %v\n", err)
					continue
				}
				bc.ShellProc.Pty.Write(inputBuf[:nw])
			}
			if ic.TermSize != nil {
				log.Printf("SETTERMSIZE: %dx%d\n", ic.TermSize.Rows, ic.TermSize.Cols)
				err := pty.Setsize(bc.ShellProc.Pty, &pty.Winsize{Rows: uint16(ic.TermSize.Rows), Cols: uint16(ic.TermSize.Cols)})
				if err != nil {
					log.Printf("error setting term size: %v\n", err)
				}
			}
		}
	}()
	return nil
}

func (bc *BlockController) Run(bdata *BlockData) {
	defer func() {
		bdata.WithLock(func() {
			// if the controller had an error status, don't change it
			if bdata.ControllerStatus == "running" {
				bdata.ControllerStatus = "done"
			}
		})
		eventbus.SendEvent(application.WailsEvent{
			Name: "block:done",
			Data: nil,
		})
		globalLock.Lock()
		defer globalLock.Unlock()
		delete(blockControllerMap, bc.BlockId)
	}()
	bdata.WithLock(func() {
		bdata.ControllerStatus = "running"
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
		case *InputCommand:
			fmt.Printf("INPUT: %s | %q\n", bc.BlockId, cmd.InputData64)
			if bc.ShellInputCh != nil {
				bc.ShellInputCh <- cmd
			}
		default:
			fmt.Printf("unknown command type %T\n", cmd)
		}
	}
}

func (b *BlockData) WithLock(f func()) {
	b.Lock.Lock()
	defer b.Lock.Unlock()
	f()
}

func StartBlockController(blockId string, bdata *BlockData) {
	if bdata.Controller != BlockController_Shell {
		log.Printf("unknown controller %q\n", bdata.Controller)
		bdata.WithLock(func() {
			bdata.ControllerStatus = "error"
		})
		return
	}
	globalLock.Lock()
	defer globalLock.Unlock()
	if _, ok := blockControllerMap[blockId]; ok {
		return
	}
	bc := &BlockController{
		Lock:    &sync.Mutex{},
		BlockId: blockId,
		InputCh: make(chan BlockCommand),
	}
	blockControllerMap[blockId] = bc
	go bc.Run(bdata)
}

func GetBlockController(blockId string) *BlockController {
	globalLock.Lock()
	defer globalLock.Unlock()
	return blockControllerMap[blockId]
}

func ProcessStaticCommand(blockId string, cmdGen BlockCommand) {
	switch cmd := cmdGen.(type) {
	case *MessageCommand:
		log.Printf("MESSAGE: %s | %q\n", blockId, cmd.Message)
	case *SetViewCommand:
		log.Printf("SETVIEW: %s | %q\n", blockId, cmd.View)
		block := GetBlockData(blockId)
		if block != nil {
			block.WithLock(func() {
				block.View = cmd.View
			})
		}
	case *SetMetaCommand:
		log.Printf("SETMETA: %s | %v\n", blockId, cmd.Meta)
		block := GetBlockData(blockId)
		if block != nil {
			block.WithLock(func() {
				for k, v := range cmd.Meta {
					if v == nil {
						delete(block.Meta, k)
						continue
					}
					block.Meta[k] = v
				}
			})
		}
	}
}
