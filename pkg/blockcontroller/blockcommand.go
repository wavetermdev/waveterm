// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"encoding/json"
	"fmt"
	"reflect"

	"github.com/wavetermdev/thenextwave/pkg/shellexec"
)

const CommandKey = "command"

const (
	BlockCommand_Message = "message"
	BlockCommand_Input   = "controller:input"
)

var CommandToTypeMap = map[string]reflect.Type{
	BlockCommand_Message: reflect.TypeOf(MessageCommand{}),
	BlockCommand_Input:   reflect.TypeOf(InputCommand{}),
}

type BlockCommand interface {
	GetCommand() string
}

func ParseCmdMap(cmdMap map[string]any) (BlockCommand, error) {
	cmdType, ok := cmdMap[CommandKey].(string)
	if !ok {
		return nil, fmt.Errorf("no %s field in command map", CommandKey)
	}
	mapJson, err := json.Marshal(cmdMap)
	if err != nil {
		return nil, fmt.Errorf("error marshalling command map: %w", err)
	}
	rtype := CommandToTypeMap[cmdType]
	if rtype == nil {
		return nil, fmt.Errorf("unknown command type %q", cmdType)
	}
	cmd := reflect.New(rtype).Interface()
	err = json.Unmarshal(mapJson, cmd)
	if err != nil {
		return nil, fmt.Errorf("error unmarshalling command: %w", err)
	}
	return cmd.(BlockCommand), nil
}

type MessageCommand struct {
	Command string `json:"command"`
	Message string `json:"message"`
}

func (mc *MessageCommand) GetCommand() string {
	return BlockCommand_Message
}

type InputCommand struct {
	Command     string              `json:"command"`
	InputData64 string              `json:"inputdata64"`
	SigName     string              `json:"signame,omitempty"`
	TermSize    *shellexec.TermSize `json:"termsize,omitempty"`
}

func (ic *InputCommand) GetCommand() string {
	return BlockCommand_Input
}
