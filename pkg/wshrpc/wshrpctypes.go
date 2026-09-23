// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// types and methods for wsh rpc calls
package wshrpc

import (
	"bytes"
	"context"
	"encoding/json"

	"github.com/google/uuid"
	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/vdom"
	"github.com/wavetermdev/waveterm/pkg/waveobj"
	"github.com/wavetermdev/waveterm/pkg/wconfig"
	"github.com/wavetermdev/waveterm/pkg/wps"
)

type RespOrErrorUnion[T any] struct {
	Response T
	Error    error
}

type MultiArg struct {
	Args []any `json:"args"`
}

// Instructions for adding a new RPC call
// * methods must end with Command
// * methods must take context as their first parameter
// * methods may take additional typed parameters, and may return either just an error, or one return value plus an error
// * after modifying WshRpcInterface, run `task generate` to regnerate bindings

type WshRpcInterface interface {
	AuthenticateCommand(ctx context.Context, data string) (CommandAuthenticateRtnData, error)
	AuthenticateTokenCommand(ctx context.Context, data CommandAuthenticateTokenData) (CommandAuthenticateRtnData, error)
	AuthenticateTokenVerifyCommand(ctx context.Context, data CommandAuthenticateTokenData) (CommandAuthenticateRtnData, error) // (special) validates token without binding, root router only
	AuthenticateJobManagerCommand(ctx context.Context, data CommandAuthenticateJobManagerData) error
	AuthenticateJobManagerVerifyCommand(ctx context.Context, data CommandAuthenticateJobManagerData) error // (special) validates job auth token without binding, root router only
	DisposeCommand(ctx context.Context, data CommandDisposeData) error
	RouteAnnounceCommand(ctx context.Context) error               // (special) announces a new route to the main router
	RouteUnannounceCommand(ctx context.Context) error             // (special) unannounces a route to the main router
	ControlGetRouteIdCommand(ctx context.Context) (string, error) // (special) gets the route for the link that we're on
	SetPeerInfoCommand(ctx context.Context, peerInfo string) error
	GetJwtPublicKeyCommand(ctx context.Context) (string, error) // (special) gets the public JWT signing key

	MessageCommand(ctx context.Context, data CommandMessageData) error
	PromptCommand(ctx context.Context, data CommandPromptData) (string, error)
	GetMetaCommand(ctx context.Context, data CommandGetMetaData) (waveobj.MetaMapType, error)
	SetMetaCommand(ctx context.Context, data CommandSetMetaData) error
	ControllerInputCommand(ctx context.Context, data CommandBlockInputData) error
	ControllerDestroyCommand(ctx context.Context, blockId string) error
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
	StreamCpuDataCommand(ctx context.Context, request CpuDataRequest) chan RespOrErrorUnion[TimeSeriesData]
	TestCommand(ctx context.Context, data string) error
	TestMultiArgCommand(ctx context.Context, arg1 string, arg2 int, arg3 bool) (string, error)
	SetConfigCommand(ctx context.Context, data MetaSettingsType) error
	SetConnectionsConfigCommand(ctx context.Context, data ConnConfigRequest) error
	GetFullConfigCommand(ctx context.Context) (wconfig.FullConfigType, error)
	BlockInfoCommand(ctx context.Context, blockId string) (*BlockInfoData, error)
	DebugTermCommand(ctx context.Context, data CommandDebugTermData) (*CommandDebugTermRtnData, error)
	BlocksListCommand(ctx context.Context, data BlocksListRequest) ([]BlocksListEntry, error)
	WaveInfoCommand(ctx context.Context) (*WaveInfoData, error)
	MacOSVersionCommand(ctx context.Context) (string, error)
	GetVarCommand(ctx context.Context, data CommandVarData) (*CommandVarResponseData, error)
	GetAllVarsCommand(ctx context.Context, data CommandVarData) ([]CommandVarResponseData, error)
	SetVarCommand(ctx context.Context, data CommandVarData) error
	PathCommand(ctx context.Context, data PathCommandData) (string, error)
	FetchSuggestionsCommand(ctx context.Context, data FetchSuggestionsData) (*FetchSuggestionsResponse, error)
	DisposeSuggestionsCommand(ctx context.Context, widgetId string) error
	GetTabCommand(ctx context.Context, tabId string) (*waveobj.Tab, error)
	UpdateTabNameCommand(ctx context.Context, tabId string, newName string) error
	UpdateWorkspaceTabIdsCommand(ctx context.Context, workspaceId string, tabIds []string) error
	CreateTabCommand(ctx context.Context, data CommandCreateTabData) (CommandCreateTabRtnData, error)
	SetActiveTabCommand(ctx context.Context, data CommandSetActiveTabData) error
	DeleteTabCommand(ctx context.Context, data CommandDeleteTabData) (CommandDeleteTabRtnData, error)
	GetAllBadgesCommand(ctx context.Context) ([]baseds.BadgeEvent, error)

	// connection functions
	ConnStatusCommand(ctx context.Context) ([]ConnStatus, error)
	WslStatusCommand(ctx context.Context) ([]ConnStatus, error)
	ConnEnsureCommand(ctx context.Context, data ConnExtData) error
	ConnReinstallWshCommand(ctx context.Context, data ConnExtData) error
	ConnConnectCommand(ctx context.Context, connRequest ConnRequest) error
	ConnDisconnectCommand(ctx context.Context, connName string) error
	// ConnStopAutoRetryCommand stops the reconnect scheduler and attention
	// heartbeat for a connection without disconnecting or clearing the password
	// cache (UX-0.5). Sets SuppressAutoReconnect until explicit Reconnect.
	ConnStopAutoRetryCommand(ctx context.Context, connName string) error
	ConnListCommand(ctx context.Context) ([]string, error)
	WslListCommand(ctx context.Context) ([]string, error)
	WslDefaultDistroCommand(ctx context.Context) (string, error)
	DismissWshFailCommand(ctx context.Context, connName string) error
	ConnUpdateWshCommand(ctx context.Context, remoteInfo RemoteInfo) (bool, error)
	FindGitBashCommand(ctx context.Context, rescan bool) (string, error)
	ConnServerInitCommand(ctx context.Context, data CommandConnServerInitData) error
	NotifySystemResumeCommand(ctx context.Context) error

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
	BadgeWatchPidCommand(ctx context.Context, data CommandBadgeWatchPidData) error
	RemoteProcessListCommand(ctx context.Context, data CommandRemoteProcessListData) (*ProcessListResponse, error)
	RemoteProcessSignalCommand(ctx context.Context, data CommandRemoteProcessSignalData) error

	// git/source control
	GitStatusCommand(ctx context.Context, data CommandGitStatusData) (*GitStatusResponse, error)
	GitDiffCommand(ctx context.Context, data CommandGitDiffData) (*GitDiffResponse, error)
	GitStageCommand(ctx context.Context, data CommandGitStageData) error
	GitUnstageCommand(ctx context.Context, data CommandGitUnstageData) error
	GitStageHunkCommand(ctx context.Context, data CommandGitStageHunkData) error
	GitRevertHunkCommand(ctx context.Context, data CommandGitRevertHunkData) error
	GitCommitCommand(ctx context.Context, data CommandGitCommitData) (*GitCommitResponse, error)
	GitPushCommand(ctx context.Context, data CommandGitPushData) (*GitPushResponse, error)
	GitLookupCredentialsCommand(ctx context.Context, data CommandGitLookupCredentialsData) (*GitCredentials, error)
	GitSaveCredentialsCommand(ctx context.Context, data CommandGitSaveCredentialsData) error

	// emain
	WebSelectorCommand(ctx context.Context, data CommandWebSelectorData) ([]string, error)
	WebRunCommand(ctx context.Context, data CommandWebRunData) (*WebRunResult, error)
	WebSnapshotCommand(ctx context.Context, data CommandWebSnapshotData) (*WebSnapshotResult, error)
	WebScreenshotCommand(ctx context.Context, data CommandWebScreenshotData) (*WebScreenshotResult, error)
	NotifyCommand(ctx context.Context, notificationOptions WaveNotificationOptions) error
	FocusWindowCommand(ctx context.Context, windowId string) error
	ElectronEncryptCommand(ctx context.Context, data CommandElectronEncryptData) (*CommandElectronEncryptRtnData, error)
	ElectronDecryptCommand(ctx context.Context, data CommandElectronDecryptData) (*CommandElectronDecryptRtnData, error)
	NetworkOnlineCommand(ctx context.Context) (bool, error)
	ElectronSystemBellCommand(ctx context.Context) error

	// secrets
	GetSecretsCommand(ctx context.Context, names []string) (map[string]string, error)
	GetSecretsNamesCommand(ctx context.Context) ([]string, error)
	SetSecretsCommand(ctx context.Context, secrets map[string]*string) error
	GetSecretsLinuxStorageBackendCommand(ctx context.Context) (string, error)

	WorkspaceListCommand(ctx context.Context) ([]WorkspaceInfoData, error)

	// terminal
	VDomCreateContextCommand(ctx context.Context, data vdom.VDomCreateContext) (*waveobj.ORef, error)
	VDomAsyncInitiationCommand(ctx context.Context, data vdom.VDomAsyncInitiationRequest) error

	// screenshot
	CaptureBlockScreenshotCommand(ctx context.Context, data CommandCaptureBlockScreenshotData) (string, error)

	// block focus
	SetBlockFocusCommand(ctx context.Context, blockId string) error
	GetFocusedBlockDataCommand(ctx context.Context) (*FocusedBlockData, error)
	GetBlockInputStateCommand(ctx context.Context, blockId string) (*BlockInputState, error)
	ResolveDirectionalCommand(ctx context.Context, data CommandResolveDirectionalData) (*waveobj.ORef, error)

	// rtinfo
	GetRTInfoCommand(ctx context.Context, data CommandGetRTInfoData) (*waveobj.ObjRTInfo, error)
	SetRTInfoCommand(ctx context.Context, data CommandSetRTInfoData) error

	// terminal
	TermGetScrollbackLinesCommand(ctx context.Context, data CommandTermGetScrollbackLinesData) (*CommandTermGetScrollbackLinesRtnData, error)

	// block runtime status + term file read (used by `wsh run --wait`)
	BlockControllerStatusCommand(ctx context.Context, blockId string) (*BlockControllerStatusData, error)
	BlockReadTermFileCommand(ctx context.Context, blockId string) (string, error)

	// file
	WshRpcFileInterface
	WaveFileReadStreamCommand(ctx context.Context, data CommandWaveFileReadStreamData) (*WaveFileInfo, error)

	// builder
	WshRpcBuilderInterface

	// proc
	VDomRenderCommand(ctx context.Context, data vdom.VDomFrontendUpdate) chan RespOrErrorUnion[*vdom.VDomBackendUpdate]
	VDomUrlRequestCommand(ctx context.Context, data VDomUrlRequestData) chan RespOrErrorUnion[VDomUrlRequestResponse]

	// streams
	StreamDataCommand(ctx context.Context, data CommandStreamData) error
	StreamDataAckCommand(ctx context.Context, data CommandStreamAckData) error
	StreamStatusReportCommand(ctx context.Context, data CommandStreamStatusData) error

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
	JobControllerGetAllJobManagerStatusCommand(ctx context.Context) ([]*JobManagerStatusUpdate, error)
	BlockJobStatusCommand(ctx context.Context, blockId string) (*BlockJobStatusData, error)
	BlockRestartStreamCommand(ctx context.Context, blockId string) error
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
	SockName  string `json:"sockname,omitempty"`  // the domain socket name
	RouteId   string `json:"routeid"`             // the routeid from the jwt
	ProcRoute bool   `json:"procroute,omitempty"` // use a random procid for route
	BlockId   string `json:"blockid,omitempty"`   // blockid for this rpc
	Conn      string `json:"conn,omitempty"`      // the conn name
	IsRouter  bool   `json:"isrouter,omitempty"`  // if this is for a sub-router
}

