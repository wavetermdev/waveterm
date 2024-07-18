// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// generated by cmd/generate/main-generate.go

import * as WOS from "./wos";

// WshServerCommandToDeclMap
class WshServerType {
    // command "controller:input" [call]
	BlockInputCommand(data: CommandBlockInputData, opts?: WshRpcCommandOpts): Promise<void> {
        const meta: WshServerCommandMeta = {commandtype: "call"};
        return WOS.callWshServerRpc("controller:input", data, meta, opts);
    }

    // command "controller:restart" [call]
	BlockRestartCommand(data: CommandBlockRestartData, opts?: WshRpcCommandOpts): Promise<void> {
        const meta: WshServerCommandMeta = {commandtype: "call"};
        return WOS.callWshServerRpc("controller:restart", data, meta, opts);
    }

    // command "createblock" [call]
	CreateBlockCommand(data: CommandCreateBlockData, opts?: WshRpcCommandOpts): Promise<ORef> {
        const meta: WshServerCommandMeta = {commandtype: "call"};
        return WOS.callWshServerRpc("createblock", data, meta, opts);
    }

    // command "file:append" [call]
	AppendFileCommand(data: CommandAppendFileData, opts?: WshRpcCommandOpts): Promise<void> {
        const meta: WshServerCommandMeta = {commandtype: "call"};
        return WOS.callWshServerRpc("file:append", data, meta, opts);
    }

    // command "file:appendijson" [call]
	AppendIJsonCommand(data: CommandAppendIJsonData, opts?: WshRpcCommandOpts): Promise<void> {
        const meta: WshServerCommandMeta = {commandtype: "call"};
        return WOS.callWshServerRpc("file:appendijson", data, meta, opts);
    }

    // command "getmeta" [call]
	GetMetaCommand(data: CommandGetMetaData, opts?: WshRpcCommandOpts): Promise<MetaType> {
        const meta: WshServerCommandMeta = {commandtype: "call"};
        return WOS.callWshServerRpc("getmeta", data, meta, opts);
    }

    // command "message" [call]
	MessageCommand(data: CommandMessageData, opts?: WshRpcCommandOpts): Promise<void> {
        const meta: WshServerCommandMeta = {commandtype: "call"};
        return WOS.callWshServerRpc("message", data, meta, opts);
    }

    // command "resolveids" [call]
	ResolveIdsCommand(data: CommandResolveIdsData, opts?: WshRpcCommandOpts): Promise<CommandResolveIdsRtnData> {
        const meta: WshServerCommandMeta = {commandtype: "call"};
        return WOS.callWshServerRpc("resolveids", data, meta, opts);
    }

    // command "setmeta" [call]
	SetMetaCommand(data: CommandSetMetaData, opts?: WshRpcCommandOpts): Promise<void> {
        const meta: WshServerCommandMeta = {commandtype: "call"};
        return WOS.callWshServerRpc("setmeta", data, meta, opts);
    }

    // command "setview" [call]
	BlockSetViewCommand(data: CommandBlockSetViewData, opts?: WshRpcCommandOpts): Promise<void> {
        const meta: WshServerCommandMeta = {commandtype: "call"};
        return WOS.callWshServerRpc("setview", data, meta, opts);
    }

}

export const WshServer = new WshServerType();