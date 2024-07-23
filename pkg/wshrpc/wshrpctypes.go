// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// types and methods for wsh rpc calls
package wshrpc

import (
	"reflect"

	"github.com/wavetermdev/thenextwave/pkg/ijson"
	"github.com/wavetermdev/thenextwave/pkg/shellexec"
	"github.com/wavetermdev/thenextwave/pkg/waveobj"
	"github.com/wavetermdev/thenextwave/pkg/wshutil"
	"github.com/wavetermdev/thenextwave/pkg/wstore"
)

const (
	Command_Message     = "message"
	Command_SetView     = "setview"
	Command_SetMeta     = "setmeta"
	Command_GetMeta     = "getmeta"
	Command_BlockInput  = "controller:input"
	Command_Restart     = "controller:restart"
	Command_AppendFile  = "file:append"
	Command_AppendIJson = "file:appendijson"
	Command_ResolveIds  = "resolveids"
	Command_CreateBlock = "createblock"
	Command_DeleteBlock = "deleteblock"
	Command_WriteFile   = "file:write"
	Command_ReadFile    = "file:read"
)

type MetaDataType = map[string]any

var DataTypeMap = map[string]reflect.Type{
	"meta":          reflect.TypeOf(MetaDataType{}),
	"resolveidsrtn": reflect.TypeOf(CommandResolveIdsRtnData{}),
	"oref":          reflect.TypeOf(waveobj.ORef{}),
}

type RespOrErrorUnion[T any] struct {
	Response T
	Error    error
}

// for frontend
type WshServerCommandMeta struct {
	CommandType string `json:"commandtype"`
}

type WshRpcCommandOpts struct {
	Timeout    int  `json:"timeout"`
	NoResponse bool `json:"noresponse"`
}

func HackRpcContextIntoData(dataPtr any, rpcContext wshutil.RpcContext) {
	dataVal := reflect.ValueOf(dataPtr).Elem()
	dataType := dataVal.Type()
	for i := 0; i < dataVal.NumField(); i++ {
		field := dataVal.Field(i)
		if !field.IsZero() {
			continue
		}
		fieldType := dataType.Field(i)
		tag := fieldType.Tag.Get("wshcontext")
		if tag == "" {
			continue
		}
		switch tag {
		case "BlockId":
			field.SetString(rpcContext.BlockId)
		case "TabId":
			field.SetString(rpcContext.TabId)
		case "WindowId":
			field.SetString(rpcContext.WindowId)
		case "BlockORef":
			if rpcContext.BlockId != "" {
				field.Set(reflect.ValueOf(waveobj.MakeORef(wstore.OType_Block, rpcContext.BlockId)))
			}
		}
	}
}

type CommandMessageData struct {
	ORef    waveobj.ORef `json:"oref" wshcontext:"BlockORef"`
	Message string       `json:"message"`
}

type CommandGetMetaData struct {
	ORef waveobj.ORef `json:"oref" wshcontext:"BlockORef"`
}

type CommandSetMetaData struct {
	ORef waveobj.ORef `json:"oref" wshcontext:"BlockORef"`
	Meta MetaDataType `json:"meta"`
}

type CommandResolveIdsData struct {
	Ids []string `json:"ids"`
}

type CommandResolveIdsRtnData struct {
	ResolvedIds map[string]waveobj.ORef `json:"resolvedids"`
}

type CommandCreateBlockData struct {
	TabId    string              `json:"tabid" wshcontext:"TabId"`
	BlockDef *wstore.BlockDef    `json:"blockdef"`
	RtOpts   *wstore.RuntimeOpts `json:"rtopts"`
}

type CommandBlockSetViewData struct {
	BlockId string `json:"blockid" wshcontext:"BlockId"`
	View    string `json:"view"`
}

type CommandBlockRestartData struct {
	BlockId string `json:"blockid" wshcontext:"BlockId"`
}

type CommandBlockInputData struct {
	BlockId     string              `json:"blockid" wshcontext:"BlockId"`
	InputData64 string              `json:"inputdata64,omitempty"`
	SigName     string              `json:"signame,omitempty"`
	TermSize    *shellexec.TermSize `json:"termsize,omitempty"`
}

type CommandFileData struct {
	ZoneId   string `json:"zoneid" wshcontext:"BlockId"`
	FileName string `json:"filename"`
	Data64   string `json:"data64,omitempty"`
}

type CommandAppendIJsonData struct {
	ZoneId   string        `json:"zoneid" wshcontext:"BlockId"`
	FileName string        `json:"filename"`
	Data     ijson.Command `json:"data"`
}

type CommandDeleteBlockData struct {
	BlockId string `json:"blockid" wshcontext:"BlockId"`
}
