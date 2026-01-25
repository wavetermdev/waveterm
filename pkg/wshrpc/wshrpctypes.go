// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// types and methods for wsh rpc calls
package wshrpc

import (
	"bytes"
	"context"
	"encoding/json"

	"github.com/wavetermdev/waveterm/pkg/aiusechat/uctypes"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wps"
)

type RespOrErrorUnion[T any] struct {
	Response T
	Error    error
}

// Instructions for adding a new RPC call
// * methods must end with Command
// * methods must take context as their first parameter
// * methods may take up to one parameter, and may return either just an error, or one return value plus an error
// * after modifying WshRpcInterface, run `task generate` to regnerate bindings

type WshRpcInterface interface {
	AuthenticateCommand(ctx context.Context, data string) (CommandAuthenticateRtnData, error)
	AuthenticateTokenCommand(ctx context.Context, data CommandAuthenticateTokenData) (CommandAuthenticateRtnData, error)
	AuthenticateTokenVerifyCommand(ctx context.Context, data CommandAuthenticateTokenData) (CommandAuthenticateRtnData, error) // (special) validates token without binding, root router only
	AuthenticateJobManagerCommand(ctx context.Context, data CommandAuthenticateJobManagerData) error
	AuthenticateJobManagerVerifyCommand(ctx context.Context, data CommandAuthenticateJobManagerData) error // (special) validates job auth token without binding, root router only
	DisposeCommand(ctx context.Context, data CommandDisposeData) error
	RouteAnnounceCommand(ctx context.Context) error   // (special) announces a new route to the main router
	RouteUnannounceCommand(ctx context.Context) error // (special) unannounces a route to the main router
	SetPeerInfoCommand(ctx context.Context, peerInfo string) error
	GetJwtPublicKeyCommand(ctx context.Context) (string, error) // (special) gets the public JWT signing key

	MessageCommand(ctx context.Context, data CommandMessageData) error
	GetMetaCommand(ctx context.Context, data CommandGetMetaData) (waveobj.MetaMapType, error)
	SetMetaCommand(ctx context.Context, data CommandSetMetaData) error
	ControllerInputCommand(ctx context.Context, data CommandBlockInputData) error
	ControllerStopCommand(ctx context.Context, blockId string) error
	ControllerResyncCommand(ctx context.Context, data CommandControllerResyncData) error
	ControllerAppendOutputCommand(ctx context.Context, data CommandControllerAppendOutputData) error
	ResolveIdsCommand(ctx context.Context, data CommandResolveIdsData) (CommandResolveIdsRtnData, error)
	CreateBlockCommand(ctx context.Context, data CommandCreateBlockData) (waveobj.ORef, error)
	CreateSubBlockCommand(ctx context.Context, data CommandCreateSubBlockData) (waveobj.ORef, error)
	DeleteBlockCommand(ctx context.Context, data CommandDeleteBlockData) error
	DeleteSubBlockCommand(ctx context.Context, data CommandDeleteBlockData) error
	WaitForRouteCommand(ctx context.Context, data CommandWaitForRouteData) (bool, error)

	EventPublishCommand(ctx context.Context, data wps.WaveEvent) error
	EventSubCommand(ctx context.Context, data wps.SubscriptionRequest) error
	EventUnsubCommand(ctx context.Context, data string) error
	EventUnsubAllCommand(ctx context.Context) error
	EventReadHistoryCommand(ctx context.Context, data CommandEventReadHistoryData) ([]*wps.WaveEvent, error)

	FileRestoreBackupCommand(ctx context.Context, data CommandFileRestoreBackupData) error
	GetTempDirCommand(ctx context.Context, data CommandGetTempDirData) (string, error)
	WriteTempFileCommand(ctx context.Context, data CommandWriteTempFileData) (string, error)
	StreamTestCommand(ctx context.Context) chan RespOrErrorUnion[int]
	StreamWaveAiCommand(ctx context.Context, request WaveAIStreamRequest) chan RespOrErrorUnion[WaveAIPacketType]
	StreamCpuDataCommand(ctx context.Context, request CpuDataRequest) chan RespOrErrorUnion[TimeSeriesData]
	TestCommand(ctx context.Context, data string) error
	SetConfigCommand(ctx context.Context, data MetaSettingsType) error
	SetConnectionsConfigCommand(ctx context.Context, data ConnConfigRequest) error
	GetFullConfigCommand(ctx context.Context) (wconfig.FullConfigType, error)
	GetWaveAIModeConfigCommand(ctx context.Context) (wconfig.AIModeConfigUpdate, error)
	BlockInfoCommand(ctx context.Context, blockId string) (*BlockInfoData, error)
	BlocksListCommand(ctx context.Context, data BlocksListRequest) ([]BlocksListEntry, error)
	WaveInfoCommand(ctx context.Context) (*WaveInfoData, error)
	WshActivityCommand(ct context.Context, data map[string]int) error
	ActivityCommand(ctx context.Context, data ActivityUpdate) error
	GetVarCommand(ctx context.Context, data CommandVarData) (*CommandVarResponseData, error)
	SetVarCommand(ctx context.Context, data CommandVarData) error
	PathCommand(ctx context.Context, data PathCommandData) (string, error)
	FetchSuggestionsCommand(ctx context.Context, data FetchSuggestionsData) (*FetchSuggestionsResponse, error)
	DisposeSuggestionsCommand(ctx context.Context, widgetId string) error
	GetTabCommand(ctx context.Context, tabId string) (*waveobj.Tab, error)

	// connection functions
	ConnStatusCommand(ctx context.Context) ([]ConnStatus, error)
	WslStatusCommand(ctx context.Context) ([]ConnStatus, error)
	ConnEnsureCommand(ctx context.Context, data ConnExtData) error
	ConnReinstallWshCommand(ctx context.Context, data ConnExtData) error
	ConnConnectCommand(ctx context.Context, connRequest ConnRequest) error
	ConnDisconnectCommand(ctx context.Context, connName string) error
	ConnListCommand(ctx context.Context) ([]string, error)
	ConnListAWSCommand(ctx context.Context) ([]string, error)
	WslListCommand(ctx context.Context) ([]string, error)
	WslDefaultDistroCommand(ctx context.Context) (string, error)
	DismissWshFailCommand(ctx context.Context, connName string) error
	ConnUpdateWshCommand(ctx context.Context, remoteInfo RemoteInfo) (bool, error)
	FindGitBashCommand(ctx context.Context, rescan bool) (string, error)
	DetectAvailableShellsCommand(ctx context.Context, data DetectShellsRequest) (DetectShellsResponse, error)

	// eventrecv is special, it's handled internally by WshRpc with EventListener
	EventRecvCommand(ctx context.Context, data wps.WaveEvent) error

	// remotes
	WshRpcRemoteFileInterface
	RemoteStreamCpuDataCommand(ctx context.Context) chan RespOrErrorUnion[TimeSeriesData]
	RemoteGetInfoCommand(ctx context.Context) (RemoteInfo, error)
	RemoteInstallRcFilesCommand(ctx context.Context) error
	RemoteStartJobCommand(ctx context.Context, data CommandRemoteStartJobData) (*CommandStartJobRtnData, error)
	RemoteReconnectToJobManagerCommand(ctx context.Context, data CommandRemoteReconnectToJobManagerData) (*CommandRemoteReconnectToJobManagerRtnData, error)
	RemoteDisconnectFromJobManagerCommand(ctx context.Context, data CommandRemoteDisconnectFromJobManagerData) error
	RemoteTerminateJobManagerCommand(ctx context.Context, data CommandRemoteTerminateJobManagerData) error

	// emain
	WebSelectorCommand(ctx context.Context, data CommandWebSelectorData) ([]string, error)
	NotifyCommand(ctx context.Context, notificationOptions WaveNotificationOptions) error
	FocusWindowCommand(ctx context.Context, windowId string) error
	ElectronEncryptCommand(ctx context.Context, data CommandElectronEncryptData) (*CommandElectronEncryptRtnData, error)
	ElectronDecryptCommand(ctx context.Context, data CommandElectronDecryptData) (*CommandElectronDecryptRtnData, error)
	NetworkOnlineCommand(ctx context.Context) (bool, error)

	// secrets
	GetSecretsCommand(ctx context.Context, names []string) (map[string]string, error)
	GetSecretsNamesCommand(ctx context.Context) ([]string, error)
	SetSecretsCommand(ctx context.Context, secrets map[string]*string) error
	GetSecretsLinuxStorageBackendCommand(ctx context.Context) (string, error)

	WorkspaceListCommand(ctx context.Context) ([]WorkspaceInfoData, error)
	GetUpdateChannelCommand(ctx context.Context) (string, error)

	// ai
	AiSendMessageCommand(ctx context.Context, data AiMessageData) error
	GetWaveAIChatCommand(ctx context.Context, data CommandGetWaveAIChatData) (*uctypes.UIChat, error)
	GetWaveAIRateLimitCommand(ctx context.Context) (*uctypes.RateLimitInfo, error)
	WaveAIToolApproveCommand(ctx context.Context, data CommandWaveAIToolApproveData) error
	WaveAIAddContextCommand(ctx context.Context, data CommandWaveAIAddContextData) error
	WaveAIGetToolDiffCommand(ctx context.Context, data CommandWaveAIGetToolDiffData) (*CommandWaveAIGetToolDiffRtnData, error)

	// screenshot
	CaptureBlockScreenshotCommand(ctx context.Context, data CommandCaptureBlockScreenshotData) (string, error)

	// rtinfo
	GetRTInfoCommand(ctx context.Context, data CommandGetRTInfoData) (*waveobj.ObjRTInfo, error)
	SetRTInfoCommand(ctx context.Context, data CommandSetRTInfoData) error

	// terminal
	TermGetScrollbackLinesCommand(ctx context.Context, data CommandTermGetScrollbackLinesData) (*CommandTermGetScrollbackLinesRtnData, error)
	TermUpdateAttachedJobCommand(ctx context.Context, data CommandTermUpdateAttachedJobData) error

	// file
	WshRpcFileInterface

	// streams
	StreamDataCommand(ctx context.Context, data CommandStreamData) error
	StreamDataAckCommand(ctx context.Context, data CommandStreamAckData) error

	// jobs
	AuthenticateToJobManagerCommand(ctx context.Context, data CommandAuthenticateToJobData) error
	StartJobCommand(ctx context.Context, data CommandStartJobData) (*CommandStartJobRtnData, error)
	JobPrepareConnectCommand(ctx context.Context, data CommandJobPrepareConnectData) (*CommandJobConnectRtnData, error)
	JobStartStreamCommand(ctx context.Context, data CommandJobStartStreamData) error
	JobInputCommand(ctx context.Context, data CommandJobInputData) error
	JobCmdExitedCommand(ctx context.Context, data CommandJobCmdExitedData) error // this is sent FROM the job manager => main server

	// job controller
	JobControllerDeleteJobCommand(ctx context.Context, jobId string) error
	JobControllerListCommand(ctx context.Context) ([]*waveobj.Job, error)
	JobControllerStartJobCommand(ctx context.Context, data CommandJobControllerStartJobData) (string, error)
	JobControllerExitJobCommand(ctx context.Context, jobId string) error
	JobControllerDisconnectJobCommand(ctx context.Context, jobId string) error
	JobControllerReconnectJobCommand(ctx context.Context, jobId string) error
	JobControllerReconnectJobsForConnCommand(ctx context.Context, connName string) error
	JobControllerConnectedJobsCommand(ctx context.Context) ([]string, error)
	JobControllerAttachJobCommand(ctx context.Context, data CommandJobControllerAttachJobData) error
	JobControllerDetachJobCommand(ctx context.Context, jobId string) error

	// OMP (Oh-My-Posh) integration
	OmpGetConfigInfoCommand(ctx context.Context) (CommandOmpGetConfigInfoRtnData, error)
	OmpWritePaletteCommand(ctx context.Context, data CommandOmpWritePaletteData) (CommandOmpWritePaletteRtnData, error)
	OmpAnalyzeCommand(ctx context.Context, data CommandOmpAnalyzeData) (CommandOmpAnalyzeRtnData, error)
	OmpApplyHighContrastCommand(ctx context.Context, data CommandOmpApplyHighContrastData) (CommandOmpApplyHighContrastRtnData, error)
	OmpRestoreBackupCommand(ctx context.Context, data CommandOmpRestoreBackupData) (CommandOmpRestoreBackupRtnData, error)

	// OMP Configurator - Full config read/write
	OmpReadConfigCommand(ctx context.Context) (CommandOmpReadConfigRtnData, error)
	OmpWriteConfigCommand(ctx context.Context, data CommandOmpWriteConfigData) (CommandOmpWriteConfigRtnData, error)
}

