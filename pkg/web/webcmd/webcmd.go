// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package webcmd

import (
	"fmt"
	"reflect"

	"github.com/wavetermdev/waveterm/pkg/tsgen/tsgenmeta"
	"github.com/wavetermdev/waveterm/pkg/util/utilfn"
	"github.com/wavetermdev/waveterm/pkg/wshutil"
)

const (
	WSCommand_Rpc = "rpc"
)

type WSCommandType interface {
	GetWSCommand() string
}

func WSCommandTypeUnionMeta() tsgenmeta.TypeUnionMeta {
	return tsgenmeta.TypeUnionMeta{
		BaseType:      reflect.TypeOf((*WSCommandType)(nil)).Elem(),
		TypeFieldName: "wscommand",
		Types: []reflect.Type{
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

func ParseWSCommandMap(cmdMap map[string]any) (WSCommandType, error) {
	cmdType, ok := cmdMap["wscommand"].(string)
	if !ok {
		return nil, fmt.Errorf("no wscommand field in command map")
	}
	switch cmdType {
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
