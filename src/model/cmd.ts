// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type React from "react";
import * as mobx from "mobx";
import { sprintf } from "sprintf-js";
import { v4 as uuidv4 } from "uuid";
import { boundMethod } from "autobind-decorator";
import { debounce } from "throttle-debounce";
import * as mobxReact from "mobx-react";
import {
    handleJsonFetchResponse,
    base64ToString,
    stringToBase64,
    base64ToArray,
    genMergeData,
    genMergeDataMap,
    genMergeSimpleData,
    boundInt,
    isModKeyPress,
} from "../util/util";
import { TermWrap } from "../plugins/terminal/term";
import { PluginModel } from "../plugins/plugins";
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
import * as T from "../types/types";
import { WSControl } from "./ws";
import {
    getMonoFontSize,
    windowWidthToCols,
    windowHeightToRows,
    termWidthFromCols,
    termHeightFromRows,
} from "../util/textmeasure";
import dayjs from "dayjs";
import localizedFormat from "dayjs/plugin/localizedFormat";
import customParseFormat from "dayjs/plugin/customParseFormat";
import { getRendererContext, cmdStatusIsRunning } from "../app/line/lineutil";
import { MagicLayout } from "../app/magiclayout";
import { modalsRegistry } from "../app/common/modals/registry";
import * as appconst from "../app/appconst";
import { checkKeyPressed, adaptFromReactOrNativeKeyEvent, setKeyUtilPlatform } from "../util/keyutil";
import { Model } from "./model";
import { OV, OArr, OMap } from "../types/types";

dayjs.extend(customParseFormat);
dayjs.extend(localizedFormat);

const RemotePtyRows = 8; // also in main.tsx
const RemotePtyCols = 80;
const ProdServerEndpoint = "http://127.0.0.1:1619";
const ProdServerWsEndpoint = "ws://127.0.0.1:1623";
const DevServerEndpoint = "http://127.0.0.1:8090";
const DevServerWsEndpoint = "ws://127.0.0.1:8091";
const DefaultTermFontSize = 12;
const MinFontSize = 8;
const MaxFontSize = 24;
const InputChunkSize = 500;
const RemoteColors = ["red", "green", "yellow", "blue", "magenta", "cyan", "white", "orange"];
const TabColors = ["red", "orange", "yellow", "green", "mint", "cyan", "blue", "violet", "pink", "white"];
const TabIcons = [
    "sparkle",
    "fire",
    "ghost",
    "cloud",
    "compass",
    "crown",
    "droplet",
    "graduation-cap",
    "heart",
    "file",
];

// @ts-ignore
const VERSION = __WAVETERM_VERSION__;
// @ts-ignore
const BUILD = __WAVETERM_BUILD__;

class Cmd {
    model: Model;
    screenId: string;
    remote: RemotePtrType;
    lineId: string;
    data: OV<CmdDataType>;

    constructor(cmd: CmdDataType) {
        this.model = Model.getInstance();
        this.screenId = cmd.screenid;
        this.lineId = cmd.lineid;
        this.remote = cmd.remote;
        this.data = mobx.observable.box(cmd, { deep: false, name: "cmd-data" });
    }

    setCmd(cmd: CmdDataType) {
        mobx.action(() => {
            let origData = this.data.get();
            this.data.set(cmd);
            if (origData != null && cmd != null && origData.status != cmd.status) {
                this.model.cmdStatusUpdate(this.screenId, this.lineId, origData.status, cmd.status);
            }
        })();
    }

    getRestartTs(): number {
        return this.data.get().restartts;
    }

    getAsWebCmd(lineid: string): WebCmd {
        let cmd = this.data.get();
        let remote = this.model.getRemote(this.remote.remoteid);
        let webRemote: WebRemote = null;
        if (remote != null) {
            webRemote = {
                remoteid: cmd.remote.remoteid,
                alias: remote.remotealias,
                canonicalname: remote.remotecanonicalname,
                name: this.remote.name,
                homedir: remote.remotevars["home"],
                isroot: !!remote.remotevars["isroot"],
            };
        }
        let webCmd: WebCmd = {
            screenid: cmd.screenid,
            lineid: lineid,
            remote: webRemote,
            status: cmd.status,
            cmdstr: cmd.cmdstr,
            rawcmdstr: cmd.rawcmdstr,
            festate: cmd.festate,
            termopts: cmd.termopts,
            cmdpid: cmd.cmdpid,
            remotepid: cmd.remotepid,
            donets: cmd.donets,
            exitcode: cmd.exitcode,
            durationms: cmd.durationms,
            rtnstate: cmd.rtnstate,
            vts: 0,
            rtnstatestr: null,
        };
        return webCmd;
    }

    getExitCode(): number {
        return this.data.get().exitcode;
    }

    getRtnState(): boolean {
        return this.data.get().rtnstate;
    }

    getStatus(): string {
        return this.data.get().status;
    }

    getTermOpts(): TermOptsType {
        return this.data.get().termopts;
    }

    getCmdStr(): string {
        return this.data.get().cmdstr;
    }

    getRemoteFeState(): Record<string, string> {
        return this.data.get().festate;
    }

    isRunning(): boolean {
        let data = this.data.get();
        return cmdStatusIsRunning(data.status);
    }

    handleData(data: string, termWrap: TermWrap): void {
        if (!this.isRunning()) {
            return;
        }
        for (let pos = 0; pos < data.length; pos += InputChunkSize) {
            let dataChunk = data.slice(pos, pos + InputChunkSize);
            this.handleInputChunk(dataChunk);
        }
    }

    handleDataFromRenderer(data: string, renderer: RendererModel): void {
        if (!this.isRunning()) {
            return;
        }
        for (let pos = 0; pos < data.length; pos += InputChunkSize) {
            let dataChunk = data.slice(pos, pos + InputChunkSize);
            this.handleInputChunk(dataChunk);
        }
    }

    handleInputChunk(data: string): void {
        let inputPacket: FeInputPacketType = {
            type: "feinput",
            ck: this.screenId + "/" + this.lineId,
            remote: this.remote,
            inputdata64: stringToBase64(data),
        };
        this.model.sendInputPacket(inputPacket);
    }
}

export { Cmd };