// for frontend
type WshServerCommandMeta struct {
	CommandType string `json:"commandtype"`
}

type RpcOpts struct {
	Timeout    int64  `json:"timeout,omitempty"`
	NoResponse bool   `json:"noresponse,omitempty"`
	Route      string `json:"route,omitempty"`

	StreamCancelFn func(context.Context) error `json:"-"` // this is an *output* parameter, set by the handler
}

type RpcContext struct {
	SockName string `json:"sockname,omitempty"` // the domain socket name
	RouteId  string `json:"routeid"`            // the routeid from the jwt
	BlockId  string `json:"blockid,omitempty"`  // blockid for this rpc
	Conn     string `json:"conn,omitempty"`     // the conn name
	IsRouter bool   `json:"isrouter,omitempty"` // if this is for a sub-router
}

type CommandAuthenticateRtnData struct {
	// these fields are only set when doing a token swap
	Env            map[string]string `json:"env,omitempty"`
	InitScriptText string            `json:"initscripttext,omitempty"`
	RpcContext     *RpcContext       `json:"rpccontext,omitempty"`
}

type CommandAuthenticateTokenData struct {
	Token string `json:"token"`
}

type CommandDisposeData struct {
	RouteId string `json:"routeid"`
	// auth token travels in the packet directly
}

