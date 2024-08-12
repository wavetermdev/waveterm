// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// types and methods for wsh rpc calls
package wshrpc

import (
	"context"
	"os"
	"reflect"

	"github.com/wavetermdev/thenextwave/pkg/ijson"
	"github.com/wavetermdev/thenextwave/pkg/shellexec"
	"github.com/wavetermdev/thenextwave/pkg/waveobj"
	"github.com/wavetermdev/thenextwave/pkg/wstore"
)

const (
	RpcType_Call             = "call"             // single response (regular rpc)
	RpcType_ResponseStream   = "responsestream"   // stream of responses (streaming rpc)
	RpcType_StreamingRequest = "streamingrequest" // streaming request
	RpcType_Complex          = "complex"          // streaming request/response
)

const (
	Command_Authenticate      = "authenticate"
	Command_Message           = "message"
	Command_GetMeta           = "getmeta"
	Command_SetMeta           = "setmeta"
	Command_SetView           = "setview"
	Command_ControllerInput   = "controllerinput"
	Command_ControllerRestart = "controllerrestart"
	Command_FileAppend        = "fileappend"
	Command_FileAppendIJson   = "fileappendijson"
	Command_ResolveIds        = "resolveids"
	Command_CreateBlock       = "createblock"
	Command_DeleteBlock       = "deleteblock"
	Command_FileWrite         = "filewrite"
	Command_FileRead          = "fileread"
	Command_EventPublish      = "eventpublish"
	Command_EventRecv         = "eventrecv"
	Command_EventSub          = "eventsub"
	Command_EventUnsub        = "eventunsub"
	Command_EventUnsubAll     = "eventunsuball"
	Command_StreamTest        = "streamtest"
	Command_StreamWaveAi      = "streamwaveai"
	Command_StreamCpuData     = "streamcpudata"
	Command_Test              = "test"
	Command_RemoteStreamFile  = "remotestreamfile"
	Command_RemoteFileInfo    = "remotefileinfo"
)

type RespOrErrorUnion[T any] struct {
	Response T
	Error    error
}

type WshRpcInterface interface {
	AuthenticateCommand(ctx context.Context, data string) error
	MessageCommand(ctx context.Context, data CommandMessageData) error
	GetMetaCommand(ctx context.Context, data CommandGetMetaData) (wstore.MetaMapType, error)
	SetMetaCommand(ctx context.Context, data CommandSetMetaData) error
	SetViewCommand(ctx context.Context, data CommandBlockSetViewData) error
	ControllerInputCommand(ctx context.Context, data CommandBlockInputData) error
	ControllerRestartCommand(ctx context.Context, data CommandBlockRestartData) error
	FileAppendCommand(ctx context.Context, data CommandFileData) error
	FileAppendIJsonCommand(ctx context.Context, data CommandAppendIJsonData) error
	ResolveIdsCommand(ctx context.Context, data CommandResolveIdsData) (CommandResolveIdsRtnData, error)
	CreateBlockCommand(ctx context.Context, data CommandCreateBlockData) (waveobj.ORef, error)
	DeleteBlockCommand(ctx context.Context, data CommandDeleteBlockData) error
	FileWriteCommand(ctx context.Context, data CommandFileData) error
	FileReadCommand(ctx context.Context, data CommandFileData) (string, error)
	EventPublishCommand(ctx context.Context, data WaveEvent) error
	EventRecvCommand(ctx context.Context, data WaveEvent) error
	EventSubCommand(ctx context.Context, data SubscriptionRequest) error
	EventUnsubCommand(ctx context.Context, data SubscriptionRequest) error
	EventUnsubAllCommand(ctx context.Context) error
	StreamTestCommand(ctx context.Context) chan RespOrErrorUnion[int]
	StreamWaveAiCommand(ctx context.Context, request OpenAiStreamRequest) chan RespOrErrorUnion[OpenAIPacketType]
	StreamCpuDataCommand(ctx context.Context, request CpuDataRequest) chan RespOrErrorUnion[CpuDataType]
	TestCommand(ctx context.Context, data string) error

	// remotes
	RemoteStreamFileCommand(ctx context.Context, data CommandRemoteStreamFileData) chan RespOrErrorUnion[CommandRemoteStreamFileRtnData]
	RemoteFileInfoCommand(ctx context.Context, path string) (*FileInfo, error)
}

