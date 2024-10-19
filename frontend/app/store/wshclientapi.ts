// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// generated by cmd/generate/main-generatets.go

import { WshClient } from "./wshclient";

// WshServerCommandToDeclMap
class RpcApiType {
    // command "authenticate" [call]
    AuthenticateCommand(client: WshClient, data: string, opts?: RpcOpts): Promise<CommandAuthenticateRtnData> {
        return client.wshRpcCall("authenticate", data, opts);
    }

    // command "blockinfo" [call]
    BlockInfoCommand(client: WshClient, data: string, opts?: RpcOpts): Promise<BlockInfoData> {
        return client.wshRpcCall("blockinfo", data, opts);
    }

    // command "connconnect" [call]
    ConnConnectCommand(client: WshClient, data: string, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("connconnect", data, opts);
    }

    // command "conndisconnect" [call]
    ConnDisconnectCommand(client: WshClient, data: string, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("conndisconnect", data, opts);
    }

    // command "connensure" [call]
    ConnEnsureCommand(client: WshClient, data: string, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("connensure", data, opts);
    }

    // command "connlist" [call]
    ConnListCommand(client: WshClient, opts?: RpcOpts): Promise<string[]> {
        return client.wshRpcCall("connlist", null, opts);
    }

    // command "connreinstallwsh" [call]
    ConnReinstallWshCommand(client: WshClient, data: string, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("connreinstallwsh", data, opts);
    }

    // command "connstatus" [call]
    ConnStatusCommand(client: WshClient, opts?: RpcOpts): Promise<ConnStatus[]> {
        return client.wshRpcCall("connstatus", null, opts);
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

    // command "deleteblock" [call]
    DeleteBlockCommand(client: WshClient, data: CommandDeleteBlockData, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("deleteblock", data, opts);
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

    // command "fileread" [call]
    FileReadCommand(client: WshClient, data: CommandFileData, opts?: RpcOpts): Promise<string> {
        return client.wshRpcCall("fileread", data, opts);
    }

    // command "filewrite" [call]
    FileWriteCommand(client: WshClient, data: CommandFileData, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("filewrite", data, opts);
    }

    // command "getmeta" [call]
    GetMetaCommand(client: WshClient, data: CommandGetMetaData, opts?: RpcOpts): Promise<MetaType> {
        return client.wshRpcCall("getmeta", data, opts);
    }

    // command "message" [call]
    MessageCommand(client: WshClient, data: CommandMessageData, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("message", data, opts);
    }

    // command "notify" [call]
    NotifyCommand(client: WshClient, data: WaveNotificationOptions, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("notify", data, opts);
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

    // command "remotefiletouch" [call]
    RemoteFileTouchCommand(client: WshClient, data: string, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("remotefiletouch", data, opts);
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

    // command "setmeta" [call]
    SetMetaCommand(client: WshClient, data: CommandSetMetaData, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("setmeta", data, opts);
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
	StreamWaveAiCommand(client: WshClient, data: OpenAiStreamRequest, opts?: RpcOpts): AsyncGenerator<OpenAIPacketType, void, boolean> {
        return client.wshRpcStream("streamwaveai", data, opts);
    }

    // command "test" [call]
    TestCommand(client: WshClient, data: string, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("test", data, opts);
    }

    // command "vdomasyncinitiation" [call]
    VDomAsyncInitiationCommand(client: WshClient, data: VDomAsyncInitiationRequest, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("vdomasyncinitiation", data, opts);
    }

    // command "vdomcreatecontext" [call]
    VDomCreateContextCommand(client: WshClient, data: VDomCreateContext, opts?: RpcOpts): Promise<void> {
        return client.wshRpcCall("vdomcreatecontext", data, opts);
    }

    // command "vdomrender" [call]
    VDomRenderCommand(client: WshClient, data: VDomFrontendUpdate, opts?: RpcOpts): Promise<VDomBackendUpdate> {
        return client.wshRpcCall("vdomrender", data, opts);
    }

    // command "webselector" [call]
    WebSelectorCommand(client: WshClient, data: CommandWebSelectorData, opts?: RpcOpts): Promise<string[]> {
        return client.wshRpcCall("webselector", data, opts);
    }

}

export const RpcApi = new RpcApiType();
