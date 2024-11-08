// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// types and methods for wsh rpc calls
package wshrpc

import (
	"context"
	"log"
	"os"
	"reflect"

	"github.com/wavetermdev/waveterm/pkg/ijson"
	"github.com/wavetermdev/waveterm/pkg/vdom"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wps"
)

const LocalConnName = "local"

const (
	RpcType_Call             = "call"             // single response (regular rpc)
	RpcType_ResponseStream   = "responsestream"   // stream of responses (streaming rpc)
	RpcType_StreamingRequest = "streamingrequest" // streaming request
	RpcType_Complex          = "complex"          // streaming request/response
)

const (
	Command_Authenticate      = "authenticate"    // special
	Command_Dispose           = "dispose"         // special (disposes of the route, for multiproxy only)
	Command_RouteAnnounce     = "routeannounce"   // special (for routing)
	Command_RouteUnannounce   = "routeunannounce" // special (for routing)
	Command_Message           = "message"
	Command_GetMeta           = "getmeta"
	Command_SetMeta           = "setmeta"
	Command_SetView           = "setview"
	Command_ControllerInput   = "controllerinput"
	Command_ControllerRestart = "controllerrestart"
	Command_ControllerStop    = "controllerstop"
	Command_ControllerResync  = "controllerresync"
	Command_FileAppend        = "fileappend"
	Command_FileAppendIJson   = "fileappendijson"
	Command_ResolveIds        = "resolveids"
	Command_BlockInfo         = "blockinfo"
	Command_CreateBlock       = "createblock"
	Command_DeleteBlock       = "deleteblock"
	Command_FileWrite         = "filewrite"
	Command_FileRead          = "fileread"
	Command_EventPublish      = "eventpublish"
	Command_EventRecv         = "eventrecv"
	Command_EventSub          = "eventsub"
	Command_EventUnsub        = "eventunsub"
	Command_EventUnsubAll     = "eventunsuball"
	Command_EventReadHistory  = "eventreadhistory"
	Command_StreamTest        = "streamtest"
	Command_StreamWaveAi      = "streamwaveai"
	Command_StreamCpuData     = "streamcpudata"
	Command_Test              = "test"
	Command_RemoteStreamFile  = "remotestreamfile"
	Command_RemoteFileInfo    = "remotefileinfo"
	Command_RemoteWriteFile   = "remotewritefile"
	Command_RemoteFileDelete  = "remotefiledelete"
	Command_RemoteFileJoin    = "remotefilejoin"
	Command_WaveInfo          = "waveinfo"

	Command_ConnStatus       = "connstatus"
	Command_WslStatus        = "wslstatus"
	Command_ConnEnsure       = "connensure"
	Command_ConnReinstallWsh = "connreinstallwsh"
	Command_ConnConnect      = "connconnect"
	Command_ConnDisconnect   = "conndisconnect"
	Command_ConnList         = "connlist"
	Command_WslList          = "wsllist"
	Command_WslDefaultDistro = "wsldefaultdistro"

	Command_WebSelector      = "webselector"
	Command_Notify           = "notify"
	Command_GetUpdateChannel = "getupdatechannel"

	Command_VDomCreateContext   = "vdomcreatecontext"
	Command_VDomAsyncInitiation = "vdomasyncinitiation"
	Command_VDomRender          = "vdomrender"
	Command_VDomUrlRequest      = "vdomurlrequest"
)

type RespOrErrorUnion[T any] struct {
	Response T
	Error    error
}

