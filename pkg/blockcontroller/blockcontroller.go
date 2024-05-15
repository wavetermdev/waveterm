// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"os/exec"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wavetermdev/thenextwave/pkg/eventbus"
	"github.com/wavetermdev/thenextwave/pkg/shellexec"
	"github.com/wavetermdev/thenextwave/pkg/util/shellutil"
)

var globalLock = &sync.Mutex{}
var blockControllerMap = make(map[string]*BlockController)

type BlockCommand interface {
	GetCommand() string
}

type MessageCommand struct {
	Command string `json:"command"`
	Message string `json:"message"`
}

func (mc *MessageCommand) GetCommand() string {
	return "message"
}

type RunCommand struct {
	Command  string             `json:"command"`
	CmdStr   string             `json:"cmdstr"`
	TermSize shellexec.TermSize `json:"termsize"`
}

func (rc *RunCommand) GetCommand() string {
	return "run"
}

type BlockController struct {
	BlockId string
	InputCh chan BlockCommand
}

func ParseCmdMap(cmdMap map[string]any) (BlockCommand, error) {
	cmdType, ok := cmdMap["command"].(string)
	if !ok {
		return nil, fmt.Errorf("no command field in command map")
	}
	mapJson, err := json.Marshal(cmdMap)
	if err != nil {
		return nil, fmt.Errorf("error marshalling command map: %w", err)
	}
	switch cmdType {
	case "message":
		var cmd MessageCommand
		err := json.Unmarshal(mapJson, &cmd)
		if err != nil {
			return nil, fmt.Errorf("error unmarshalling message command: %w", err)
		}
		return &cmd, nil
	case "run":
		var cmd RunCommand
		err := json.Unmarshal(mapJson, &cmd)
		if err != nil {
			return nil, fmt.Errorf("error unmarshalling run command: %w", err)
		}
		return &cmd, nil
	default:
		return nil, fmt.Errorf("unknown command type %q", cmdType)
	}
}

func (bc *BlockController) StartShellCommand(rc *RunCommand) error {
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
				err := bc.StartShellCommand(cmd)
				if err != nil {
					log.Printf("error running shell command: %v\n", err)
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
