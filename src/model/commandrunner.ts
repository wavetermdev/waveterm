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

class CommandRunner {
    globalModel: Model;

    private constructor(globalModel: Model) {
        this.globalModel = globalModel;
    }

    static getInstance() {
        if (!(window as any).GlobalCommandRunner) {
            const globalModel = Model.getInstance();
            (window as any).GlobalCommandRunner = new CommandRunner(globalModel);
        }
        return (window as any).GlobalCommandRunner;
    }

    loadHistory(show: boolean, htype: string) {
        let kwargs = { nohist: "1" };
        if (!show) {
            kwargs["noshow"] = "1";
        }
        if (htype != null && htype != "screen") {
            kwargs["type"] = htype;
        }
        this.globalModel.submitCommand("history", null, null, kwargs, true);
    }

    resetShellState() {
        this.globalModel.submitCommand("reset", null, null, null, true);
    }

    historyPurgeLines(lines: string[]): Promise<CommandRtnType> {
        let prtn = this.globalModel.submitCommand("history", "purge", lines, { nohist: "1" }, false);
        return prtn;
    }

    switchSession(session: string) {
        mobx.action(() => {
            this.globalModel.activeMainView.set("session");
        })();
        this.globalModel.submitCommand("session", null, [session], { nohist: "1" }, false);
    }

    switchScreen(screen: string, session?: string) {
        mobx.action(() => {
            this.globalModel.activeMainView.set("session");
        })();
        let kwargs = { nohist: "1" };
        if (session != null) {
            kwargs["session"] = session;
        }
        this.globalModel.submitCommand("screen", null, [screen], kwargs, false);
    }

    lineView(sessionId: string, screenId: string, lineNum?: number) {
        let screen = this.globalModel.getScreenById(sessionId, screenId);
        if (screen != null && lineNum != null) {
            screen.setAnchorFields(lineNum, 0, "line:view");
        }
        let lineNumStr = lineNum == null || lineNum == 0 ? "E" : String(lineNum);
        this.globalModel.submitCommand("line", "view", [sessionId, screenId, lineNumStr], { nohist: "1" }, false);
    }

    lineArchive(lineArg: string, archive: boolean): Promise<CommandRtnType> {
        let kwargs = { nohist: "1" };
        let archiveStr = archive ? "1" : "0";
        return this.globalModel.submitCommand("line", "archive", [lineArg, archiveStr], kwargs, false);
    }

    lineDelete(lineArg: string, interactive: boolean): Promise<CommandRtnType> {
        return this.globalModel.submitCommand("line", "delete", [lineArg], { nohist: "1" }, interactive);
    }

    lineRestart(lineArg: string, interactive: boolean): Promise<CommandRtnType> {
        return this.globalModel.submitCommand("line", "restart", [lineArg], { nohist: "1" }, interactive);
    }

    lineSet(lineArg: string, opts: { renderer?: string }): Promise<CommandRtnType> {
        let kwargs = { nohist: "1" };
        if ("renderer" in opts) {
            kwargs["renderer"] = opts.renderer ?? "";
        }
        return this.globalModel.submitCommand("line", "set", [lineArg], kwargs, false);
    }

    createNewSession() {
        this.globalModel.submitCommand("session", "open", null, { nohist: "1" }, false);
    }

    createNewScreen() {
        this.globalModel.submitCommand("screen", "open", null, { nohist: "1" }, false);
    }

    closeScreen(screen: string) {
        this.globalModel.submitCommand("screen", "close", [screen], { nohist: "1" }, false);
    }

    // include is lineIds to include, exclude is lineIds to exclude
    // if include is given then it *only* does those ids.  if exclude is given (or not),
    // it does all running commands in the screen except for excluded.
    resizeScreen(screenId: string, rows: number, cols: number, opts?: { include?: string[]; exclude?: string[] }) {
        let kwargs: Record<string, string> = {
            nohist: "1",
            screen: screenId,
            cols: String(cols),
            rows: String(rows),
        };
        if (opts?.include != null && opts?.include.length > 0) {
            kwargs.include = opts.include.join(",");
        }
        if (opts?.exclude != null && opts?.exclude.length > 0) {
            kwargs.exclude = opts.exclude.join(",");
        }
        this.globalModel.submitCommand("screen", "resize", null, kwargs, false);
    }

