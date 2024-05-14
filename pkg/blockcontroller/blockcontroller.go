// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wavetermdev/thenextwave/pkg/eventbus"
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
	default:
		return nil, fmt.Errorf("unknown command type %q", cmdType)
	}
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
