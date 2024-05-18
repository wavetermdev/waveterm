// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import "reflect"

const (
	CommandSetView         = "setview"
	CommandSetMeta         = "setmeta"
	CommandBlockFileAppend = "blockfile:append"
)

var CommandToTypeMap = map[string]reflect.Type{
	CommandSetView: reflect.TypeOf(SetViewCommand{}),
	CommandSetMeta: reflect.TypeOf(SetMetaCommand{}),
}

type Command interface {
	GetCommand() string
}

// for unmarshalling
type baseCommand struct {
	Command string `json:"command"`
}

type SetViewCommand struct {
	Command string `json:"command"`
	View    string `json:"view"`
}

func (svc *SetViewCommand) GetCommand() string {
	return CommandSetView
}

type SetMetaCommand struct {
	Command string         `json:"command"`
	Meta    map[string]any `json:"meta"`
}

func (smc *SetMetaCommand) GetCommand() string {
	return CommandSetMeta
}

type BlockFileAppendCommand struct {
	Command  string `json:"command"`
	FileName string `json:"filename"`
	Data     []byte `json:"data"`
}

func (bfac *BlockFileAppendCommand) GetCommand() string {
	return CommandBlockFileAppend
}
