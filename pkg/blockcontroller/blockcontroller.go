// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"os/exec"
	"sync"

	"github.com/creack/pty"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wavetermdev/thenextwave/pkg/eventbus"
	"github.com/wavetermdev/thenextwave/pkg/shellexec"
	"github.com/wavetermdev/thenextwave/pkg/util/shellutil"
)

var globalLock = &sync.Mutex{}
var blockControllerMap = make(map[string]*BlockController)

type BlockController struct {
	Lock         *sync.Mutex
	BlockId      string
	InputCh      chan BlockCommand
	ShellProc    *shellexec.ShellProc
	ShellInputCh chan *InputCommand
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

func (bc *BlockController) DoRunCommand(rc *RunCommand) error {
	cmdStr := rc.CmdStr
	shellPath := shellutil.DetectLocalShellPath()
	ecmd := exec.Command(shellPath, "-c", cmdStr)
	log.Printf("running shell command: %q %q\n", shellPath, cmdStr)
	barr, err := shellexec.RunSimpleCmdInPty(ecmd, rc.TermSize)
	if err != nil {
		return err
	}
	for len(barr) > 0 {
		part := barr
		if len(part) > 4096 {
			part = part[:4096]
		}
		eventbus.SendEvent(application.WailsEvent{
			Name: "block:ptydata",
			Data: map[string]any{
				"blockid":   bc.BlockId,
				"blockfile": "main",
				"ptydata":   base64.StdEncoding.EncodeToString(part),
			},
		})
		barr = barr[len(part):]
	}
	return nil
}

func (bc *BlockController) DoRunShellCommand(rc *RunShellCommand) error {
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
		buf := make([]byte, 4096)
		for {
			nr, err := bc.ShellProc.Pty.Read(buf)
			eventbus.SendEvent(application.WailsEvent{
				Name: "block:ptydata",
				Data: map[string]any{
					"blockid":   bc.BlockId,
					"blockfile": "main",
					"ptydata":   base64.StdEncoding.EncodeToString(buf[:nr]),
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
				err := pty.Setsize(bc.ShellProc.Pty, &pty.Winsize{Rows: uint16(ic.TermSize.Rows), Cols: uint16(ic.TermSize.Cols)})
				if err != nil {
					log.Printf("error setting term size: %v\n", err)
				}
			}
		}
	}()
	return nil
}

func (bc *BlockController) Run() {
	defer func() {
		eventbus.SendEvent(application.WailsEvent{
			Name: "block:done",
			Data: nil,
		})
		globalLock.Lock()
		defer globalLock.Unlock()
		delete(blockControllerMap, bc.BlockId)
	}()

	messageCount := 0
	for genCmd := range bc.InputCh {
		switch cmd := genCmd.(type) {
		case *MessageCommand:
			fmt.Printf("MESSAGE: %s | %q\n", bc.BlockId, cmd.Message)
			messageCount++
			eventbus.SendEvent(application.WailsEvent{
				Name: "block:ptydata",
				Data: map[string]any{
					"blockid":   bc.BlockId,
					"blockfile": "main",
					"ptydata":   base64.StdEncoding.EncodeToString([]byte(fmt.Sprintf("message %d\r\n", messageCount))),
				},
			})
		case *RunCommand:
			fmt.Printf("RUN: %s | %q\n", bc.BlockId, cmd.CmdStr)
			go func() {
				err := bc.DoRunCommand(cmd)
				if err != nil {
					log.Printf("error running shell command: %v\n", err)
				}
			}()
		case *InputCommand:
			fmt.Printf("INPUT: %s | %q\n", bc.BlockId, cmd.InputData64)
			if bc.ShellInputCh != nil {
				bc.ShellInputCh <- cmd
			}

		case *RunShellCommand:
			fmt.Printf("RUNSHELL: %s\n", bc.BlockId)
			if bc.ShellProc != nil {
				continue
			}
			go func() {
				err := bc.DoRunShellCommand(cmd)
				if err != nil {
					log.Printf("error running shell: %v\n", err)
				}
			}()
		default:
			fmt.Printf("unknown command type %T\n", cmd)
		}
	}
}

func StartBlockController(blockId string) *BlockController {
	globalLock.Lock()
	defer globalLock.Unlock()
	if existingBC, ok := blockControllerMap[blockId]; ok {
		return existingBC
	}
	bc := &BlockController{
		Lock:    &sync.Mutex{},
		BlockId: blockId,
		InputCh: make(chan BlockCommand),
	}
	blockControllerMap[blockId] = bc
	go bc.Run()
	return bc
}

func GetBlockController(blockId string) *BlockController {
	globalLock.Lock()
	defer globalLock.Unlock()
	return blockControllerMap[blockId]
}
