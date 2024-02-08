import { sprintf } from "sprintf-js";
import { Model } from "../model/model";
import {
    SessionDataType,
    LineType,
    RemoteType,
    HistoryItem,
    RemoteInstanceType,
    RemotePtrType,
    CmdDataType,
    FeCmdPacketType,
    TermOptsType,
    ScreenDataType,
    ScreenOptsType,
    PtyDataUpdateType,
    ModelUpdateType,
    UpdateMessage,
    InfoType,
    UIContextType,
    HistoryInfoType,
    HistoryQueryOpts,
    FeInputPacketType,
    RemoteInputPacketType,
    ContextMenuOpts,
    RendererContext,
    RendererModel,
    PtyDataType,
    BookmarkType,
    ClientDataType,
    HistoryViewDataType,
    AlertMessageType,
    HistorySearchParams,
    FocusTypeStrs,
    ScreenLinesType,
    HistoryTypeStrs,
    RendererPluginType,
    WindowSize,
    WebShareOpts,
    TermContextUnion,
    RemoteEditType,
    RemoteViewType,
    CommandRtnType,
    WebCmd,
    WebRemote,
    OpenAICmdInfoChatMessageType,
    StatusIndicatorLevel,
} from "../types/types";
import { isBlank } from "./util";

function getTermPtyData(termContext: TermContextUnion, globalModel: Model): Promise<PtyDataType> {
    if ("remoteId" in termContext) {
        return getRemotePtyData(termContext.remoteId, globalModel);
    }
    return getPtyData(termContext.screenId, termContext.lineId, termContext.lineNum, globalModel);
}

function getPtyData(screenId: string, lineId: string, lineNum: number, globalModel: Model): Promise<PtyDataType> {
    let url = sprintf(
        globalModel.getBaseHostPort() + "/api/ptyout?linenum=%d&screenid=%s&lineid=%s",
        lineNum,
        screenId,
        lineId
    );
    return getPtyDataFromUrl(url, globalModel);
}

function getRemotePtyData(remoteId: string, globalModel: Model): Promise<PtyDataType> {
    let url = sprintf(globalModel.getBaseHostPort() + "/api/remote-pty?remoteid=%s", remoteId);
    return getPtyDataFromUrl(url, globalModel);
}

function getPtyDataFromUrl(url: string, globalModel: Model): Promise<PtyDataType> {
    let ptyOffset = 0;
    let fetchHeaders = globalModel.getFetchHeaders();
    return fetch(url, { headers: fetchHeaders })
        .then((resp) => {
            if (!resp.ok) {
                throw new Error(sprintf("Bad fetch response for /api/ptyout: %d %s", resp.status, resp.statusText));
            }
            let ptyOffsetStr = resp.headers.get("X-PtyDataOffset");
            if (ptyOffsetStr != null && !isNaN(parseInt(ptyOffsetStr))) {
                ptyOffset = parseInt(ptyOffsetStr);
            }
            return resp.arrayBuffer();
        })
        .then((buf) => {
            return { pos: ptyOffset, data: new Uint8Array(buf) };
        });
}

function remotePtrToString(rptr: RemotePtrType): string {
    if (rptr == null || isBlank(rptr.remoteid)) {
        return null;
    }
    if (isBlank(rptr.ownerid) && isBlank(rptr.name)) {
        return rptr.remoteid;
    }
    if (!isBlank(rptr.ownerid) && isBlank(rptr.name)) {
        return sprintf("@%s:%s", rptr.ownerid, rptr.remoteid);
    }
    if (isBlank(rptr.ownerid) && !isBlank(rptr.name)) {
        return sprintf("%s:%s", rptr.remoteid, rptr.name);
    }
    return sprintf("@%s:%s:%s", rptr.ownerid, rptr.remoteid, rptr.name);
}

function cmdPacketString(pk: FeCmdPacketType): string {
    let cmd = pk.metacmd;
    if (pk.metasubcmd != null) {
        cmd += ":" + pk.metasubcmd;
    }
    let parts = [cmd];
    if (pk.kwargs != null) {
        for (let key in pk.kwargs) {
            parts.push(sprintf("%s=%s", key, pk.kwargs[key]));
        }
    }
    if (pk.args != null) {
        parts.push(...pk.args);
    }
    return parts.join(" ");
}

export { getTermPtyData, remotePtrToString, cmdPacketString };
