// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// types and methods for wsh rpc calls
package wshrpc

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"os"
	"reflect"

	"github.com/wavetermdev/waveterm/pkg/filestore"
	"github.com/wavetermdev/waveterm/pkg/ijson"
	"github.com/wavetermdev/waveterm/pkg/vdom"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
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
	Command_RemoteFileTouch   = "remotefiletouch"
	Command_RemoteWriteFile   = "remotewritefile"
	Command_RemoteFileDelete  = "remotefiledelete"
	Command_RemoteFileJoin    = "remotefilejoin"
	Command_WaveInfo          = "waveinfo"
	Command_WshActivity       = "wshactivity"
	Command_Activity          = "activity"
	Command_GetVar            = "getvar"
	Command_SetVar            = "setvar"
	Command_RemoteMkdir       = "remotemkdir"

	Command_ConnStatus       = "connstatus"
	Command_WslStatus        = "wslstatus"
	Command_ConnEnsure       = "connensure"
	Command_ConnReinstallWsh = "connreinstallwsh"
	Command_ConnConnect      = "connconnect"
	Command_ConnDisconnect   = "conndisconnect"
	Command_ConnList         = "connlist"
	Command_WslList          = "wsllist"
	Command_WslDefaultDistro = "wsldefaultdistro"

	Command_WorkspaceList = "workspacelist"

	Command_WebSelector      = "webselector"
	Command_Notify           = "notify"
	Command_FocusWindow      = "focuswindow"
	Command_GetUpdateChannel = "getupdatechannel"

	Command_VDomCreateContext   = "vdomcreatecontext"
	Command_VDomAsyncInitiation = "vdomasyncinitiation"
	Command_VDomRender          = "vdomrender"
	Command_VDomUrlRequest      = "vdomurlrequest"

	Command_AiSendMessage = "aisendmessage"
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
	ResolveIdsCommand(ctx context.Context, data CommandResolveIdsData) (CommandResolveIdsRtnData, error)
	CreateBlockCommand(ctx context.Context, data CommandCreateBlockData) (waveobj.ORef, error)
	CreateSubBlockCommand(ctx context.Context, data CommandCreateSubBlockData) (waveobj.ORef, error)
	DeleteBlockCommand(ctx context.Context, data CommandDeleteBlockData) error
	DeleteSubBlockCommand(ctx context.Context, data CommandDeleteBlockData) error
	WaitForRouteCommand(ctx context.Context, data CommandWaitForRouteData) (bool, error)
	FileCreateCommand(ctx context.Context, data CommandFileCreateData) error
	FileDeleteCommand(ctx context.Context, data CommandFileData) error
	FileAppendCommand(ctx context.Context, data CommandFileData) error
	FileAppendIJsonCommand(ctx context.Context, data CommandAppendIJsonData) error
	FileWriteCommand(ctx context.Context, data CommandFileData) error
	FileReadCommand(ctx context.Context, data CommandFileData) (string, error)
	FileInfoCommand(ctx context.Context, data CommandFileData) (*WaveFileInfo, error)
	FileListCommand(ctx context.Context, data CommandFileListData) ([]*WaveFileInfo, error)
	EventPublishCommand(ctx context.Context, data wps.WaveEvent) error
	EventSubCommand(ctx context.Context, data wps.SubscriptionRequest) error
	EventUnsubCommand(ctx context.Context, data string) error
	EventUnsubAllCommand(ctx context.Context) error
	EventReadHistoryCommand(ctx context.Context, data CommandEventReadHistoryData) ([]*wps.WaveEvent, error)
	StreamTestCommand(ctx context.Context) chan RespOrErrorUnion[int]
	StreamWaveAiCommand(ctx context.Context, request OpenAiStreamRequest) chan RespOrErrorUnion[OpenAIPacketType]
	StreamCpuDataCommand(ctx context.Context, request CpuDataRequest) chan RespOrErrorUnion[TimeSeriesData]
	TestCommand(ctx context.Context, data string) error
	SetConfigCommand(ctx context.Context, data MetaSettingsType) error
	BlockInfoCommand(ctx context.Context, blockId string) (*BlockInfoData, error)
	WaveInfoCommand(ctx context.Context) (*WaveInfoData, error)
	WshActivityCommand(ct context.Context, data map[string]int) error
	ActivityCommand(ctx context.Context, data ActivityUpdate) error
	GetVarCommand(ctx context.Context, data CommandVarData) (*CommandVarResponseData, error)
	SetVarCommand(ctx context.Context, data CommandVarData) error

	// connection functions
	ConnStatusCommand(ctx context.Context) ([]ConnStatus, error)
	WslStatusCommand(ctx context.Context) ([]ConnStatus, error)
	ConnEnsureCommand(ctx context.Context, connName string) error
	ConnReinstallWshCommand(ctx context.Context, connName string) error
	ConnConnectCommand(ctx context.Context, connRequest ConnRequest) error
	ConnDisconnectCommand(ctx context.Context, connName string) error
	ConnListCommand(ctx context.Context) ([]string, error)
	WslListCommand(ctx context.Context) ([]string, error)
	WslDefaultDistroCommand(ctx context.Context) (string, error)

	// eventrecv is special, it's handled internally by WshRpc with EventListener
	EventRecvCommand(ctx context.Context, data wps.WaveEvent) error

	// remotes
	RemoteStreamFileCommand(ctx context.Context, data CommandRemoteStreamFileData) chan RespOrErrorUnion[CommandRemoteStreamFileRtnData]
	RemoteFileInfoCommand(ctx context.Context, path string) (*FileInfo, error)
	RemoteFileTouchCommand(ctx context.Context, path string) error
	RemoteFileRenameCommand(ctx context.Context, pathTuple [2]string) error
	RemoteFileDeleteCommand(ctx context.Context, path string) error
	RemoteWriteFileCommand(ctx context.Context, data CommandRemoteWriteFileData) error
	RemoteFileJoinCommand(ctx context.Context, paths []string) (*FileInfo, error)
	RemoteMkdirCommand(ctx context.Context, path string) error
	RemoteStreamCpuDataCommand(ctx context.Context) chan RespOrErrorUnion[TimeSeriesData]

	// emain
	WebSelectorCommand(ctx context.Context, data CommandWebSelectorData) ([]string, error)
	NotifyCommand(ctx context.Context, notificationOptions WaveNotificationOptions) error
	FocusWindowCommand(ctx context.Context, windowId string) error

	WorkspaceListCommand(ctx context.Context) ([]WorkspaceInfoData, error)
	GetUpdateChannelCommand(ctx context.Context) (string, error)

	// terminal
	VDomCreateContextCommand(ctx context.Context, data vdom.VDomCreateContext) (*waveobj.ORef, error)
	VDomAsyncInitiationCommand(ctx context.Context, data vdom.VDomAsyncInitiationRequest) error

	// ai
	AiSendMessageCommand(ctx context.Context, data AiMessageData) error

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