// for frontend
type WshServerCommandMeta struct {
	CommandType string `json:"commandtype"`
}

type WshRpcCommandOpts struct {
	Timeout    int  `json:"timeout"`
	NoResponse bool `json:"noresponse"`
}

type RpcContext struct {
	BlockId  string `json:"blockid,omitempty"`
	TabId    string `json:"tabid,omitempty"`
	WindowId string `json:"windowid,omitempty"`
}

func HackRpcContextIntoData(dataPtr any, rpcContext RpcContext) {
	dataVal := reflect.ValueOf(dataPtr).Elem()
	if dataVal.Kind() != reflect.Struct {
		return
	}
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
	ORef waveobj.ORef       `json:"oref" wshcontext:"BlockORef"`
	Meta wstore.MetaMapType `json:"meta"`
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

type WaveEvent struct {
	Event  string   `json:"event"`
	Scopes []string `json:"scopes,omitempty"`
	Sender string   `json:"sender,omitempty"`
	Data   any      `json:"data,omitempty"`
}

type SubscriptionRequest struct {
	Event     string   `json:"event"`
	Scopes    []string `json:"scopes,omitempty"`
	AllScopes bool     `json:"allscopes,omitempty"`
}

type OpenAiStreamRequest struct {
	ClientId string                    `json:"clientid,omitempty"`
	Opts     *OpenAIOptsType           `json:"opts"`
	Prompt   []OpenAIPromptMessageType `json:"prompt"`
}

type OpenAIPromptMessageType struct {
	Role    string `json:"role"`
	Content string `json:"content"`
	Name    string `json:"name,omitempty"`
}

type OpenAIOptsType struct {
	Model      string `json:"model"`
	APIToken   string `json:"apitoken"`
	BaseURL    string `json:"baseurl,omitempty"`
	MaxTokens  int    `json:"maxtokens,omitempty"`
	MaxChoices int    `json:"maxchoices,omitempty"`
	Timeout    int    `json:"timeout,omitempty"`
}

type OpenAIPacketType struct {
	Type         string           `json:"type"`
	Model        string           `json:"model,omitempty"`
	Created      int64            `json:"created,omitempty"`
	FinishReason string           `json:"finish_reason,omitempty"`
	Usage        *OpenAIUsageType `json:"usage,omitempty"`
	Index        int              `json:"index,omitempty"`
	Text         string           `json:"text,omitempty"`
	Error        string           `json:"error,omitempty"`
}

type OpenAIUsageType struct {
	PromptTokens     int `json:"prompt_tokens,omitempty"`
	CompletionTokens int `json:"completion_tokens,omitempty"`
	TotalTokens      int `json:"total_tokens,omitempty"`
}

type CpuDataRequest struct {
	Id    string `json:"id"`
	Count int    `json:"count"`
}

type CpuDataType struct {
	Time  int64   `json:"time"`
	Value float64 `json:"value"`
}

type FileInfo struct {
	Path     string      `json:"path"` // cleaned path
	Name     string      `json:"name"`
	NotFound bool        `json:"notfound,omitempty"`
	Size     int64       `json:"size"`
	Mode     os.FileMode `json:"mode"`
	ModeStr  string      `json:"modestr"`
	ModTime  int64       `json:"modtime"`
	IsDir    bool        `json:"isdir,omitempty"`
	MimeType string      `json:"mimetype,omitempty"`
}

type CommandRemoteStreamFileData struct {
	Path      string `json:"path"`
	ByteRange string `json:"byterange,omitempty"`
}

type CommandRemoteStreamFileRtnData struct {
	FileInfo *FileInfo `json:"fileinfo,omitempty"`
	Data64   string    `json:"data64,omitempty"`
}