type CommandMessageData struct {
	Message string `json:"message"`
}

type CommandGetMetaData struct {
	ORef waveobj.ORef `json:"oref"`
}

type CommandSetMetaData struct {
	ORef waveobj.ORef        `json:"oref"`
	Meta waveobj.MetaMapType `json:"meta"`
}

type CommandResolveIdsData struct {
	BlockId string   `json:"blockid"`
	Ids     []string `json:"ids"`
}

type CommandResolveIdsRtnData struct {
	ResolvedIds map[string]waveobj.ORef `json:"resolvedids"`
}

type CommandCreateBlockData struct {
	TabId         string               `json:"tabid"`
	BlockDef      *waveobj.BlockDef    `json:"blockdef"`
	RtOpts        *waveobj.RuntimeOpts `json:"rtopts,omitempty"`
	Magnified     bool                 `json:"magnified,omitempty"`
	Ephemeral     bool                 `json:"ephemeral,omitempty"`
	Focused       bool                 `json:"focused,omitempty"`
	TargetBlockId string               `json:"targetblockid,omitempty"`
	TargetAction  string               `json:"targetaction,omitempty"` // "replace", "splitright", "splitdown", "splitleft", "splitup"
}

type CommandCreateSubBlockData struct {
	ParentBlockId string            `json:"parentblockid"`
	BlockDef      *waveobj.BlockDef `json:"blockdef"`
}

type CommandControllerResyncData struct {
	ForceRestart bool                 `json:"forcerestart,omitempty"`
	TabId        string               `json:"tabid"`
	BlockId      string               `json:"blockid"`
	RtOpts       *waveobj.RuntimeOpts `json:"rtopts,omitempty"`
}

