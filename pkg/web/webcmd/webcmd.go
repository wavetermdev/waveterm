// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package webcmd

import (
	"fmt"
	"reflect"

	"github.com/wavetermdev/thenextwave/pkg/shellexec"
	"github.com/wavetermdev/thenextwave/pkg/tsgen/tsgenmeta"
	"github.com/wavetermdev/thenextwave/pkg/waveobj"
)

const (
	WSCommand_SetBlockTermSize = "setblocktermsize"
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
		},
	}
}

type SetBlockTermSizeWSCommand struct {
	WSCommand string             `json:"wscommand" tstype:"\"setblocktermsize\""`
	BlockId   string             `json:"blockid"`
	TermSize  shellexec.TermSize `json:"termsize"`
}

func (cmd *SetBlockTermSizeWSCommand) GetWSCommand() string {
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
		err := waveobj.DoMapStucture(&cmd, cmdMap)
		if err != nil {
			return nil, fmt.Errorf("error decoding SetBlockTermSizeWSCommand: %w", err)
		}
		return &cmd, nil
	default:
		return nil, fmt.Errorf("unknown wscommand type %q", cmdType)
	}

}
