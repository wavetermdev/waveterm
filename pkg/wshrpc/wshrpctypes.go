// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// types and methods for wsh rpc calls
package wshrpc

import (
	"context"
	"log"
	"os"
	"reflect"

	"github.com/wavetermdev/thenextwave/pkg/ijson"
	"github.com/wavetermdev/thenextwave/pkg/waveobj"
	"github.com/wavetermdev/thenextwave/pkg/wstore"
)

const LocalConnName = "local"

const (
	RpcType_Call             = "call"             // single response (regular rpc)
	RpcType_ResponseStream   = "responsestream"   // stream of responses (streaming rpc)
	RpcType_StreamingRequest = "streamingrequest" // streaming request
	RpcType_Complex          = "complex"          // streaming request/response
)

const (
	Command_Authenticate      = "authenticate"
	Command_Announce          = "announce" // special (for routing)
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
	Command_RemoteWriteFile   = "remotewritefile"
	Command_RemoteFileDelete  = "remotefiledelete"
	Command_Event             = "event"
)

type RespOrErrorUnion[T any] struct {
	Response T
	Error    error
}

type WshRpcInterface interface {
	AuthenticateCommand(ctx context.Context, data string) error
	AnnounceCommand(ctx context.Context, data string) error // (special) announces a new route to the main router

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
	StreamCpuDataCommand(ctx context.Context, request CpuDataRequest) chan RespOrErrorUnion[TimeSeriesData]
	TestCommand(ctx context.Context, data string) error

	// remotes
	RemoteStreamFileCommand(ctx context.Context, data CommandRemoteStreamFileData) chan RespOrErrorUnion[CommandRemoteStreamFileRtnData]
	RemoteFileInfoCommand(ctx context.Context, path string) (*FileInfo, error)
	RemoteFileDeleteCommand(ctx context.Context, path string) error
	RemoteWriteFileCommand(ctx context.Context, data CommandRemoteWriteFileData) error
	RemoteStreamCpuDataCommand(ctx context.Context) chan RespOrErrorUnion[TimeSeriesData]
}

// for frontend
type WshServerCommandMeta struct {
	CommandType string `json:"commandtype"`
}

type RpcOpts struct {
	Timeout    int    `json:"timeout,omitempty"`
	NoResponse bool   `json:"noresponse,omitempty"`
	Route      string `json:"route,omitempty"`
}

type RpcContext struct {
	BlockId string `json:"blockid,omitempty"`
	TabId   string `json:"tabid,omitempty"`
	Conn    string `json:"conn,omitempty"`
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
		case "BlockORef":
			if rpcContext.BlockId != "" {
				field.Set(reflect.ValueOf(waveobj.MakeORef(wstore.OType_Block, rpcContext.BlockId)))
			}
		default:
			log.Printf("invalid wshcontext tag: %q in type(%T)", tag, dataPtr)
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
	BlockId string   `json:"blockid" wshcontext:"BlockId"`
	Ids     []string `json:"ids"`
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
	BlockId     string           `json:"blockid" wshcontext:"BlockId"`
	InputData64 string           `json:"inputdata64,omitempty"`
	SigName     string           `json:"signame,omitempty"`
	TermSize    *wstore.TermSize `json:"termsize,omitempty"`
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
	FileInfo []*FileInfo `json:"fileinfo,omitempty"`
	Data64   string      `json:"data64,omitempty"`
}

type CommandRemoteWriteFileData struct {
	Path       string      `json:"path"`
	Data64     string      `json:"data64"`
	CreateMode os.FileMode `json:"createmode,omitempty"`
}

const (
	TimeSeries_Cpu = "cpu"
)

type TimeSeriesData struct {
	Ts     int64              `json:"ts"`
	Values map[string]float64 `json:"values"`
}