type CommandControllerAppendOutputData struct {
	BlockId string `json:"blockid"`
	Data64  string `json:"data64"`
}

type CommandBlockInputData struct {
	BlockId     string            `json:"blockid"`
	InputData64 string            `json:"inputdata64,omitempty"`
	SigName     string            `json:"signame,omitempty"`
	TermSize    *waveobj.TermSize `json:"termsize,omitempty"`
}

type CommandJobInputData struct {
	JobId       string            `json:"jobid"`
	InputData64 string            `json:"inputdata64,omitempty"`
	SigName     string            `json:"signame,omitempty"`
	TermSize    *waveobj.TermSize `json:"termsize,omitempty"`
}

type CommandWaitForRouteData struct {
	RouteId string `json:"routeid"`
	WaitMs  int    `json:"waitms"`
}

type CommandDeleteBlockData struct {
	BlockId string `json:"blockid"`
}

type CommandEventReadHistoryData struct {
	Event    string `json:"event"`
	Scope    string `json:"scope"`
	MaxItems int    `json:"maxitems"`
}

type WaveAIStreamRequest struct {
	ClientId string                    `json:"clientid,omitempty"`
	Opts     *WaveAIOptsType           `json:"opts"`
	Prompt   []WaveAIPromptMessageType `json:"prompt"`
}

type WaveAIPromptMessageType struct {
	Role    string `json:"role"`
	Content string `json:"content"`
	Name    string `json:"name,omitempty"`
}

type WaveAIOptsType struct {
	Model      string `json:"model"`
	APIType    string `json:"apitype,omitempty"`
	APIToken   string `json:"apitoken"`
	OrgID      string `json:"orgid,omitempty"`
	APIVersion string `json:"apiversion,omitempty"`
	BaseURL    string `json:"baseurl,omitempty"`
	ProxyURL   string `json:"proxyurl,omitempty"`
	MaxTokens  int    `json:"maxtokens,omitempty"`
	MaxChoices int    `json:"maxchoices,omitempty"`
	TimeoutMs  int    `json:"timeoutms,omitempty"`
}

type WaveAIPacketType struct {
	Type         string           `json:"type"`
	Model        string           `json:"model,omitempty"`
	Created      int64            `json:"created,omitempty"`
	FinishReason string           `json:"finish_reason,omitempty"`
	Usage        *WaveAIUsageType `json:"usage,omitempty"`
	Index        int              `json:"index,omitempty"`
	Text         string           `json:"text,omitempty"`
	Error        string           `json:"error,omitempty"`
}