    screenArchive(screenId: string, shouldArchive: boolean): Promise<CommandRtnType> {
        return this.globalModel.submitCommand(
            "screen",
            "archive",
            [screenId, shouldArchive ? "1" : "0"],
            { nohist: "1" },
            false
        );
    }

    screenDelete(screenId: string, interactive: boolean): Promise<CommandRtnType> {
        return this.globalModel.submitCommand("screen", "delete", [screenId], { nohist: "1" }, interactive);
    }

    screenWebShare(screenId: string, shouldShare: boolean): Promise<CommandRtnType> {
        let kwargs: Record<string, string> = { nohist: "1" };
        kwargs["screen"] = screenId;
        return this.globalModel.submitCommand("screen", "webshare", [shouldShare ? "1" : "0"], kwargs, false);
    }

    showRemote(remoteid: string) {
        this.globalModel.submitCommand("remote", "show", null, { nohist: "1", remote: remoteid }, true);
    }

    showAllRemotes() {
        this.globalModel.submitCommand("remote", "showall", null, { nohist: "1" }, true);
    }

    connectRemote(remoteid: string) {
        this.globalModel.submitCommand("remote", "connect", null, { nohist: "1", remote: remoteid }, true);
    }

    disconnectRemote(remoteid: string) {
        this.globalModel.submitCommand("remote", "disconnect", null, { nohist: "1", remote: remoteid }, true);
    }

    installRemote(remoteid: string) {
        this.globalModel.submitCommand("remote", "install", null, { nohist: "1", remote: remoteid }, true);
    }

    installCancelRemote(remoteid: string) {
        this.globalModel.submitCommand("remote", "installcancel", null, { nohist: "1", remote: remoteid }, true);
    }

    createRemote(cname: string, kwargsArg: Record<string, string>, interactive: boolean): Promise<CommandRtnType> {
        let kwargs = Object.assign({}, kwargsArg);
        kwargs["nohist"] = "1";
        return this.globalModel.submitCommand("remote", "new", [cname], kwargs, interactive);
    }

    openCreateRemote(): void {
        this.globalModel.submitCommand("remote", "new", null, { nohist: "1", visual: "1" }, true);
    }

    screenSetRemote(remoteArg: string, nohist: boolean, interactive: boolean): Promise<CommandRtnType> {
        let kwargs = {};
        if (nohist) {
            kwargs["nohist"] = "1";
        }
        return this.globalModel.submitCommand("connect", null, [remoteArg], kwargs, interactive);
    }

    editRemote(remoteid: string, kwargsArg: Record<string, string>): void {
        let kwargs = Object.assign({}, kwargsArg);
        kwargs["nohist"] = "1";
        kwargs["remote"] = remoteid;
        this.globalModel.submitCommand("remote", "set", null, kwargs, true);
    }

    openEditRemote(remoteid: string): void {
        this.globalModel.submitCommand("remote", "set", null, { remote: remoteid, nohist: "1", visual: "1" }, true);
    }

    archiveRemote(remoteid: string) {
        this.globalModel.submitCommand("remote", "archive", null, { remote: remoteid, nohist: "1" }, true);
    }

    importSshConfig() {
        this.globalModel.submitCommand("remote", "parse", null, { nohist: "1", visual: "1" }, true);
    }

    screenSelectLine(lineArg: string, focusVal?: string) {
        let kwargs: Record<string, string> = {
            nohist: "1",
            line: lineArg,
        };
        if (focusVal != null) {
            kwargs["focus"] = focusVal;
        }
        this.globalModel.submitCommand("screen", "set", null, kwargs, false);
    }