type CommandFileDataAt struct {
	Offset int64 `json:"offset"`
	Size   int64 `json:"size,omitempty"`
}

type CommandFileData struct {
	ZoneId   string             `json:"zoneid" wshcontext:"BlockId"`
	FileName string             `json:"filename"`
	Data64   string             `json:"data64,omitempty"`
	At       *CommandFileDataAt `json:"at,omitempty"` // if set, this turns read/write ops to ReadAt/WriteAt ops (len is only used for ReadAt)
}

type WaveFileInfo struct {
	ZoneId    string                 `json:"zoneid"`
	Name      string                 `json:"name"`
	Opts      filestore.FileOptsType `json:"opts,omitempty"`
	Size      int64                  `json:"size,omitempty"`
	CreatedTs int64                  `json:"createdts,omitempty"`
	ModTs     int64                  `json:"modts,omitempty"`
	Meta      map[string]any         `json:"meta,omitempty"`
	IsDir     bool                   `json:"isdir,omitempty"`
}

type CommandFileListData struct {
	ZoneId string `json:"zoneid"`
	Prefix string `json:"prefix,omitempty"`
	All    bool   `json:"all,omitempty"`
	Offset int    `json:"offset,omitempty"`
	Limit  int    `json:"limit,omitempty"`
}

type CommandFileCreateData struct {
	ZoneId   string                  `json:"zoneid"`
	FileName string                  `json:"filename"`
	Meta     map[string]any          `json:"meta,omitempty"`
	Opts     *filestore.FileOptsType `json:"opts,omitempty"`
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

type ConnKeywords struct {
	ConnWshEnabled          *bool `json:"conn:wshenabled,omitempty"`
	ConnAskBeforeWshInstall *bool `json:"conn:askbeforewshinstall,omitempty"`

	DisplayHidden *bool   `json:"display:hidden,omitempty"`
	DisplayOrder  float32 `json:"display:order,omitempty"`

	TermClear      bool    `json:"term:*,omitempty"`
	TermFontSize   float64 `json:"term:fontsize,omitempty"`
	TermFontFamily string  `json:"term:fontfamily,omitempty"`
	TermTheme      string  `json:"term:theme,omitempty"`

	SshUser                         string   `json:"ssh:user,omitempty"`
	SshHostName                     string   `json:"ssh:hostname,omitempty"`
	SshPort                         string   `json:"ssh:port,omitempty"`
	SshIdentityFile                 []string `json:"ssh:identityfile,omitempty"`
	SshBatchMode                    bool     `json:"ssh:batchmode,omitempty"`
	SshPubkeyAuthentication         bool     `json:"ssh:pubkeyauthentication,omitempty"`
	SshPasswordAuthentication       bool     `json:"ssh:passwordauthentication,omitempty"`
	SshKbdInteractiveAuthentication bool     `json:"ssh:kbdinteractiveauthentication,omitempty"`
	SshPreferredAuthentications     []string `json:"ssh:preferredauthentications,omitempty"`
	SshAddKeysToAgent               bool     `json:"ssh:addkeystoagent,omitempty"`
	SshIdentityAgent                string   `json:"ssh:identityagent,omitempty"`
	SshProxyJump                    []string `json:"ssh:proxyjump,omitempty"`
	SshUserKnownHostsFile           []string `json:"ssh:userknownhostsfile,omitempty"`
	SshGlobalKnownHostsFile         []string `json:"ssh:globalknownhostsfile,omitempty"`
}

type ConnRequest struct {
	Host     string       `json:"host"`
	Keywords ConnKeywords `json:"keywords,omitempty"`
}

const (
	TimeSeries_Cpu = "cpu"
)

type TimeSeriesData struct {
	Ts     int64              `json:"ts"`
	Values map[string]float64 `json:"values"`
}

type MetaSettingsType struct {
	waveobj.MetaMapType
}

func (m *MetaSettingsType) UnmarshalJSON(data []byte) error {
	var metaMap waveobj.MetaMapType
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	if err := decoder.Decode(&metaMap); err != nil {
		return err
	}
	*m = MetaSettingsType{MetaMapType: metaMap}
	return nil
}

func (m MetaSettingsType) MarshalJSON() ([]byte, error) {
	return json.Marshal(m.MetaMapType)
}

type ConnStatus struct {
	Status        string `json:"status"`
	WshEnabled    bool   `json:"wshenabled"`
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
	WorkspaceId string           `json:"workspaceid"`
	BlockId     string           `json:"blockid" wshcontext:"BlockId"`
	TabId       string           `json:"tabid" wshcontext:"TabId"`
	Selector    string           `json:"selector"`
	Opts        *WebSelectorOpts `json:"opts,omitempty"`
}

type BlockInfoData struct {
	BlockId     string                `json:"blockid"`
	TabId       string                `json:"tabid"`
	WorkspaceId string                `json:"workspaceid"`
	Block       *waveobj.Block        `json:"block"`
	Files       []*filestore.WaveFile `json:"files"`
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

type WorkspaceInfoData struct {
	WindowId      string             `json:"windowid"`
	WorkspaceData *waveobj.Workspace `json:"workspacedata"`
}

type AiMessageData struct {
	Message string `json:"message,omitempty"`
}

type CommandVarData struct {
	Key      string `json:"key"`
	Val      string `json:"val,omitempty"`
	Remove   bool   `json:"remove,omitempty"`
	ZoneId   string `json:"zoneid"`
	FileName string `json:"filename"`
}

type CommandVarResponseData struct {
	Key    string `json:"key"`
	Val    string `json:"val"`
	Exists bool   `json:"exists"`
}

type ActivityDisplayType struct {
	Width    int     `json:"width"`
	Height   int     `json:"height"`
	DPR      float64 `json:"dpr"`
	Internal bool    `json:"internal,omitempty"`
}

type ActivityUpdate struct {
	FgMinutes     int                   `json:"fgminutes,omitempty"`
	ActiveMinutes int                   `json:"activeminutes,omitempty"`
	OpenMinutes   int                   `json:"openminutes,omitempty"`
	NumTabs       int                   `json:"numtabs,omitempty"`
	NewTab        int                   `json:"newtab,omitempty"`
	NumBlocks     int                   `json:"numblocks,omitempty"`
	NumWindows    int                   `json:"numwindows,omitempty"`
	NumWS         int                   `json:"numws,omitempty"`
	NumWSNamed    int                   `json:"numwsnamed,omitempty"`
	NumSSHConn    int                   `json:"numsshconn,omitempty"`
	NumWSLConn    int                   `json:"numwslconn,omitempty"`
	NumMagnify    int                   `json:"nummagnify,omitempty"`
	NumPanics     int                   `json:"numpanics,omitempty"`
	NumAIReqs     int                   `json:"numaireqs,omitempty"`
	Startup       int                   `json:"startup,omitempty"`
	Shutdown      int                   `json:"shutdown,omitempty"`
	SetTabTheme   int                   `json:"settabtheme,omitempty"`
	BuildTime     string                `json:"buildtime,omitempty"`
	Displays      []ActivityDisplayType `json:"displays,omitempty"`
	Renderers     map[string]int        `json:"renderers,omitempty"`
	Blocks        map[string]int        `json:"blocks,omitempty"`
	WshCmds       map[string]int        `json:"wshcmds,omitempty"`
	Conn          map[string]int        `json:"conn,omitempty"`
}
