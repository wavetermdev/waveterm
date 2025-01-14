// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// generated by cmd/generate/main-generatets.go

import { WshClient } from "./wshclient";

// WshServerCommandToDeclMap
class RpcApiType {
    // command "activity" [call]
    ActivityCommand(client: WshClient, data: ActivityUpdate, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("activity", data, opts);
    }

    // command "aisendmessage" [call]
    AiSendMessageCommand(client: WshClient, data: AiMessageData, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("aisendmessage", data, opts);
    }

    // command "authenticate" [call]
    AuthenticateCommand(client: WshClient, data: string, opts?: RpcOpts): Promise<CommandAuthenticateRtnData> {
        return client.wshRpcCall("authenticate", data, opts);
    }

    // command "blockinfo" [call]
    BlockInfoCommand(client: WshClient, data: string, opts?: RpcOpts): Promise<BlockInfoData> {
        return client.wshRpcCall("blockinfo", data, opts);
    }

    // command "connconnect" [call]
    ConnConnectCommand(client: WshClient, data: ConnRequest, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("connconnect", data, opts);
    }

    // command "conndisconnect" [call]
    ConnDisconnectCommand(client: WshClient, data: string, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("conndisconnect", data, opts);
    }

    // command "connensure" [call]
    ConnEnsureCommand(client: WshClient, data: ConnExtData, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("connensure", data, opts);
    }

    // command "connlist" [call]
    ConnListCommand(client: WshClient, opts?: RpcOpts): Promise<string[]> {
        return client.wshRpcCall("connlist", null, opts);
    }

    // command "connreinstallwsh" [call]
    ConnReinstallWshCommand(client: WshClient, data: ConnExtData, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("connreinstallwsh", data, opts);
    }

    // command "connstatus" [call]
    ConnStatusCommand(client: WshClient, opts?: RpcOpts): Promise<ConnStatus[]> {
        return client.wshRpcCall("connstatus", null, opts);
    }

    // command "connupdatewsh" [call]
    ConnUpdateWshCommand(client: WshClient, data: RemoteInfo, opts?: RpcOpts): Promise<boolean> {
        return client.wshRpcCall("connupdatewsh", data, opts);
    }

    // command "controllerappendoutput" [call]
    ControllerAppendOutputCommand(client: WshClient, data: CommandControllerAppendOutputData, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("controllerappendoutput", data, opts);
    }

    // command "controllerinput" [call]
    ControllerInputCommand(client: WshClient, data: CommandBlockInputData, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("controllerinput", data, opts);
    }

    // command "controllerresync" [call]
    ControllerResyncCommand(client: WshClient, data: CommandControllerResyncData, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("controllerresync", data, opts);
    }

    // command "controllerstop" [call]
    ControllerStopCommand(client: WshClient, data: string, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("controllerstop", data, opts);
    }

    // command "createblock" [call]
    CreateBlockCommand(client: WshClient, data: CommandCreateBlockData, opts?: RpcOpts): Promise<ORef> {
        return client.wshRpcCall("createblock", data, opts);
    }

    // command "createsubblock" [call]
    CreateSubBlockCommand(client: WshClient, data: CommandCreateSubBlockData, opts?: RpcOpts): Promise<ORef> {
        return client.wshRpcCall("createsubblock", data, opts);
    }

    // command "deleteblock" [call]
    DeleteBlockCommand(client: WshClient, data: CommandDeleteBlockData, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("deleteblock", data, opts);
    }

    // command "deletesubblock" [call]
    DeleteSubBlockCommand(client: WshClient, data: CommandDeleteBlockData, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("deletesubblock", data, opts);
    }

    // command "dismisswshfail" [call]
    DismissWshFailCommand(client: WshClient, data: string, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("dismisswshfail", data, opts);
    }

    // command "dispose" [call]
    DisposeCommand(client: WshClient, data: CommandDisposeData, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("dispose", data, opts);
    }

    // command "eventpublish" [call]
    EventPublishCommand(client: WshClient, data: WaveEvent, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("eventpublish", data, opts);
    }

    // command "eventreadhistory" [call]
    EventReadHistoryCommand(client: WshClient, data: CommandEventReadHistoryData, opts?: RpcOpts): Promise<WaveEvent[]> {
        return client.wshRpcCall("eventreadhistory", data, opts);
    }

    // command "eventrecv" [call]
    EventRecvCommand(client: WshClient, data: WaveEvent, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("eventrecv", data, opts);
    }

    // command "eventsub" [call]
    EventSubCommand(client: WshClient, data: SubscriptionRequest, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("eventsub", data, opts);
    }

    // command "eventunsub" [call]
    EventUnsubCommand(client: WshClient, data: string, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("eventunsub", data, opts);
    }

    // command "eventunsuball" [call]
    EventUnsubAllCommand(client: WshClient, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("eventunsuball", null, opts);
    }

    // command "fileappend" [call]
    FileAppendCommand(client: WshClient, data: CommandFileData, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("fileappend", data, opts);
    }