    screenReorder(screenId: string, index: string) {
        let kwargs: Record<string, string> = {
            nohist: "1",
            screenId: screenId,
            index: index,
        };
        this.globalModel.submitCommand("screen", "reorder", null, kwargs, false);
    }

    setTermUsedRows(termContext: RendererContext, height: number) {
        let kwargs: Record<string, string> = {};
        kwargs["screen"] = termContext.screenId;
        kwargs["hohist"] = "1";
        let posargs = [String(termContext.lineNum), String(height)];
        this.globalModel.submitCommand("line", "setheight", posargs, kwargs, false);
    }

    screenSetAnchor(sessionId: string, screenId: string, anchorVal: string): void {
        let kwargs = {
            nohist: "1",
            anchor: anchorVal,
            session: sessionId,
            screen: screenId,
        };
        this.globalModel.submitCommand("screen", "set", null, kwargs, false);
    }

    screenSetFocus(focusVal: string): void {
        this.globalModel.submitCommand("screen", "set", null, { focus: focusVal, nohist: "1" }, false);
    }

    screenSetSettings(
        screenId: string,
        settings: { tabcolor?: string; tabicon?: string; name?: string; sharename?: string },
        interactive: boolean
    ): Promise<CommandRtnType> {
        let kwargs: { [key: string]: any } = Object.assign({}, settings);
        kwargs["nohist"] = "1";
        kwargs["screen"] = screenId;
        return this.globalModel.submitCommand("screen", "set", null, kwargs, interactive);
    }

    sessionArchive(sessionId: string, shouldArchive: boolean): Promise<CommandRtnType> {
        return this.globalModel.submitCommand(
            "session",
            "archive",
            [sessionId, shouldArchive ? "1" : "0"],
            { nohist: "1" },
            false
        );
    }

    sessionDelete(sessionId: string): Promise<CommandRtnType> {
        return this.globalModel.submitCommand("session", "delete", [sessionId], { nohist: "1" }, false);
    }

    sessionSetSettings(sessionId: string, settings: { name?: string }, interactive: boolean): Promise<CommandRtnType> {
        let kwargs = Object.assign({}, settings);
        kwargs["nohist"] = "1";
        kwargs["session"] = sessionId;
        return this.globalModel.submitCommand("session", "set", null, kwargs, interactive);
    }

    lineStar(lineId: string, starVal: number) {
        this.globalModel.submitCommand("line", "star", [lineId, String(starVal)], { nohist: "1" }, true);
    }

    lineBookmark(lineId: string) {
        this.globalModel.submitCommand("line", "bookmark", [lineId], { nohist: "1" }, true);
    }

    linePin(lineId: string, val: boolean) {
        this.globalModel.submitCommand("line", "pin", [lineId, val ? "1" : "0"], { nohist: "1" }, true);
    }

    bookmarksView() {
        this.globalModel.submitCommand("bookmarks", "show", null, { nohist: "1" }, true);
    }

    connectionsView() {
        this.globalModel.connectionViewModel.showConnectionsView();
    }

    clientSettingsView() {
        this.globalModel.clientSettingsViewModel.showClientSettingsView();
    }

    historyView(params: HistorySearchParams) {
        let kwargs = { nohist: "1" };
        kwargs["offset"] = String(params.offset);
        kwargs["rawoffset"] = String(params.rawOffset);
        if (params.searchText != null) {
            kwargs["text"] = params.searchText;
        }
        if (params.searchSessionId != null) {
            kwargs["searchsession"] = params.searchSessionId;
        }
        if (params.searchRemoteId != null) {
            kwargs["searchremote"] = params.searchRemoteId;
        }
        if (params.fromTs != null) {
            kwargs["fromts"] = String(params.fromTs);
        }
        if (params.noMeta) {
            kwargs["meta"] = "0";
        }
        if (params.filterCmds) {
            kwargs["filter"] = "1";
        }
        this.globalModel.submitCommand("history", "viewall", null, kwargs, true);
    }