type WaveAIUsageType struct {
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

type CommandFileRestoreBackupData struct {
	BackupFilePath    string `json:"backupfilepath"`
	RestoreToFileName string `json:"restoretofilename"`
}

type CommandGetTempDirData struct {
	FileName string `json:"filename,omitempty"`
}

type CommandWriteTempFileData struct {
	FileName string `json:"filename"`
	Data64   string `json:"data64"`
}

type ConnRequest struct {
	Host       string               `json:"host"`
	Keywords   wconfig.ConnKeywords `json:"keywords,omitempty"`
	LogBlockId string               `json:"logblockid,omitempty"`
}

type RemoteInfo struct {
	ClientArch    string `json:"clientarch"`
	ClientOs      string `json:"clientos"`
	ClientVersion string `json:"clientversion"`
	Shell         string `json:"shell"`
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

type ConnConfigRequest struct {
	Host        string              `json:"host"`
	MetaMapType waveobj.MetaMapType `json:"metamaptype"`
}

type ConnStatus struct {
	Status        string `json:"status"`
	WshEnabled    bool   `json:"wshenabled"`
	Connection    string `json:"connection"`
	Connected     bool   `json:"connected"`
	HasConnected  bool   `json:"hasconnected"` // true if it has *ever* connected successfully
	ActiveConnNum int    `json:"activeconnnum"`
	Error         string `json:"error,omitempty"`
	WshError      string `json:"wsherror,omitempty"`
	NoWshReason   string `json:"nowshreason,omitempty"`
	WshVersion    string `json:"wshversion,omitempty"`
}

type WebSelectorOpts struct {
	All   bool `json:"all,omitempty"`
	Inner bool `json:"inner,omitempty"`
}

type CommandWebSelectorData struct {
	WorkspaceId string           `json:"workspaceid"`
	BlockId     string           `json:"blockid"`
	TabId       string           `json:"tabid"`
	Selector    string           `json:"selector"`
	Opts        *WebSelectorOpts `json:"opts,omitempty"`
}

type BlockInfoData struct {
	BlockId     string         `json:"blockid"`
	TabId       string         `json:"tabid"`
	WorkspaceId string         `json:"workspaceid"`
	Block       *waveobj.Block `json:"block"`
	Files       []*FileInfo    `json:"files"`
}

type WaveNotificationOptions struct {
	Title  string `json:"title,omitempty"`
	Body   string `json:"body,omitempty"`
	Silent bool   `json:"silent,omitempty"`
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

type BlocksListRequest struct {
	WindowId    string `json:"windowid,omitempty"`
	WorkspaceId string `json:"workspaceid,omitempty"`
}

type BlocksListEntry struct {
	WindowId    string              `json:"windowid"`
	WorkspaceId string              `json:"workspaceid"`
	TabId       string              `json:"tabid"`
	BlockId     string              `json:"blockid"`
	Meta        waveobj.MetaMapType `json:"meta"`
}

type AiMessageData struct {
	Message string `json:"message,omitempty"`
}

type CommandGetWaveAIChatData struct {
	ChatId string `json:"chatid"`
}

type CommandWaveAIToolApproveData struct {
	ToolCallId string `json:"toolcallid"`
	Approval   string `json:"approval,omitempty"`
}

type AIAttachedFile struct {
	Name   string `json:"name"`
	Type   string `json:"type"`
	Size   int    `json:"size"`
	Data64 string `json:"data64"`
}

type CommandWaveAIAddContextData struct {
	Files   []AIAttachedFile `json:"files,omitempty"`
	Text    string           `json:"text,omitempty"`
	Submit  bool             `json:"submit,omitempty"`
	NewChat bool             `json:"newchat,omitempty"`
}

type CommandWaveAIGetToolDiffData struct {
	ChatId     string `json:"chatid"`
	ToolCallId string `json:"toolcallid"`
}

type CommandWaveAIGetToolDiffRtnData struct {
	OriginalContents64 string `json:"originalcontents64"`
	ModifiedContents64 string `json:"modifiedcontents64"`
}

type CommandCaptureBlockScreenshotData struct {
	BlockId string `json:"blockid"`
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

type PathCommandData struct {
	PathType     string `json:"pathtype"`
	Open         bool   `json:"open"`
	OpenExternal bool   `json:"openexternal"`
	TabId        string `json:"tabid"`
}

type ActivityDisplayType struct {
	Width    int     `json:"width"`
	Height   int     `json:"height"`
	DPR      float64 `json:"dpr"`
	Internal bool    `json:"internal,omitempty"`
}

type ActivityUpdate struct {
	FgMinutes           int                   `json:"fgminutes,omitempty"`
	ActiveMinutes       int                   `json:"activeminutes,omitempty"`
	OpenMinutes         int                   `json:"openminutes,omitempty"`
	WaveAIFgMinutes     int                   `json:"waveaifgminutes,omitempty"`
	WaveAIActiveMinutes int                   `json:"waveaiactiveminutes,omitempty"`
	NumTabs             int                   `json:"numtabs,omitempty"`
	NewTab              int                   `json:"newtab,omitempty"`
	NumBlocks           int                   `json:"numblocks,omitempty"`
	NumWindows          int                   `json:"numwindows,omitempty"`
	NumWS               int                   `json:"numws,omitempty"`
	NumWSNamed          int                   `json:"numwsnamed,omitempty"`
	NumSSHConn          int                   `json:"numsshconn,omitempty"`
	NumWSLConn          int                   `json:"numwslconn,omitempty"`
	NumMagnify          int                   `json:"nummagnify,omitempty"`
	TermCommandsRun     int                   `json:"termcommandsrun,omitempty"`
	NumPanics           int                   `json:"numpanics,omitempty"`
	NumAIReqs           int                   `json:"numaireqs,omitempty"`
	Startup             int                   `json:"startup,omitempty"`
	Shutdown            int                   `json:"shutdown,omitempty"`
	SetTabTheme         int                   `json:"settabtheme,omitempty"`
	BuildTime           string                `json:"buildtime,omitempty"`
	Displays            []ActivityDisplayType `json:"displays,omitempty"`
	Renderers           map[string]int        `json:"renderers,omitempty"`
	Blocks              map[string]int        `json:"blocks,omitempty"`
	WshCmds             map[string]int        `json:"wshcmds,omitempty"`
	Conn                map[string]int        `json:"conn,omitempty"`
}

type ConnExtData struct {
	ConnName   string `json:"connname"`
	LogBlockId string `json:"logblockid,omitempty"`
}

type FetchSuggestionsData struct {
	SuggestionType string `json:"suggestiontype"`
	Query          string `json:"query"`
	WidgetId       string `json:"widgetid"`
	ReqNum         int    `json:"reqnum"`
	FileCwd        string `json:"file:cwd,omitempty"`
	FileDirOnly    bool   `json:"file:dironly,omitempty"`
	FileConnection string `json:"file:connection,omitempty"`
}

type FetchSuggestionsResponse struct {
	ReqNum      int              `json:"reqnum"`
	Suggestions []SuggestionType `json:"suggestions"`
}

type SuggestionType struct {
	Type         string `json:"type"`
	SuggestionId string `json:"suggestionid"`
	Display      string `json:"display"`
	SubText      string `json:"subtext,omitempty"`
	Icon         string `json:"icon,omitempty"`
	IconColor    string `json:"iconcolor,omitempty"`
	IconSrc      string `json:"iconsrc,omitempty"`
	MatchPos     []int  `json:"matchpos,omitempty"`
	SubMatchPos  []int  `json:"submatchpos,omitempty"`
	Score        int    `json:"score,omitempty"`
	FileMimeType string `json:"file:mimetype,omitempty"`
	FilePath     string `json:"file:path,omitempty"`
	FileName     string `json:"file:name,omitempty"`
	UrlUrl       string `json:"url:url,omitempty"`
}

type CommandGetRTInfoData struct {
	ORef waveobj.ORef `json:"oref"`
}

type CommandSetRTInfoData struct {
	ORef   waveobj.ORef   `json:"oref"`
	Data   map[string]any `json:"data" tstype:"ObjRTInfo"`
	Delete bool           `json:"delete,omitempty"`
}

type CommandTermGetScrollbackLinesData struct {
	LineStart   int  `json:"linestart"`
	LineEnd     int  `json:"lineend"`
	LastCommand bool `json:"lastcommand"`
}

type CommandTermGetScrollbackLinesRtnData struct {
	TotalLines  int      `json:"totallines"`
	LineStart   int      `json:"linestart"`
	Lines       []string `json:"lines"`
	LastUpdated int64    `json:"lastupdated"`
}

type CommandTermUpdateAttachedJobData struct {
	BlockId string `json:"blockid"`
	JobId   string `json:"jobid,omitempty"`
}

type CommandElectronEncryptData struct {
	PlainText string `json:"plaintext"`
}

type CommandElectronEncryptRtnData struct {
	CipherText     string `json:"ciphertext"`
	StorageBackend string `json:"storagebackend"` // only returned for linux
}

type CommandElectronDecryptData struct {
	CipherText string `json:"ciphertext"`
}

type CommandElectronDecryptRtnData struct {
	PlainText      string `json:"plaintext"`
	StorageBackend string `json:"storagebackend"` // only returned for linux
}

type CommandStreamData struct {
	Id     string `json:"id"`  // streamid
	Seq    int64  `json:"seq"` // start offset (bytes)
	Data64 string `json:"data64,omitempty"`
	Eof    bool   `json:"eof,omitempty"`   // can be set with data or without
	Error  string `json:"error,omitempty"` // stream terminated with error
}

type CommandStreamAckData struct {
	Id     string `json:"id"`               // streamid
	Seq    int64  `json:"seq"`              // next expected byte
	RWnd   int64  `json:"rwnd"`             // receive window size
	Fin    bool   `json:"fin,omitempty"`    // observed end-of-stream (eof or error)
	Delay  int64  `json:"delay,omitempty"`  // ack delay in microseconds (from when data was received to when we sent out ack -- monotonic clock)
	Cancel bool   `json:"cancel,omitempty"` // used to cancel the stream
	Error  string `json:"error,omitempty"`  // reason for cancel (may only be set if cancel is true)
}

type StreamMeta struct {
	Id            string `json:"id"`   // streamid
	RWnd          int64  `json:"rwnd"` // initial receive window size
	ReaderRouteId string `json:"readerrouteid"`
	WriterRouteId string `json:"writerrouteid"`
}

type CommandAuthenticateToJobData struct {
	JobAccessToken string `json:"jobaccesstoken"`
}

type CommandAuthenticateJobManagerData struct {
	JobId        string `json:"jobid"`
	JobAuthToken string `json:"jobauthtoken"`
}

type CommandStartJobData struct {
	Cmd        string            `json:"cmd"`
	Args       []string          `json:"args"`
	Env        map[string]string `json:"env"`
	TermSize   waveobj.TermSize  `json:"termsize"`
	StreamMeta *StreamMeta       `json:"streammeta,omitempty"`
}

type CommandRemoteStartJobData struct {
	Cmd                string            `json:"cmd"`
	Args               []string          `json:"args"`
	Env                map[string]string `json:"env"`
	TermSize           waveobj.TermSize  `json:"termsize"`
	StreamMeta         *StreamMeta       `json:"streammeta,omitempty"`
	JobAuthToken       string            `json:"jobauthtoken"`
	JobId              string            `json:"jobid"`
	MainServerJwtToken string            `json:"mainserverjwttoken"`
	ClientId           string            `json:"clientid"`
	PublicKeyBase64    string            `json:"publickeybase64"`
}

type CommandRemoteReconnectToJobManagerData struct {
	JobId              string `json:"jobid"`
	JobAuthToken       string `json:"jobauthtoken"`
	MainServerJwtToken string `json:"mainserverjwttoken"`
	JobManagerPid      int    `json:"jobmanagerpid"`
	JobManagerStartTs  int64  `json:"jobmanagerstartts"`
}

type CommandRemoteReconnectToJobManagerRtnData struct {
	Success        bool   `json:"success"`
	JobManagerGone bool   `json:"jobmanagergone"`
	Error          string `json:"error,omitempty"`
}

type CommandRemoteDisconnectFromJobManagerData struct {
	JobId string `json:"jobid"`
}

type CommandRemoteTerminateJobManagerData struct {
	JobId             string `json:"jobid"`
	JobManagerPid     int    `json:"jobmanagerpid"`
	JobManagerStartTs int64  `json:"jobmanagerstartts"`
}

type CommandStartJobRtnData struct {
	CmdPid            int   `json:"cmdpid"`
	CmdStartTs        int64 `json:"cmdstartts"`
	JobManagerPid     int   `json:"jobmanagerpid"`
	JobManagerStartTs int64 `json:"jobmanagerstartts"`
}

type CommandJobPrepareConnectData struct {
	StreamMeta StreamMeta `json:"streammeta"`
	Seq        int64      `json:"seq"`
}

type CommandJobStartStreamData struct {
}

type CommandJobConnectRtnData struct {
	Seq         int64  `json:"seq"`
	StreamDone  bool   `json:"streamdone,omitempty"`
	StreamError string `json:"streamerror,omitempty"`
	HasExited   bool   `json:"hasexited,omitempty"`
	ExitCode    *int   `json:"exitcode,omitempty"`
	ExitSignal  string `json:"exitsignal,omitempty"`
	ExitErr     string `json:"exiterr,omitempty"`
}

type CommandJobCmdExitedData struct {
	JobId      string `json:"jobid"`
	ExitCode   *int   `json:"exitcode,omitempty"`
	ExitSignal string `json:"exitsignal,omitempty"`
	ExitErr    string `json:"exiterr,omitempty"`
	ExitTs     int64  `json:"exitts,omitempty"`
}

type CommandJobControllerStartJobData struct {
	ConnName string            `json:"connname"`
	Cmd      string            `json:"cmd"`
	Args     []string          `json:"args"`
	Env      map[string]string `json:"env"`
	TermSize *waveobj.TermSize `json:"termsize,omitempty"`
}

type CommandJobControllerAttachJobData struct {
	JobId   string `json:"jobid"`
	BlockId string `json:"blockid"`
}

// Shell detection types

type DetectShellsRequest struct {
	ConnectionName string `json:"connectionname,omitempty"` // Empty = local
	Rescan         bool   `json:"rescan,omitempty"`         // Force cache refresh
}

type DetectedShell struct {
	ID        string `json:"id"`                  // "pwsh-a1b2c3d4" (hash of path)
	Name      string `json:"name"`                // "PowerShell 7"
	ShellPath string `json:"shellpath"`           // "C:\...\pwsh.exe"
	ShellType string `json:"shelltype"`           // "pwsh", "bash", "zsh", "fish", "cmd"
	Version   string `json:"version,omitempty"`   // "7.4"
	Source    string `json:"source"`              // "file", "wsl", etc.
	Icon      string `json:"icon,omitempty"`      // "powershell", "terminal", "linux"
	IsDefault bool   `json:"isdefault,omitempty"` // true if system default
}

type DetectShellsResponse struct {
	Shells []DetectedShell `json:"shells"`
	Error  string          `json:"error,omitempty"` // Non-fatal errors
}

// OMP (Oh-My-Posh) configuration types

// CommandOmpGetConfigInfoRtnData contains OMP config info
type CommandOmpGetConfigInfoRtnData struct {
	ConfigPath     string            `json:"configpath"`
	Format         string            `json:"format"`
	Exists         bool              `json:"exists"`
	Readable       bool              `json:"readable"`
	Writable       bool              `json:"writable"`
	CurrentPalette map[string]string `json:"currentpalette,omitempty"`
	Error          string            `json:"error,omitempty"`
}

// CommandOmpWritePaletteData contains palette write request
type CommandOmpWritePaletteData struct {
	Palette      map[string]string `json:"palette"`
	CreateBackup bool              `json:"createbackup"`
}

// CommandOmpWritePaletteRtnData contains write result
type CommandOmpWritePaletteRtnData struct {
	Success    bool   `json:"success"`
	BackupPath string `json:"backuppath,omitempty"`
	Error      string `json:"error,omitempty"`
}

// CommandOmpAnalyzeData contains analysis request (empty - uses $POSH_THEME)
type CommandOmpAnalyzeData struct{}

// TransparentSegmentInfo contains info about a segment with transparent background
type TransparentSegmentInfo struct {
	BlockIndex   int    `json:"blockindex"`
	SegmentIndex int    `json:"segmentindex"`
	SegmentType  string `json:"segmenttype"`
	Foreground   string `json:"foreground"`
}

// CommandOmpAnalyzeRtnData contains analysis result
type CommandOmpAnalyzeRtnData struct {
	TransparentSegments []TransparentSegmentInfo `json:"transparentsegments"`
	HasTransparency     bool                     `json:"hastransparency"`
	Error               string                   `json:"error,omitempty"`
}

// CommandOmpApplyHighContrastData contains high contrast mode request
type CommandOmpApplyHighContrastData struct {
	CreateBackup bool `json:"createbackup"`
}

// CommandOmpApplyHighContrastRtnData contains high contrast mode result
type CommandOmpApplyHighContrastRtnData struct {
	Success      bool   `json:"success"`
	BackupPath   string `json:"backuppath,omitempty"`
	ModifiedPath string `json:"modifiedpath,omitempty"`
	Error        string `json:"error,omitempty"`
}

// CommandOmpRestoreBackupData contains restore backup request (empty)
type CommandOmpRestoreBackupData struct{}

// CommandOmpRestoreBackupRtnData contains restore backup result
type CommandOmpRestoreBackupRtnData struct {
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
}

// ============================================
// OMP Configurator RPC Types (Full Config Read/Write)
// ============================================

// OmpConfigData represents the full OMP configuration for the configurator
type OmpConfigData struct {
	Schema                 string                   `json:"$schema,omitempty"`
	Version                int                      `json:"version,omitempty"`
	FinalSpace             bool                     `json:"final_space,omitempty"`
	ConsoleTitleTemplate   string                   `json:"console_title_template,omitempty"`
	Palette                map[string]string        `json:"palette,omitempty"`
	Blocks                 []OmpBlockData           `json:"blocks"`
	TransientPrompt        *OmpTransientData        `json:"transient_prompt,omitempty"`
	SecondaryPrompt        *OmpSecondaryPromptData  `json:"secondary_prompt,omitempty"`
	DebugPrompt            *OmpDebugPromptData      `json:"debug_prompt,omitempty"`
	Tooltips               []OmpTooltipData         `json:"tooltips,omitempty"`
	CycleCacheEnabled      bool                     `json:"cycle_cache_enabled,omitempty"`
	DisableCursorPositioning bool                   `json:"disable_cursor_positioning,omitempty"`
	PatchPwshBleed         bool                     `json:"patch_pwsh_bleed,omitempty"`
	UpgradeNotice          bool                     `json:"upgrade_notice,omitempty"`
}

// OmpBlockData represents a block in the OMP config
type OmpBlockData struct {
	Type      string           `json:"type"`
	Alignment string           `json:"alignment"`
	Segments  []OmpSegmentData `json:"segments"`
	Newline   bool             `json:"newline,omitempty"`
	Filler    string           `json:"filler,omitempty"`
	Overflow  string           `json:"overflow,omitempty"`
}

// OmpSegmentData represents a segment in the OMP config
type OmpSegmentData struct {
	Type                    string                 `json:"type"`
	Style                   string                 `json:"style"`
	Foreground              string                 `json:"foreground,omitempty"`
	Background              string                 `json:"background,omitempty"`
	Template                string                 `json:"template,omitempty"`
	Templates               []string               `json:"templates,omitempty"`
	Properties              map[string]interface{} `json:"properties,omitempty"`
	LeadingDiamond          string                 `json:"leading_diamond,omitempty"`
	TrailingDiamond         string                 `json:"trailing_diamond,omitempty"`
	LeadingPowerlineSymbol  string                 `json:"leading_powerline_symbol,omitempty"`
	TrailingPowerlineSymbol string                 `json:"trailing_powerline_symbol,omitempty"`
	InvertPowerline         bool                   `json:"invert_powerline,omitempty"`
	PowerlineSymbol         string                 `json:"powerline_symbol,omitempty"`
	Interactive             bool                   `json:"interactive,omitempty"`
	ForegroundTemplates     []string               `json:"foreground_templates,omitempty"`
	BackgroundTemplates     []string               `json:"background_templates,omitempty"`
	Alias                   string                 `json:"alias,omitempty"`
	MaxWidth                int                    `json:"max_width,omitempty"`
	MinWidth                int                    `json:"min_width,omitempty"`
	Cache                   *OmpCacheData          `json:"cache,omitempty"`
}

// OmpTransientData represents transient prompt settings
type OmpTransientData struct {
	Foreground string `json:"foreground,omitempty"`
	Background string `json:"background,omitempty"`
	Template   string `json:"template,omitempty"`
	Filler     string `json:"filler,omitempty"`
	Newline    bool   `json:"newline,omitempty"`
}

// OmpSecondaryPromptData represents secondary prompt settings
type OmpSecondaryPromptData struct {
	Foreground string `json:"foreground,omitempty"`
	Background string `json:"background,omitempty"`
	Template   string `json:"template,omitempty"`
}

// OmpDebugPromptData represents debug prompt settings
type OmpDebugPromptData struct {
	Foreground string `json:"foreground,omitempty"`
	Background string `json:"background,omitempty"`
	Template   string `json:"template,omitempty"`
}

// OmpTooltipData represents a tooltip configuration
type OmpTooltipData struct {
	Type       string                 `json:"type"`
	Tips       []string               `json:"tips"`
	Style      string                 `json:"style,omitempty"`
	Foreground string                 `json:"foreground,omitempty"`
	Background string                 `json:"background,omitempty"`
	Template   string                 `json:"template,omitempty"`
	Properties map[string]interface{} `json:"properties,omitempty"`
}

// OmpCacheData represents cache settings for a segment
type OmpCacheData struct {
	Duration string `json:"duration,omitempty"`
	Strategy string `json:"strategy,omitempty"`
}

// CommandOmpReadConfigData is empty - uses $POSH_THEME
type CommandOmpReadConfigData struct{}

// CommandOmpReadConfigRtnData contains the full OMP config
type CommandOmpReadConfigRtnData struct {
	ConfigPath   string         `json:"configpath"`
	Config       *OmpConfigData `json:"config,omitempty"`
	RawContent   string         `json:"rawcontent,omitempty"`
	Format       string         `json:"format"`
	Source       string         `json:"source"`  // "POSH_THEME" or "default"
	BackupExists bool           `json:"backupexists"`
	Error        string         `json:"error,omitempty"`
}

// CommandOmpWriteConfigData contains config to write
type CommandOmpWriteConfigData struct {
	Config       *OmpConfigData `json:"config"`
	CreateBackup bool           `json:"createbackup"`
}

// CommandOmpWriteConfigRtnData contains write result
type CommandOmpWriteConfigRtnData struct {
	Success    bool   `json:"success"`
	BackupPath string `json:"backuppath,omitempty"`
	Error      string `json:"error,omitempty"`
}