    // command "fileappendijson" [call]
    FileAppendIJsonCommand(client: WshClient, data: CommandAppendIJsonData, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("fileappendijson", data, opts);
    }

    // command "filecreate" [call]
    FileCreateCommand(client: WshClient, data: CommandFileCreateData, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("filecreate", data, opts);
    }

    // command "filedelete" [call]
    FileDeleteCommand(client: WshClient, data: CommandFileData, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("filedelete", data, opts);
    }

    // command "fileinfo" [call]
    FileInfoCommand(client: WshClient, data: CommandFileData, opts?: RpcOpts): Promise<WaveFileInfo> {
        return client.wshRpcCall("fileinfo", data, opts);
    }

    // command "filelist" [call]
    FileListCommand(client: WshClient, data: CommandFileListData, opts?: RpcOpts): Promise<WaveFileInfo[]> {
        return client.wshRpcCall("filelist", data, opts);
    }

    // command "fileread" [call]
    FileReadCommand(client: WshClient, data: CommandFileData, opts?: RpcOpts): Promise<string> {
        return client.wshRpcCall("fileread", data, opts);
    }

    // command "filewrite" [call]
    FileWriteCommand(client: WshClient, data: CommandFileData, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("filewrite", data, opts);
    }

    // command "focuswindow" [call]
    FocusWindowCommand(client: WshClient, data: string, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("focuswindow", data, opts);
    }

    // command "getmeta" [call]
    GetMetaCommand(client: WshClient, data: CommandGetMetaData, opts?: RpcOpts): Promise<MetaType> {
        return client.wshRpcCall("getmeta", data, opts);
    }

    // command "getupdatechannel" [call]
    GetUpdateChannelCommand(client: WshClient, opts?: RpcOpts): Promise<string> {
        return client.wshRpcCall("getupdatechannel", null, opts);
    }

    // command "getvar" [call]
    GetVarCommand(client: WshClient, data: CommandVarData, opts?: RpcOpts): Promise<CommandVarResponseData> {
        return client.wshRpcCall("getvar", data, opts);
    }

    // command "message" [call]
    MessageCommand(client: WshClient, data: CommandMessageData, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("message", data, opts);
    }

    // command "notify" [call]
    NotifyCommand(client: WshClient, data: WaveNotificationOptions, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("notify", data, opts);
    }

    // command "path" [call]
    PathCommand(client: WshClient, data: PathCommandData, opts?: RpcOpts): Promise<string> {
        return client.wshRpcCall("path", data, opts);
    }

    // command "remotefiledelete" [call]
    RemoteFileDeleteCommand(client: WshClient, data: string, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("remotefiledelete", data, opts);
    }

    // command "remotefileinfo" [call]
    RemoteFileInfoCommand(client: WshClient, data: string, opts?: RpcOpts): Promise<FileInfo> {
        return client.wshRpcCall("remotefileinfo", data, opts);
    }

    // command "remotefilejoin" [call]
    RemoteFileJoinCommand(client: WshClient, data: string[], opts?: RpcOpts): Promise<FileInfo> {
        return client.wshRpcCall("remotefilejoin", data, opts);
    }

    // command "remotefilerename" [call]
    RemoteFileRenameCommand(client: WshClient, data: string[], opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("remotefilerename", data, opts);
    }

    // command "remotefiletouch" [call]
    RemoteFileTouchCommand(client: WshClient, data: string, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("remotefiletouch", data, opts);
    }

    // command "remotegetinfo" [call]
    RemoteGetInfoCommand(client: WshClient, opts?: RpcOpts): Promise<RemoteInfo> {
        return client.wshRpcCall("remotegetinfo", null, opts);
    }

    // command "remoteinstallrcfiles" [call]
    RemoteInstallRcFilesCommand(client: WshClient, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("remoteinstallrcfiles", null, opts);
    }

    // command "remotemkdir" [call]
    RemoteMkdirCommand(client: WshClient, data: string, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("remotemkdir", data, opts);
    }

    // command "remotestreamcpudata" [responsestream]
	RemoteStreamCpuDataCommand(client: WshClient, opts?: RpcOpts): AsyncGenerator<TimeSeriesData, void, boolean> {
        return client.wshRpcStream("remotestreamcpudata", null, opts);
    }

    // command "remotestreamfile" [responsestream]
	RemoteStreamFileCommand(client: WshClient, data: CommandRemoteStreamFileData, opts?: RpcOpts): AsyncGenerator<CommandRemoteStreamFileRtnData, void, boolean> {
        return client.wshRpcStream("remotestreamfile", data, opts);
    }

    // command "remotewritefile" [call]
    RemoteWriteFileCommand(client: WshClient, data: CommandRemoteWriteFileData, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("remotewritefile", data, opts);
    }

    // command "resolveids" [call]
    ResolveIdsCommand(client: WshClient, data: CommandResolveIdsData, opts?: RpcOpts): Promise<CommandResolveIdsRtnData> {
        return client.wshRpcCall("resolveids", data, opts);
    }

