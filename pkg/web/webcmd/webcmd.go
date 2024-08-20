// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package webcmd

import (
	"fmt"
	"reflect"

	"github.com/wavetermdev/thenextwave/pkg/tsgen/tsgenmeta"
	"github.com/wavetermdev/thenextwave/pkg/util/utilfn"
	"github.com/wavetermdev/thenextwave/pkg/waveobj"
	"github.com/wavetermdev/thenextwave/pkg/wshutil"
)

const (
	WSCommand_SetBlockTermSize = "setblocktermsize"
	WSCommand_BlockInput       = "blockinput"
	WSCommand_Rpc              = "rpc"
)

type WSCommandType interface {
	GetWSCommand() string
}

func WSCommandTypeUnionMeta() tsgenmeta.TypeUnionMeta {
	return tsgenmeta.TypeUnionMeta{
		BaseType:      reflect.TypeOf((*WSCommandType)(nil)).Elem(),
		TypeFieldName: "wscommand",
		Types: []reflect.Type{
			reflect.TypeOf(SetBlockTermSizeWSCommand{}),
			reflect.TypeOf(BlockInputWSCommand{}),
			reflect.TypeOf(WSRpcCommand{}),
		},
	}
}

type WSRpcCommand struct {
	WSCommand string              `json:"wscommand" tstype:"\"rpc\""`
	Message   *wshutil.RpcMessage `json:"message"`
}

func (cmd *WSRpcCommand) GetWSCommand() string {
	return cmd.WSCommand
}

type SetBlockTermSizeWSCommand struct {
	WSCommand string           `json:"wscommand" tstype:"\"setblocktermsize\""`
	BlockId   string           `json:"blockid"`
	TermSize  waveobj.TermSize `json:"termsize"`
}

func (cmd *SetBlockTermSizeWSCommand) GetWSCommand() string {
	return cmd.WSCommand
}

type BlockInputWSCommand struct {
	WSCommand   string `json:"wscommand" tstype:"\"blockinput\""`
	BlockId     string `json:"blockid"`
	InputData64 string `json:"inputdata64"`
}

func (cmd *BlockInputWSCommand) GetWSCommand() string {
	return cmd.WSCommand
}

func ParseWSCommandMap(cmdMap map[string]any) (WSCommandType, error) {
	cmdType, ok := cmdMap["wscommand"].(string)
	if !ok {
		return nil, fmt.Errorf("no wscommand field in command map")
	}
	switch cmdType {
	case WSCommand_SetBlockTermSize:
		var cmd SetBlockTermSizeWSCommand
		err := utilfn.DoMapStructure(&cmd, cmdMap)
		if err != nil {
			return nil, fmt.Errorf("error decoding SetBlockTermSizeWSCommand: %w", err)
		}
		return &cmd, nil
	case WSCommand_BlockInput:
		var cmd BlockInputWSCommand
		err := utilfn.DoMapStructure(&cmd, cmdMap)
		if err != nil {
			return nil, fmt.Errorf("error decoding BlockInputWSCommand: %w", err)
		}
		return &cmd, nil
	case WSCommand_Rpc:
		var cmd WSRpcCommand
		err := utilfn.DoMapStructure(&cmd, cmdMap)
		if err != nil {
			return nil, fmt.Errorf("error decoding WSRpcCommand: %w", err)
		}
		return &cmd, nil
	default:
		return nil, fmt.Errorf("unknown wscommand type %q", cmdType)
	}

}
