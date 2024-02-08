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
    isBlank,
    ces,
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
import { OV, OArr, OMap } from "../types/types";
import { Model } from "./model";
import { Screen } from "./screen";

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

class Session {
    sessionId: string;
    name: OV<string>;
    activeScreenId: OV<string>;
    sessionIdx: OV<number>;
    notifyNum: OV<number> = mobx.observable.box(0);
    remoteInstances: OArr<RemoteInstanceType>;
    archived: OV<boolean>;
    globalModel: Model;

    constructor(sdata: SessionDataType, globalModel: Model) {
        this.globalModel = globalModel;
        this.sessionId = sdata.sessionid;
        this.name = mobx.observable.box(sdata.name);
        this.sessionIdx = mobx.observable.box(sdata.sessionidx);
        this.archived = mobx.observable.box(!!sdata.archived);
        this.activeScreenId = mobx.observable.box(ces(sdata.activescreenid));
        let remotes = sdata.remotes || [];
        this.remoteInstances = mobx.observable.array(remotes);
    }

    dispose(): void {}

    // session updates only contain screens (no windows)
    mergeData(sdata: SessionDataType) {
        if (sdata.sessionid != this.sessionId) {
            throw new Error(
                sprintf(
                    "cannot merge session data, sessionids don't match sid=%s, data-sid=%s",
                    this.sessionId,
                    sdata.sessionid
                )
            );
        }
        mobx.action(() => {
            if (!isBlank(sdata.name)) {
                this.name.set(sdata.name);
            }
            if (sdata.sessionidx > 0) {
                this.sessionIdx.set(sdata.sessionidx);
            }
            if (sdata.notifynum >= 0) {
                this.notifyNum.set(sdata.notifynum);
            }
            this.archived.set(!!sdata.archived);
            if (!isBlank(sdata.activescreenid)) {
                let screen = this.getScreenById(sdata.activescreenid);
                if (screen == null) {
                    console.log(
                        sprintf("got session update, activescreenid=%s, screen not found", sdata.activescreenid)
                    );
                } else {
                    this.activeScreenId.set(sdata.activescreenid);
                }
            }
            genMergeSimpleData(this.remoteInstances, sdata.remotes, (r) => r.riid, null);
        })();
    }

    getActiveScreen(): Screen {
        return this.getScreenById(this.activeScreenId.get());
    }

    setActiveScreenId(screenId: string) {
        this.activeScreenId.set(screenId);
    }

    getScreenById(screenId: string): Screen {
        if (screenId == null) {
            return null;
        }
        return this.globalModel.getScreenById(this.sessionId, screenId);
    }

    getRemoteInstance(screenId: string, rptr: RemotePtrType): RemoteInstanceType {
        if (rptr.name.startsWith("*")) {
            screenId = "";
        }
        for (const rdata of this.remoteInstances) {
            if (
                rdata.screenid == screenId &&
                rdata.remoteid == rptr.remoteid &&
                rdata.remoteownerid == rptr.ownerid &&
                rdata.name == rptr.name
            ) {
                return rdata;
            }
        }
        let remote = this.globalModel.getRemote(rptr.remoteid);
        if (remote != null) {
            return {
                riid: "",
                sessionid: this.sessionId,
                screenid: screenId,
                remoteownerid: rptr.ownerid,
                remoteid: rptr.remoteid,
                name: rptr.name,
                festate: remote.defaultfestate,
                shelltype: remote.defaultshelltype,
            };
        }
        return null;
    }
}

export { Session };