func (rc RpcContext) GenerateRouteId() string {
	if rc.RouteId != "" {
		return rc.RouteId
	}
	return "proc:" + uuid.New().String()
}

type CommandAuthenticateRtnData struct {
	RouteId string `json:"routeid"`

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

type CommandPromptData struct {
	Question      string   `json:"question"`
	Options       []string `json:"options,omitempty"`
	Title         string   `json:"title,omitempty"`
	TimeoutMs     int      `json:"timeoutms,omitempty"`
	DefaultOption string   `json:"defaultoption,omitempty"`
}

type CommandCreateTabData struct {
	WorkspaceId string `json:"workspaceid,omitempty"`
	Name        string `json:"name,omitempty"`
	Connection  string `json:"connection,omitempty"`
	Activate    bool   `json:"activate"`
}

type CommandCreateTabRtnData struct {
	TabId string `json:"tabid"`
	Name  string `json:"name,omitempty"`
}

type CommandSetActiveTabData struct {
	WorkspaceId string `json:"workspaceid"`
	TabId       string `json:"tabid"`
}

type CommandDeleteTabData struct {
	WorkspaceId string `json:"workspaceid"`
	TabId       string `json:"tabid"`
}

type CommandDeleteTabRtnData struct {
	NewActiveTabId string `json:"newactivetabid,omitempty"`
}

type BlockInputState struct {
	BlockId         string `json:"blockid"`
	LastUserInputMs int64  `json:"lastuserinputms"`
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

// CommandResolveDirectionalData resolves the block geometrically adjacent to
// BlockId in the given Direction ("left", "right", "above", or "below").
type CommandResolveDirectionalData struct {
	BlockId   string `json:"blockid"`
	Direction string `json:"direction"` // "left", "right", "above", "below"
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
	ConnName     string               `json:"connname,omitempty"`
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
	JobId          string            `json:"jobid"`
	InputSessionId string            `json:"inputsessionid,omitempty"`
	SeqNum         int               `json:"seqnum,omitempty"`
	InputData64    string            `json:"inputdata64,omitempty"`
	SigName        string            `json:"signame,omitempty"`
	TermSize       *waveobj.TermSize `json:"termsize,omitempty"`
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

type CommandRemoteWriteTempFileData struct {
	FileName string `json:"filename"`
	Data64   string `json:"data64"`
}

type ConnRequest struct {
	Host       string               `json:"host"`
	Keywords   wconfig.ConnKeywords `json:"keywords,omitempty"`
	LogBlockId string               `json:"logblockid,omitempty"`
	// Force, when true, performs CloseInvoluntary then Connect if already
	// connected/connecting. Preserves password cache (UX-1.3 stalled Reconnect Now).
	Force bool `json:"force,omitempty"`
}

type RemoteInfo struct {
	ClientArch    string `json:"clientarch"`
	ClientOs      string `json:"clientos"`
	ClientVersion string `json:"clientversion"`
	Shell         string `json:"shell"`
	HomeDir       string `json:"homedir"`
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
	Status                        string   `json:"status"`
	ConnHealthStatus              string   `json:"connhealthstatus,omitempty"`
	WshEnabled                    bool     `json:"wshenabled"`
	Connection                    string   `json:"connection"`
	Connected                     bool     `json:"connected"`
	HasConnected                  bool     `json:"hasconnected"` // true if it has *ever* connected successfully
	ActiveConnNum                 int      `json:"activeconnnum"`
	ConnectCount                  int64    `json:"connectcount"`
	LastConnectTime               int64    `json:"lastconnecttime"`
	Error                         string   `json:"error,omitempty"`
	ErrorCode                     string   `json:"errorcode,omitempty"`
	WshError                      string   `json:"wsherror,omitempty"`
	NoWshReason                   string   `json:"nowshreason,omitempty"`
	WshVersion                    string   `json:"wshversion,omitempty"`
	LastActivityBeforeStalledTime int64    `json:"lastactivitybeforestalledtime,omitempty"`
	KeepAliveSentTime             int64    `json:"keepalivesenttime,omitempty"`
	ReconnectAttempt              int      `json:"reconnectattempt,omitempty"`
	ReconnectNextAttempt          int64    `json:"reconnectnextattempt,omitempty"`
	ReconnectError                string   `json:"reconnecterror,omitempty"`
	ReconnectGaveUp               bool     `json:"reconnectgaveup,omitempty"`     // UX-1.1: scheduler exhausted retries
	ReconnectStopReason           string   `json:"reconnectstopreason,omitempty"` // UX-1.1: "max-duration", "auth-failed", etc.
	ForwardingRules               []string `json:"forwardingrules,omitempty"`
	CanAutoReconnect              bool     `json:"canautoreconnect"` // true if scheduler can auto-reconnect without user input
	// SuppressAutoReconnect is true after user Disconnect, Stop auto-retry,
	// password Cancel, or permanent handshake failure. Auto paths no-op until
	// explicit Reconnect (UX-0.1, UX-0.4, UX-0.5).
	SuppressAutoReconnect bool `json:"suppressautoreconnect,omitempty"`
	FlappingMode          bool `json:"flappingmode,omitempty"` // true when ≥3 reconnect attempts in last 30s (UX-2.2)
	// AuthQueueWaiting is true while this connection is blocked on the per-window
	// password prompt lock waiting for another conn to finish signing in (UX-1.6).
	AuthQueueWaiting bool `json:"authqueuewaiting,omitempty"`
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

type CommandWebRunData struct {
	WorkspaceId string `json:"workspaceid"`
	BlockId     string `json:"blockid"`
	TabId       string `json:"tabid"`
	Script      string `json:"script"`
	TimeoutMs   int64  `json:"timeoutms,omitempty"` // default 60000
}

type WebRunResult struct {
	BlockId   string          `json:"blockid"`
	URL       string          `json:"url,omitempty"`
	Title     string          `json:"title,omitempty"`
	Stdout    string          `json:"stdout"`
	Result    json.RawMessage `json:"result,omitempty"` // script return value, if any
	Truncated bool            `json:"truncated,omitempty"`
}

type CommandWebSnapshotData struct {
	WorkspaceId string `json:"workspaceid"`
	BlockId     string `json:"blockid"`
	TabId       string `json:"tabid"`
}

type WebSnapshotResult struct {
	BlockId   string `json:"blockid"`
	URL       string `json:"url,omitempty"`
	Title     string `json:"title,omitempty"`
	Snapshot  string `json:"snapshot"`
	Truncated bool   `json:"truncated,omitempty"`
}

type CommandWebScreenshotData struct {
	WorkspaceId string `json:"workspaceid"`
	BlockId     string `json:"blockid"`
	TabId       string `json:"tabid"`
}

type WebScreenshotResult struct {
	BlockId string `json:"blockid"`
	Data64  string `json:"data64"` // raw PNG base64, no data: URL prefix
}

type BlockInfoData struct {
	BlockId     string          `json:"blockid"`
	TabId       string          `json:"tabid"`
	WorkspaceId string          `json:"workspaceid"`
	Block       *waveobj.Block  `json:"block"`
	Files       []*WaveFileInfo `json:"files"`
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

type BlocksListRequest struct {
	WindowId    string `json:"windowid,omitempty"`
	WorkspaceId string `json:"workspaceid,omitempty"`
}

// BlockGeometry describes a block's position and size within its tab as
// fractions of the tab's full extent (0..1), resolution-independent.
type BlockGeometry struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	W float64 `json:"w"`
	H float64 `json:"h"`
}

type BlocksListEntry struct {
	WindowId    string              `json:"windowid"`
	WorkspaceId string              `json:"workspaceid"`
	TabId       string              `json:"tabid"`
	BlockId     string              `json:"blockid"`
	Meta        waveobj.MetaMapType `json:"meta"`
	Index       int                 `json:"index,omitempty"`
	Geometry    *BlockGeometry      `json:"geometry,omitempty"`
	Focused     bool                `json:"focused,omitempty"`
	Magnified   bool                `json:"magnified,omitempty"`
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

type CommandDebugTermData struct {
	BlockId string `json:"blockid"`
	Size    int64  `json:"size"`
}

type CommandDebugTermRtnData struct {
	Offset int64  `json:"offset"`
	Data64 string `json:"data64"`
}

type PathCommandData struct {
	PathType     string `json:"pathtype"`
	Open         bool   `json:"open"`
	OpenExternal bool   `json:"openexternal"`
	TabId        string `json:"tabid"`
}

type ConnExtData struct {
	ConnName   string `json:"connname"`
	LogBlockId string `json:"logblockid,omitempty"`
}

type CommandConnServerInitData struct {
	ClientId string `json:"clientid"`
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

// BlockControllerStatusData is the wshrpc-level mirror of
// blockcontroller.BlockControllerRuntimeStatus. It is kept in wshrpc (rather than
// importing pkg/blockcontroller) to avoid an import cycle: pkg/blockcontroller
// depends on pkg/wshrpc.
type BlockControllerStatusData struct {
	BlockId           string `json:"blockid"`
	Version           int64  `json:"version"`
	ShellProcStatus   string `json:"shellprocstatus,omitempty"`
	ShellProcConnName string `json:"shellprocconnname,omitempty"`
	ShellProcExitCode int    `json:"shellprocexitcode"`
	TsunamiPort       int    `json:"tsunamiport,omitempty"`
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

// Stream state values for CommandStreamStatusData.State. Reported by the
// remote jobmanager so wavesrv can distinguish idle from wedged from
// disconnected (spec: .pi/specs/stream-data-path-resilience.md).
const (
	StreamStateConnected  = "connected"
	StreamStateRetrying   = "retrying"
	StreamStateStalled    = "stalled"
	StreamStateDiskBuffer = "disconnected-diskbuffer"
)

type CommandStreamStatusData struct {
	JobId        string `json:"jobid"`
	StreamId     string `json:"streamid,omitempty"`
	State        string `json:"state"` // StreamState* constant
	SentNotAcked int64  `json:"sentnotacked"`
	BufCount     int64  `json:"bufcount"`
	RWnd         int    `json:"rwnd"`
	LastAckAgeMs int64  `json:"lastackagems,omitempty"`
	RetryCount   int    `json:"retrycount,omitempty"`
	DiskBufBytes int64  `json:"diskbufbytes,omitempty"`
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
	StreamMeta StreamMeta       `json:"streammeta"`
	Seq        int64            `json:"seq"`
	TermSize   waveobj.TermSize `json:"termsize"`
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
	// UX-1.7: snapshot of remote StreamManager drain progress at PrepareConnect
	DrainActive         bool  `json:"drainactive,omitempty"`
	DrainTotalBytes     int64 `json:"draintotalbytes,omitempty"`
	DrainRemainingBytes int64 `json:"drainremainingbytes,omitempty"`
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
	JobKind  string            `json:"jobkind"`
	Cmd      string            `json:"cmd"`
	Args     []string          `json:"args"`
	Env      map[string]string `json:"env"`
	TermSize *waveobj.TermSize `json:"termsize,omitempty"`
}

type CommandJobControllerAttachJobData struct {
	JobId   string `json:"jobid"`
	BlockId string `json:"blockid"`
}

type JobManagerStatusUpdate struct {
	JobId            string `json:"jobid"`
	JobManagerStatus string `json:"jobmanagerstatus"`
}

type CommandWaveFileReadStreamData struct {
	ZoneId     string     `json:"zoneid"`
	Name       string     `json:"name"`
	StreamMeta StreamMeta `json:"streammeta"`
}

// see blockstore.go (WaveFile)
type WaveFileInfo struct {
	ZoneId    string   `json:"zoneid"`
	Name      string   `json:"name"`
	Opts      FileOpts `json:"opts"`
	CreatedTs int64    `json:"createdts"`
	Size      int64    `json:"size"`
	ModTs     int64    `json:"modts"`
	Meta      FileMeta `json:"meta"`
}

type CommandBadgeWatchPidData struct {
	Pid     int          `json:"pid"`
	ORef    waveobj.ORef `json:"oref"`
	BadgeId string       `json:"badgeid"`
}

type BlockJobStatusData struct {
	BlockId       string `json:"blockid"`
	JobId         string `json:"jobid"`
	Status        string `json:"status,omitempty" tstype:"null | \"init\" | \"connected\" | \"disconnected\" | \"done\""`
	VersionTs     int64  `json:"versionts"`
	DoneReason    string `json:"donereason,omitempty"`
	StartupError  string `json:"startuperror,omitempty"`
	CmdExitTs     int64  `json:"cmdexitts,omitempty"`
	CmdExitCode   *int   `json:"cmdexitcode,omitempty"`
	CmdExitSignal string `json:"cmdexitsignal,omitempty"`
	// UX-1.7: disk drain / catch-up progress after reconnect
	DrainActive         bool  `json:"drainactive,omitempty"`
	DrainTotalBytes     int64 `json:"draintotalbytes,omitempty"`
	DrainRemainingBytes int64 `json:"drainremainingbytes,omitempty"`
}

type FocusedBlockData struct {
	BlockId                    string              `json:"blockid"`
	ViewType                   string              `json:"viewtype"`
	Controller                 string              `json:"controller"`
	ConnName                   string              `json:"connname"`
	BlockMeta                  waveobj.MetaMapType `json:"blockmeta"`
	TermJobStatus              *BlockJobStatusData `json:"termjobstatus,omitempty"`
	ConnStatus                 *ConnStatus         `json:"connstatus,omitempty"`
	TermShellIntegrationStatus string              `json:"termshellintegrationstatus,omitempty"`
	TermLastCommand            string              `json:"termlastcommand,omitempty"`
}

// ProcessInfo holds per-process information for the process viewer.
// Mem, MemPct, Cpu, and NumThreads are set to -1 when the data is unavailable
// (e.g. permission denied reading another user's process on macOS).
type ProcessInfo struct {
	Pid        int32   `json:"pid"`
	Ppid       int32   `json:"ppid,omitempty"`
	Command    string  `json:"command,omitempty"`
	Status     string  `json:"status,omitempty"`
	User       string  `json:"user,omitempty"`
	Mem        int64   `json:"mem"`        // resident set size in bytes; -1 if unavailable
	MemPct     float64 `json:"mempct"`     // memory percent; -1 if unavailable
	Cpu        float64 `json:"cpu"`        // cpu percent; -1 if unavailable
	NumThreads int32   `json:"numthreads"` // -1 if unavailable
	Gone       bool    `json:"gone,omitempty"`
}

type ProcessSummary struct {
	Total    int     `json:"total"`
	Load1    float64 `json:"load1,omitempty"`
	Load5    float64 `json:"load5,omitempty"`
	Load15   float64 `json:"load15,omitempty"`
	MemTotal uint64  `json:"memtotal,omitempty"`
	MemUsed  uint64  `json:"memused,omitempty"`
	MemFree  uint64  `json:"memfree,omitempty"`
	NumCPU   int     `json:"numcpu,omitempty"`
	CpuSum   float64 `json:"cpusum,omitempty"`
}

type ProcessListResponse struct {
	Processes     []ProcessInfo  `json:"processes"`
	Summary       ProcessSummary `json:"summary"`
	Ts            int64          `json:"ts"`
	HasCPU        bool           `json:"hascpu,omitempty"`
	Platform      string         `json:"platform,omitempty"`
	TotalCount    int            `json:"totalcount,omitempty"`
	FilteredCount int            `json:"filteredcount,omitempty"`
}

type CommandRemoteProcessListData struct {
	WidgetId   string `json:"widgetid,omitempty"`
	SortBy     string `json:"sortby,omitempty"`
	SortDesc   bool   `json:"sortdesc,omitempty"`
	Start      int    `json:"start,omitempty"`
	Limit      int    `json:"limit,omitempty"`
	TextSearch string `json:"textsearch,omitempty"`
	// LastPidOrder, when set, ignores SortBy/SortDesc/TextSearch and returns processes in the order
	// they were returned in the previous request for this WidgetId (with Gone=true for dead pids).
	LastPidOrder bool `json:"lastpidorder,omitempty"`
	// KeepAlive, when set, overrides all other fields and simply keeps the backend cache alive (returns nil).
	KeepAlive bool `json:"keepalive,omitempty"`
}

type CommandRemoteProcessSignalData struct {
	Pid    int32  `json:"pid"`
	Signal string `json:"signal"`
}

// Git source control types
type CommandGitStatusData struct {
	Dir string `json:"dir,omitempty"` // working directory, defaults to terminal cwd
}

type GitFileChange struct {
	Path    string `json:"path"`
	Status  string `json:"status"`  // M, A, D, R, C, U
	OldPath string `json:"oldPath"` // for renames
	Icon    string `json:"icon"`    // font-awesome icon name
	Color   string `json:"color"`   // CSS color
}

type GitStatusResponse struct {
	Branch    string          `json:"branch"`
	Staged    []GitFileChange `json:"staged"`
	Unstaged  []GitFileChange `json:"unstaged"`
	Untracked []GitFileChange `json:"untracked"`
}

type CommandGitDiffData struct {
	Dir       string `json:"dir,omitempty"`       // working directory
	Path      string `json:"path"`                // file path
	Staged    bool   `json:"staged,omitempty"`    // true for staged diff (git diff --cached)
	Untracked bool   `json:"untracked,omitempty"` // true for untracked files (read content directly)
	FullFile  bool   `json:"fullFile,omitempty"`  // true to return full file content (not just diff hunks)
}

type GitDiffResponse struct {
	Original    string        `json:"original"`
	Modified    string        `json:"modified"`
	Language    string        `json:"language"` // detected from file extension
	Hunks       []GitDiffHunk `json:"hunks,omitempty"`
	IsBinary    bool          `json:"isBinary,omitempty"`    // true if file contains binary content
	IsTruncated bool          `json:"isTruncated,omitempty"` // true if content was truncated for size
	FileSize    int64         `json:"fileSize,omitempty"`    // total file size in bytes
}

// Git staging operations
type CommandGitStageData struct {
	Dir   string   `json:"dir,omitempty"` // working directory
	Paths []string `json:"paths"`         // file paths to stage
}

type CommandGitUnstageData struct {
	Dir   string   `json:"dir,omitempty"` // working directory
	Paths []string `json:"paths"`         // file paths to unstage
}

type CommandGitStageHunkData struct {
	Dir       string `json:"dir"`       // working directory
	Path      string `json:"path"`      // file path
	HunkIndex int    `json:"hunkIndex"` // 0-based index of the hunk to stage
}

type CommandGitRevertHunkData struct {
	Dir       string `json:"dir"`       // working directory
	Path      string `json:"path"`      // file path
	HunkIndex int    `json:"hunkIndex"` // 0-based index of the hunk to revert
	Staged    bool   `json:"staged"`    // true if reverting a staged hunk
}

// GitDiffHunk represents a single hunk in a unified diff
type GitDiffHunk struct {
	Header        string `json:"header"`        // the @@ ... @@ line
	ModifiedStart int    `json:"modifiedStart"` // 1-based start line in modified file
	ModifiedCount int    `json:"modifiedCount"` // number of lines in modified
	OriginalStart int    `json:"originalStart"` // 1-based start line in original
	OriginalCount int    `json:"originalCount"` // number of lines in original
}

type CommandGitCommitData struct {
	Dir     string `json:"dir,omitempty"`   // working directory
	Message string `json:"message"`         // commit message
	Amend   bool   `json:"amend,omitempty"` // amend the last commit
}

type GitCommitResponse struct {
	Success bool   `json:"success"`
	Output  string `json:"output"` // git commit output
}

type CommandGitPushData struct {
	Dir         string `json:"dir,omitempty"`         // working directory
	Remote      string `json:"remote,omitempty"`      // remote name (default: origin)
	Branch      string `json:"branch,omitempty"`      // branch name (default: current branch)
	Username    string `json:"username,omitempty"`    // for HTTPS auth
	Password    string `json:"password,omitempty"`    // for HTTPS auth
	Force       bool   `json:"force,omitempty"`       // force push
	SetUpstream bool   `json:"setUpstream,omitempty"` // set upstream branch
}

type GitPushResponse struct {
	Success    bool   `json:"success"`
	Output     string `json:"output"`
	AuthNeeded bool   `json:"authNeeded"` // true if auth is required
	AuthError  string `json:"authError"`  // the auth error message
	AuthHost   string `json:"authHost"`   // parsed host (e.g., github.com)
	AuthRemote string `json:"authRemote"` // full remote URL
}

type CommandGitLookupCredentialsData struct {
	Remote string `json:"remote"` // full remote URL (e.g., https://github.com/user/repo)
}

type GitCredentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Found    bool   `json:"found"`
	Scope    string `json:"scope"` // "repo" or "host"
}

type CommandGitSaveCredentialsData struct {
	Remote   string `json:"remote"`   // full remote URL (e.g., https://github.com/user/repo)
	Username string `json:"username"` // git username
	Password string `json:"password"` // git password/token
	Scope    string `json:"scope"`    // "repo" or "host"
}
