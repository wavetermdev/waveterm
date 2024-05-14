// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"encoding/json"
	"fmt"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wavetermdev/thenextwave/pkg/eventbus"
)

var globalLock = &sync.Mutex{}
var blockControllerMap = make(map[string]*BlockController)

type BlockCommand interface {
	GetType() string
}

type MessageCommand struct {
	Message string `json:"message"`
}

func (mc *MessageCommand) GetType() string {
	return "message"
}

type BlockController struct {
	BlockId string
	InputCh chan BlockCommand
}

func ParseCmdMap(cmdMap map[string]any) (BlockCommand, error) {
	cmdType, ok := cmdMap["type"].(string)
	if !ok {
		return nil, fmt.Errorf("no type field in command map")
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

	for genCmd := range bc.InputCh {
		switch cmd := genCmd.(type) {
		case *MessageCommand:
			fmt.Printf("MESSAGE: %s | %q\n", bc.BlockId, cmd.Message)

		default:
			fmt.Printf("unknown command type %T\n", cmd)
		}
	}
}

func NewBlockController(blockId string) *BlockController {
	globalLock.Lock()
	defer globalLock.Unlock()
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