type WshRpcInterface interface {
	AuthenticateCommand(ctx context.Context, data string) (CommandAuthenticateRtnData, error)
	DisposeCommand(ctx context.Context, data CommandDisposeData) error
	RouteAnnounceCommand(ctx context.Context) error   // (special) announces a new route to the main router
	RouteUnannounceCommand(ctx context.Context) error // (special) unannounces a route to the main router

	MessageCommand(ctx context.Context, data CommandMessageData) error
	GetMetaCommand(ctx context.Context, data CommandGetMetaData) (waveobj.MetaMapType, error)
	SetMetaCommand(ctx context.Context, data CommandSetMetaData) error
	SetViewCommand(ctx context.Context, data CommandBlockSetViewData) error
	ControllerInputCommand(ctx context.Context, data CommandBlockInputData) error
	ControllerStopCommand(ctx context.Context, blockId string) error
	ControllerResyncCommand(ctx context.Context, data CommandControllerResyncData) error
	FileAppendCommand(ctx context.Context, data CommandFileData) error
	FileAppendIJsonCommand(ctx context.Context, data CommandAppendIJsonData) error
	ResolveIdsCommand(ctx context.Context, data CommandResolveIdsData) (CommandResolveIdsRtnData, error)
	CreateBlockCommand(ctx context.Context, data CommandCreateBlockData) (waveobj.ORef, error)
	CreateSubBlockCommand(ctx context.Context, data CommandCreateSubBlockData) (waveobj.ORef, error)
	DeleteBlockCommand(ctx context.Context, data CommandDeleteBlockData) error
	DeleteSubBlockCommand(ctx context.Context, data CommandDeleteBlockData) error
	WaitForRouteCommand(ctx context.Context, data CommandWaitForRouteData) (bool, error)
	FileWriteCommand(ctx context.Context, data CommandFileData) error
	FileReadCommand(ctx context.Context, data CommandFileData) (string, error)
	EventPublishCommand(ctx context.Context, data wps.WaveEvent) error
	EventSubCommand(ctx context.Context, data wps.SubscriptionRequest) error
	EventUnsubCommand(ctx context.Context, data string) error
	EventUnsubAllCommand(ctx context.Context) error
	EventReadHistoryCommand(ctx context.Context, data CommandEventReadHistoryData) ([]*wps.WaveEvent, error)
	StreamTestCommand(ctx context.Context) chan RespOrErrorUnion[int]
	StreamWaveAiCommand(ctx context.Context, request OpenAiStreamRequest) chan RespOrErrorUnion[OpenAIPacketType]
	StreamCpuDataCommand(ctx context.Context, request CpuDataRequest) chan RespOrErrorUnion[TimeSeriesData]
	TestCommand(ctx context.Context, data string) error
	SetConfigCommand(ctx context.Context, data wconfig.MetaSettingsType) error
	BlockInfoCommand(ctx context.Context, blockId string) (*BlockInfoData, error)
	WaveInfoCommand(ctx context.Context) (*WaveInfoData, error)

	// connection functions
	ConnStatusCommand(ctx context.Context) ([]ConnStatus, error)
	WslStatusCommand(ctx context.Context) ([]ConnStatus, error)
	ConnEnsureCommand(ctx context.Context, connName string) error
	ConnReinstallWshCommand(ctx context.Context, connName string) error
	ConnConnectCommand(ctx context.Context, connName string) error
	ConnDisconnectCommand(ctx context.Context, connName string) error
	ConnListCommand(ctx context.Context) ([]string, error)
	WslListCommand(ctx context.Context) ([]string, error)
	WslDefaultDistroCommand(ctx context.Context) (string, error)

	// eventrecv is special, it's handled internally by WshRpc with EventListener
	EventRecvCommand(ctx context.Context, data wps.WaveEvent) error

	// remotes
	RemoteStreamFileCommand(ctx context.Context, data CommandRemoteStreamFileData) chan RespOrErrorUnion[CommandRemoteStreamFileRtnData]
	RemoteFileInfoCommand(ctx context.Context, path string) (*FileInfo, error)
	RemoteFileDeleteCommand(ctx context.Context, path string) error
	RemoteWriteFileCommand(ctx context.Context, data CommandRemoteWriteFileData) error
	RemoteFileJoinCommand(ctx context.Context, paths []string) (*FileInfo, error)
	RemoteStreamCpuDataCommand(ctx context.Context) chan RespOrErrorUnion[TimeSeriesData]

	// emain
	WebSelectorCommand(ctx context.Context, data CommandWebSelectorData) ([]string, error)
	NotifyCommand(ctx context.Context, notificationOptions WaveNotificationOptions) error
	GetUpdateChannelCommand(ctx context.Context) (string, error)

	// terminal
	VDomCreateContextCommand(ctx context.Context, data vdom.VDomCreateContext) (*waveobj.ORef, error)
	VDomAsyncInitiationCommand(ctx context.Context, data vdom.VDomAsyncInitiationRequest) error

	// proc
	VDomRenderCommand(ctx context.Context, data vdom.VDomFrontendUpdate) chan RespOrErrorUnion[*vdom.VDomBackendUpdate]
	VDomUrlRequestCommand(ctx context.Context, data VDomUrlRequestData) chan RespOrErrorUnion[VDomUrlRequestResponse]
}

