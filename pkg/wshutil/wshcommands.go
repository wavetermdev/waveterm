// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"encoding/json"
	"fmt"
	"reflect"

	"github.com/wavetermdev/thenextwave/pkg/ijson"
	"github.com/wavetermdev/thenextwave/pkg/shellexec"
	"github.com/wavetermdev/thenextwave/pkg/tsgen/tsgenmeta"
	"github.com/wavetermdev/thenextwave/pkg/wstore"
)

const CommandKey = "command"

const (
	BlockCommand_Message         = "message"
	BlockCommand_SetView         = "setview"
	BlockCommand_SetMeta         = "setmeta"
	BlockCommand_GetMeta         = "getmeta"
	BlockCommand_Input           = "controller:input"
	BlockCommand_AppendBlockFile = "blockfile:append"
	BlockCommand_AppendIJson     = "blockfile:appendijson"
	Command_ResolveIds           = "resolveids"
	Command_CreateBlock          = "createblock"
)

var CommandToTypeMap = map[string]reflect.Type{
	BlockCommand_Input:           reflect.TypeOf(BlockInputCommand{}),
	BlockCommand_SetView:         reflect.TypeOf(BlockSetViewCommand{}),
	BlockCommand_SetMeta:         reflect.TypeOf(BlockSetMetaCommand{}),
	BlockCommand_GetMeta:         reflect.TypeOf(BlockGetMetaCommand{}),
	BlockCommand_Message:         reflect.TypeOf(BlockMessageCommand{}),
	BlockCommand_AppendBlockFile: reflect.TypeOf(BlockAppendFileCommand{}),
	BlockCommand_AppendIJson:     reflect.TypeOf(BlockAppendIJsonCommand{}),
	Command_ResolveIds:           reflect.TypeOf(ResolveIdsCommand{}),
	Command_CreateBlock:          reflect.TypeOf(CreateBlockCommand{}),
}

func CommandTypeUnionMeta() tsgenmeta.TypeUnionMeta {
	var rtypes []reflect.Type
	for _, rtype := range CommandToTypeMap {
		rtypes = append(rtypes, rtype)
	}
	return tsgenmeta.TypeUnionMeta{
		BaseType:      reflect.TypeOf((*BlockCommand)(nil)).Elem(),
		TypeFieldName: "command",
		Types:         rtypes,
	}
}

type CmdContextType struct {
	BlockId string
	TabId   string
}

type baseCommand struct {
	Command string `json:"command"`
}

type BlockCommand interface {
	GetCommand() string
}

type BlockControllerCommand interface {
	GetBlockId() string
}

type BlockCommandWrapper struct {
	BlockCommand
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

type BlockInputCommand struct {
	BlockId     string              `json:"blockid"`
	Command     string              `json:"command" tstype:"\"controller:input\""`
	InputData64 string              `json:"inputdata64,omitempty"`
	SigName     string              `json:"signame,omitempty"`
	TermSize    *shellexec.TermSize `json:"termsize,omitempty"`
}

func (ic *BlockInputCommand) GetCommand() string {
	return BlockCommand_Input
}

func (ic *BlockInputCommand) GetBlockId() string {
	return ic.BlockId
}

type ResolveIdsCommand struct {
	Command string   `json:"command" tstype:"\"resolveids\""`
	Ids     []string `json:"ids"`
}

func (ric *ResolveIdsCommand) GetCommand() string {
	return Command_ResolveIds
}

type BlockSetViewCommand struct {
	Command string `json:"command" tstype:"\"setview\""`
	View    string `json:"view"`
}

func (svc *BlockSetViewCommand) GetCommand() string {
	return BlockCommand_SetView
}

type BlockGetMetaCommand struct {
	Command string `json:"command" tstype:"\"getmeta\""`
	ORef    string `json:"oref"` // oref string
}

func (gmc *BlockGetMetaCommand) GetCommand() string {
	return BlockCommand_GetMeta
}

type BlockSetMetaCommand struct {
	Command string         `json:"command" tstype:"\"setmeta\""`
	ORef    string         `json:"oref,omitempty"` // allows oref, 8-char oid, or full uuid (empty is current block)
	Meta    map[string]any `json:"meta"`
}

func (smc *BlockSetMetaCommand) GetCommand() string {
	return BlockCommand_SetMeta
}

type BlockMessageCommand struct {
	Command string `json:"command" tstype:"\"message\""`
	Message string `json:"message"`
}

func (bmc *BlockMessageCommand) GetCommand() string {
	return BlockCommand_Message
}

type BlockAppendFileCommand struct {
	Command  string `json:"command" tstype:"\"blockfile:append\""`
	FileName string `json:"filename"`
	Data     []byte `json:"data"`
}

func (bwc *BlockAppendFileCommand) GetCommand() string {
	return BlockCommand_AppendBlockFile
}

type BlockAppendIJsonCommand struct {
	Command  string        `json:"command" tstype:"\"blockfile:appendijson\""`
	FileName string        `json:"filename"`
	Data     ijson.Command `json:"data"`
}

func (bwc *BlockAppendIJsonCommand) GetCommand() string {
	return BlockCommand_AppendIJson
}

type CreateBlockCommand struct {
	Command  string              `json:"command" tstype:"\"createblock\""`
	TabId    string              `json:"tabid"`
	BlockDef *wstore.BlockDef    `json:"blockdef"`
	RtOpts   *wstore.RuntimeOpts `json:"rtopts,omitempty"`
}

func (cbc *CreateBlockCommand) GetCommand() string {
	return Command_CreateBlock
}