    // command "routeannounce" [call]
    RouteAnnounceCommand(client: WshClient, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("routeannounce", null, opts);
    }

    // command "routeunannounce" [call]
    RouteUnannounceCommand(client: WshClient, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("routeunannounce", null, opts);
    }

    // command "setconfig" [call]
    SetConfigCommand(client: WshClient, data: SettingsType, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("setconfig", data, opts);
    }

    // command "setconnectionsconfig" [call]
    SetConnectionsConfigCommand(client: WshClient, data: ConnConfigRequest, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("setconnectionsconfig", data, opts);
    }

    // command "setmeta" [call]
    SetMetaCommand(client: WshClient, data: CommandSetMetaData, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("setmeta", data, opts);
    }

    // command "setvar" [call]
    SetVarCommand(client: WshClient, data: CommandVarData, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("setvar", data, opts);
    }

    // command "setview" [call]
    SetViewCommand(client: WshClient, data: CommandBlockSetViewData, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("setview", data, opts);
    }

    // command "streamcpudata" [responsestream]
	StreamCpuDataCommand(client: WshClient, data: CpuDataRequest, opts?: RpcOpts): AsyncGenerator<TimeSeriesData, void, boolean> {
        return client.wshRpcStream("streamcpudata", data, opts);
    }

    // command "streamtest" [responsestream]
	StreamTestCommand(client: WshClient, opts?: RpcOpts): AsyncGenerator<number, void, boolean> {
        return client.wshRpcStream("streamtest", null, opts);
    }

    // command "streamwaveai" [responsestream]
	StreamWaveAiCommand(client: WshClient, data: WaveAIStreamRequest, opts?: RpcOpts): AsyncGenerator<WaveAIPacketType, void, boolean> {
        return client.wshRpcStream("streamwaveai", data, opts);
    }

    // command "test" [call]
    TestCommand(client: WshClient, data: string, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("test", data, opts);
    }

    // command "tokenswap" [call]
    TokenSwapCommand(client: WshClient, data: string, opts?: RpcOpts): Promise<TokenSwapEntry> {
        return client.wshRpcCall("tokenswap", data, opts);
    }

    // command "vdomasyncinitiation" [call]
    VDomAsyncInitiationCommand(client: WshClient, data: VDomAsyncInitiationRequest, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("vdomasyncinitiation", data, opts);
    }

    // command "vdomcreatecontext" [call]
    VDomCreateContextCommand(client: WshClient, data: VDomCreateContext, opts?: RpcOpts): Promise<ORef> {
        return client.wshRpcCall("vdomcreatecontext", data, opts);
    }

    // command "vdomrender" [responsestream]
	VDomRenderCommand(client: WshClient, data: VDomFrontendUpdate, opts?: RpcOpts): AsyncGenerator<VDomBackendUpdate, void, boolean> {
        return client.wshRpcStream("vdomrender", data, opts);
    }

    // command "vdomurlrequest" [responsestream]
	VDomUrlRequestCommand(client: WshClient, data: VDomUrlRequestData, opts?: RpcOpts): AsyncGenerator<VDomUrlRequestResponse, void, boolean> {
        return client.wshRpcStream("vdomurlrequest", data, opts);
    }

    // command "waitforroute" [call]
    WaitForRouteCommand(client: WshClient, data: CommandWaitForRouteData, opts?: RpcOpts): Promise<boolean> {
        return client.wshRpcCall("waitforroute", data, opts);
    }

    // command "waveinfo" [call]
    WaveInfoCommand(client: WshClient, opts?: RpcOpts): Promise<WaveInfoData> {
        return client.wshRpcCall("waveinfo", null, opts);
    }

    // command "webselector" [call]
    WebSelectorCommand(client: WshClient, data: CommandWebSelectorData, opts?: RpcOpts): Promise<string[]> {
        return client.wshRpcCall("webselector", data, opts);
    }

    // command "workspacelist" [call]
    WorkspaceListCommand(client: WshClient, opts?: RpcOpts): Promise<WorkspaceInfoData[]> {
        return client.wshRpcCall("workspacelist", null, opts);
    }

    // command "wshactivity" [call]
    WshActivityCommand(client: WshClient, data: {[key: string]: number}, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("wshactivity", data, opts);
    }

    // command "wsldefaultdistro" [call]
    WslDefaultDistroCommand(client: WshClient, opts?: RpcOpts): Promise<string> {
        return client.wshRpcCall("wsldefaultdistro", null, opts);
    }

    // command "wsllist" [call]
    WslListCommand(client: WshClient, opts?: RpcOpts): Promise<string[]> {
        return client.wshRpcCall("wsllist", null, opts);
    }

    // command "wslstatus" [call]
    WslStatusCommand(client: WshClient, opts?: RpcOpts): Promise<ConnStatus[]> {
        return client.wshRpcCall("wslstatus", null, opts);
    }

}

export const RpcApi = new RpcApiType();