// for frontend
type WshServerCommandMeta struct {
	CommandType string `json:"commandtype"`
}

type RpcOpts struct {
	Timeout    int    `json:"timeout,omitempty"`
	NoResponse bool   `json:"noresponse,omitempty"`
	Route      string `json:"route,omitempty"`

	StreamCancelFn func() `json:"-"` // this is an *output* parameter, set by the handler
}

const (
	ClientType_ConnServer      = "connserver"
	ClientType_BlockController = "blockcontroller"
)

type RpcContext struct {
	ClientType string `json:"ctype,omitempty"`
	BlockId    string `json:"blockid,omitempty"`
	TabId      string `json:"tabid,omitempty"`
	Conn       string `json:"conn,omitempty"`
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
				field.Set(reflect.ValueOf(waveobj.MakeORef(waveobj.OType_Block, rpcContext.BlockId)))
			}
		default:
			log.Printf("invalid wshcontext tag: %q in type(%T)", tag, dataPtr)
		}
	}
}

type CommandAuthenticateRtnData struct {
	RouteId   string `json:"routeid"`
	AuthToken string `json:"authtoken,omitempty"`
}

type CommandDisposeData struct {
	RouteId string `json:"routeid"`
	// auth token travels in the packet directly
}

type CommandMessageData struct {
	ORef    waveobj.ORef `json:"oref" wshcontext:"BlockORef"`
	Message string       `json:"message"`
}

type CommandGetMetaData struct {
	ORef waveobj.ORef `json:"oref" wshcontext:"BlockORef"`
}

type CommandSetMetaData struct {
	ORef waveobj.ORef        `json:"oref" wshcontext:"BlockORef"`
	Meta waveobj.MetaMapType `json:"meta"`
}

type CommandResolveIdsData struct {
	BlockId string   `json:"blockid" wshcontext:"BlockId"`
	Ids     []string `json:"ids"`
}

type CommandResolveIdsRtnData struct {
	ResolvedIds map[string]waveobj.ORef `json:"resolvedids"`
}

type CommandCreateBlockData struct {
	TabId     string               `json:"tabid" wshcontext:"TabId"`
	BlockDef  *waveobj.BlockDef    `json:"blockdef"`
	RtOpts    *waveobj.RuntimeOpts `json:"rtopts,omitempty"`
	Magnified bool                 `json:"magnified,omitempty"`
}

type CommandCreateSubBlockData struct {
	ParentBlockId string            `json:"parentblockid"`
	BlockDef      *waveobj.BlockDef `json:"blockdef"`
}

type CommandBlockSetViewData struct {
	BlockId string `json:"blockid" wshcontext:"BlockId"`
	View    string `json:"view"`
}

type CommandControllerResyncData struct {
	ForceRestart bool                 `json:"forcerestart,omitempty"`
	TabId        string               `json:"tabid" wshcontext:"TabId"`
	BlockId      string               `json:"blockid" wshcontext:"BlockId"`
	RtOpts       *waveobj.RuntimeOpts `json:"rtopts,omitempty"`
}