    telemetryOff(interactive: boolean): Promise<CommandRtnType> {
        return this.globalModel.submitCommand("telemetry", "off", null, { nohist: "1" }, interactive);
    }

    telemetryOn(interactive: boolean): Promise<CommandRtnType> {
        return this.globalModel.submitCommand("telemetry", "on", null, { nohist: "1" }, interactive);
    }

    releaseCheckAutoOff(interactive: boolean): Promise<CommandRtnType> {
        return this.globalModel.submitCommand("releasecheck", "autooff", null, { nohist: "1" }, interactive);
    }

    releaseCheckAutoOn(interactive: boolean): Promise<CommandRtnType> {
        return this.globalModel.submitCommand("releasecheck", "autoon", null, { nohist: "1" }, interactive);
    }

    setTermFontSize(fsize: number, interactive: boolean): Promise<CommandRtnType> {
        let kwargs = {
            nohist: "1",
            termfontsize: String(fsize),
        };
        return this.globalModel.submitCommand("client", "set", null, kwargs, interactive);
    }

    setClientOpenAISettings(opts: { model?: string; apitoken?: string; maxtokens?: string }): Promise<CommandRtnType> {
        let kwargs = {
            nohist: "1",
        };
        if (opts.model != null) {
            kwargs["openaimodel"] = opts.model;
        }
        if (opts.apitoken != null) {
            kwargs["openaiapitoken"] = opts.apitoken;
        }
        if (opts.maxtokens != null) {
            kwargs["openaimaxtokens"] = opts.maxtokens;
        }
        return this.globalModel.submitCommand("client", "set", null, kwargs, false);
    }

    clientAcceptTos(): void {
        this.globalModel.submitCommand("client", "accepttos", null, { nohist: "1" }, true);
    }

    clientSetConfirmFlag(flag: string, value: boolean): Promise<CommandRtnType> {
        let kwargs = { nohist: "1" };
        let valueStr = value ? "1" : "0";
        return this.globalModel.submitCommand("client", "setconfirmflag", [flag, valueStr], kwargs, false);
    }

    clientSetSidebar(width: number, collapsed: boolean): Promise<CommandRtnType> {
        let kwargs = { nohist: "1", width: `${width}`, collapsed: collapsed ? "1" : "0" };
        return this.globalModel.submitCommand("client", "setsidebar", null, kwargs, false);
    }

    editBookmark(bookmarkId: string, desc: string, cmdstr: string) {
        let kwargs = {
            nohist: "1",
            desc: desc,
            cmdstr: cmdstr,
        };
        this.globalModel.submitCommand("bookmark", "set", [bookmarkId], kwargs, true);
    }

    deleteBookmark(bookmarkId: string): void {
        this.globalModel.submitCommand("bookmark", "delete", [bookmarkId], { nohist: "1" }, true);
    }

    openSharedSession(): void {
        this.globalModel.submitCommand("session", "openshared", null, { nohist: "1" }, true);
    }

    setLineState(
        screenId: string,
        lineId: string,
        state: T.LineStateType,
        interactive: boolean
    ): Promise<CommandRtnType> {
        let stateStr = JSON.stringify(state);
        return this.globalModel.submitCommand(
            "line",
            "set",
            [lineId],
            { screen: screenId, nohist: "1", state: stateStr },
            interactive
        );
    }

    screenSidebarAddLine(lineId: string) {
        this.globalModel.submitCommand("sidebar", "add", null, { nohist: "1", line: lineId }, false);
    }

    screenSidebarRemove() {
        this.globalModel.submitCommand("sidebar", "remove", null, { nohist: "1" }, false);
    }

    screenSidebarClose(): void {
        this.globalModel.submitCommand("sidebar", "close", null, { nohist: "1" }, false);
    }

    screenSidebarOpen(width?: string): void {
        let kwargs: Record<string, string> = { nohist: "1" };
        if (width != null) {
            kwargs.width = width;
        }
        this.globalModel.submitCommand("sidebar", "open", null, kwargs, false);
    }
}

export { CommandRunner };