type CommandBlockInputData struct {
	BlockId     string            `json:"blockid" wshcontext:"BlockId"`
	InputData64 string            `json:"inputdata64,omitempty"`
	SigName     string            `json:"signame,omitempty"`
	TermSize    *waveobj.TermSize `json:"termsize,omitempty"`
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

type CommandWaitForRouteData struct {
	RouteId string `json:"routeid"`
	WaitMs  int    `json:"waitms"`
}

type CommandDeleteBlockData struct {
	BlockId string `json:"blockid" wshcontext:"BlockId"`
}

type CommandEventReadHistoryData struct {
	Event    string `json:"event"`
	Scope    string `json:"scope"`
	MaxItems int    `json:"maxitems"`
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
	APIType    string `json:"apitype,omitempty"`
	APIToken   string `json:"apitoken"`
	OrgID      string `json:"orgid,omitempty"`
	APIVersion string `json:"apiversion,omitempty"`
	BaseURL    string `json:"baseurl,omitempty"`
	MaxTokens  int    `json:"maxtokens,omitempty"`
	MaxChoices int    `json:"maxchoices,omitempty"`
	TimeoutMs  int    `json:"timeoutms,omitempty"`
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
	Path     string      `json:"path"` // cleaned path (may have "~")
	Dir      string      `json:"dir"`  // returns the directory part of the path (if this is a a directory, it will be equal to Path).  "~" will be expanded, and separators will be normalized to "/"
	Name     string      `json:"name"`
	NotFound bool        `json:"notfound,omitempty"`
	Size     int64       `json:"size"`
	Mode     os.FileMode `json:"mode"`
	ModeStr  string      `json:"modestr"`
	ModTime  int64       `json:"modtime"`
	IsDir    bool        `json:"isdir,omitempty"`
	MimeType string      `json:"mimetype,omitempty"`
	ReadOnly bool        `json:"readonly,omitempty"` // this is not set for fileinfo's returned from directory listings
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

type ConnStatus struct {
	Status        string `json:"status"`
	Connection    string `json:"connection"`
	Connected     bool   `json:"connected"`
	HasConnected  bool   `json:"hasconnected"` // true if it has *ever* connected successfully
	ActiveConnNum int    `json:"activeconnnum"`
	Error         string `json:"error,omitempty"`
}

type WebSelectorOpts struct {
	All   bool `json:"all,omitempty"`
	Inner bool `json:"inner,omitempty"`
}

type CommandWebSelectorData struct {
	WindowId string           `json:"windowid"`
	BlockId  string           `json:"blockid" wshcontext:"BlockId"`
	TabId    string           `json:"tabid" wshcontext:"TabId"`
	Selector string           `json:"selector"`
	Opts     *WebSelectorOpts `json:"opts,omitempty"`
}

type BlockInfoData struct {
	BlockId  string         `json:"blockid"`
	TabId    string         `json:"tabid"`
	WindowId string         `json:"windowid"`
	Block    *waveobj.Block `json:"block"`
}

type WaveNotificationOptions struct {
	Title  string `json:"title,omitempty"`
	Body   string `json:"body,omitempty"`
	Silent bool   `json:"silent,omitempty"`
}

type VDomUrlRequestData struct {
	Method  string            `json:"method"`
	URL     string            `json:"url"`
	Headers map[string]string `json:"headers"`
	Body    []byte            `json:"body,omitempty"`
}

type VDomUrlRequestResponse struct {
	StatusCode int               `json:"statuscode,omitempty"`
	Headers    map[string]string `json:"headers,omitempty"`
	Body       []byte            `json:"body,omitempty"`
}

type WaveInfoData struct {
	Version   string `json:"version"`
	ClientId  string `json:"clientid"`
	BuildTime string `json:"buildtime"`
	ConfigDir string `json:"configdir"`
	DataDir   string `json:"datadir"`
}
