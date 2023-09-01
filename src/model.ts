import * as mobx from "mobx";
import { sprintf } from "sprintf-js";
import { boundMethod } from "autobind-decorator";
import { debounce } from "throttle-debounce";
import {
    handleJsonFetchResponse,
    base64ToArray,
    genMergeData,
    genMergeDataMap,
    genMergeSimpleData,
    boundInt,
    isModKeyPress,
} from "./util";
import { TermWrap } from "./term";
import { v4 as uuidv4 } from "uuid";
import type {
    SessionDataType,
    LineType,
    RemoteType,
    HistoryItem,
    RemoteInstanceType,
    RemotePtrType,
    CmdDataType,
    FeCmdPacketType,
    TermOptsType,
    RemoteStateType,
    ScreenDataType,
    ScreenOptsType,
    PtyDataUpdateType,
    ModelUpdateType,
    UpdateMessage,
    InfoType,
    CmdLineUpdateType,
    UIContextType,
    HistoryInfoType,
    HistoryQueryOpts,
    FeInputPacketType,
    TermWinSize,
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
} from "./types";
import * as T from "./types";
import { WSControl } from "./ws";
import {
    measureText,
    getMonoFontSize,
    windowWidthToCols,
    windowHeightToRows,
    termWidthFromCols,
    termHeightFromRows,
} from "./textmeasure";
import dayjs from "dayjs";
import localizedFormat from "dayjs/plugin/localizedFormat";
import customParseFormat from "dayjs/plugin/customParseFormat";
import { getRendererContext, cmdStatusIsRunning } from "./lineutil";

dayjs.extend(customParseFormat);
dayjs.extend(localizedFormat);

var GlobalUser = "sawka";
const RemotePtyRows = 8; // also in main.tsx
const RemotePtyCols = 80;
const ProdServerEndpoint = "http://127.0.0.1:1619";
const ProdServerWsEndpoint = "ws://127.0.0.1:1623";
const DevServerEndpoint = "http://127.0.0.1:8090";
const DevServerWsEndpoint = "ws://127.0.0.1:8091";
const DefaultTermFontSize = 12;
const MinFontSize = 8;
const MaxFontSize = 15;
const InputChunkSize = 500;
const RemoteColors = ["red", "green", "yellow", "blue", "magenta", "cyan", "white", "orange"];
const TabColors = ["red", "green", "yellow", "blue", "magenta", "cyan", "white", "orange", "black"];

// @ts-ignore
const VERSION = __PROMPT_VERSION__;
// @ts-ignore
const BUILD = __PROMPT_BUILD__;

type LineContainerModel = {
    loadTerminalRenderer: (elem: Element, line: LineType, cmd: Cmd, width: number) => void;
    registerRenderer: (lineId: string, renderer: RendererModel) => void;
    unloadRenderer: (lineId: string) => void;
    getIsFocused: (lineNum: number) => boolean;
    getTermWrap: (lineId: string) => TermWrap;
    getRenderer: (lineId: string) => RendererModel;
    getFocusType: () => FocusTypeStrs;
    getSelectedLine: () => number;
    getCmd: (line: LineType) => Cmd;
    setTermFocus: (lineNum: number, focus: boolean) => void;
    getUsedRows: (context: RendererContext, line: LineType, cmd: Cmd, width: number) => number;
    getContentHeight: (context: RendererContext) => number;
    setContentHeight: (context: RendererContext, height: number) => void;
    getMaxContentSize(): WindowSize;
    getIdealContentSize(): WindowSize;
};

type SWLinePtr = {
    line: LineType;
    slines: ScreenLines;
    screen: Screen;
};

function keyHasNoMods(e: any) {
    return !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;
}

type OV<V> = mobx.IObservableValue<V>;
type OArr<V> = mobx.IObservableArray<V>;
type OMap<K, V> = mobx.ObservableMap<K, V>;
type CV<V> = mobx.IComputedValue<V>;

function isBlank(s: string) {
    return s == null || s == "";
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

function riToRPtr(ri: RemoteInstanceType): RemotePtrType {
    if (ri == null) {
        return null;
    }
    return { ownerid: ri.remoteownerid, remoteid: ri.remoteid, name: ri.name };
}

type KeyModsType = {
    meta?: boolean;
    ctrl?: boolean;
    alt?: boolean;
    shift?: boolean;
};

type ElectronApi = {
    getId: () => string;
    getIsDev: () => boolean;
    getAuthKey: () => string;
    getLocalServerStatus: () => boolean;
    restartLocalServer: () => boolean;
    reloadWindow: () => void;
    onTCmd: (callback: (mods: KeyModsType) => void) => void;
    onICmd: (callback: (mods: KeyModsType) => void) => void;
    onLCmd: (callback: (mods: KeyModsType) => void) => void;
    onHCmd: (callback: (mods: KeyModsType) => void) => void;
    onMetaArrowUp: (callback: () => void) => void;
    onMetaArrowDown: (callback: () => void) => void;
    onMetaPageUp: (callback: () => void) => void;
    onMetaPageDown: (callback: () => void) => void;
    onBracketCmd: (callback: (event: any, arg: { relative: number }, mods: KeyModsType) => void) => void;
    onDigitCmd: (callback: (event: any, arg: { digit: number }, mods: KeyModsType) => void) => void;
    contextScreen: (screenOpts: { screenId: string }, position: { x: number; y: number }) => void;
    contextEditMenu: (position: { x: number; y: number }, opts: ContextMenuOpts) => void;
    onLocalServerStatusChange: (callback: (status: boolean, pid: number) => void) => void;
};

function getApi(): ElectronApi {
    return (window as any).api;
}

// clean empty string
function ces(s: string) {
    if (s == "") {
        return null;
    }
    return s;
}

class Cmd {
    screenId: string;
    remote: RemotePtrType;
    lineId: string;
    data: OV<CmdDataType>;

    constructor(cmd: CmdDataType) {
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
                GlobalModel.cmdStatusUpdate(this.screenId, this.lineId, origData.status, cmd.status);
            }
        })();
    }

    getAsWebCmd(lineid: string): WebCmd {
        let cmd = this.data.get();
        let remote = GlobalModel.getRemote(this.remote.remoteid);
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
        // console.log("handle data", {data: data});
        if (!this.isRunning()) {
            return;
        }
        for (let pos = 0; pos < data.length; pos += InputChunkSize) {
            let dataChunk = data.slice(pos, pos + InputChunkSize);
            this.handleInputChunk(dataChunk);
        }
    }

    handleDataFromRenderer(data: string, renderer: RendererModel): void {
        // console.log("handle data", {data: data});
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
            inputdata64: btoa(data),
        };
        GlobalModel.sendInputPacket(inputPacket);
    }
}

class Screen {
    sessionId: string;
    screenId: string;
    screenIdx: OV<number>;
    opts: OV<ScreenOptsType>;
    name: OV<string>;
    archived: OV<boolean>;
    curRemote: OV<RemotePtrType>;
    lastScreenSize: WindowSize;
    lastCols: number;
    lastRows: number;
    selectedLine: OV<number>;
    focusType: OV<FocusTypeStrs>;
    anchor: OV<{ anchorLine: number; anchorOffset: number }>;
    termLineNumFocus: OV<number>;
    setAnchor_debounced: (anchorLine: number, anchorOffset: number) => void;
    terminals: Record<string, TermWrap> = {}; // lineid => TermWrap
    renderers: Record<string, RendererModel> = {}; // lineid => RendererModel
    shareMode: OV<string>;
    webShareOpts: OV<WebShareOpts>;

    constructor(sdata: ScreenDataType) {
        this.sessionId = sdata.sessionid;
        this.screenId = sdata.screenid;
        this.name = mobx.observable.box(sdata.name, { name: "screen-name" });
        this.screenIdx = mobx.observable.box(sdata.screenidx, {
            name: "screen-screenidx",
        });
        this.opts = mobx.observable.box(sdata.screenopts, { name: "screen-opts" });
        this.archived = mobx.observable.box(!!sdata.archived, {
            name: "screen-archived",
        });
        this.focusType = mobx.observable.box(sdata.focustype, {
            name: "focusType",
        });
        this.selectedLine = mobx.observable.box(sdata.selectedline == 0 ? null : sdata.selectedline, {
            name: "selectedLine",
        });
        this.setAnchor_debounced = debounce(1000, this.setAnchor.bind(this));
        this.anchor = mobx.observable.box(
            { anchorLine: sdata.selectedline, anchorOffset: 0 },
            { name: "screen-anchor" }
        );
        this.termLineNumFocus = mobx.observable.box(0, {
            name: "termLineNumFocus",
        });
        this.curRemote = mobx.observable.box(sdata.curremote, {
            name: "screen-curRemote",
        });
        this.shareMode = mobx.observable.box(sdata.sharemode, {
            name: "screen-shareMode",
        });
        this.webShareOpts = mobx.observable.box(sdata.webshareopts, {
            name: "screen-webShareOpts",
        });
    }

    dispose() {}

    isWebShared(): boolean {
        return this.shareMode.get() == "web" && this.webShareOpts.get() != null;
    }

    getShareName(): string {
        if (!this.isWebShared()) {
            return null;
        }
        let opts = this.webShareOpts.get();
        if (opts == null) {
            return null;
        }
        return opts.sharename;
    }

    getWebShareUrl(): string {
        let viewKey: string = null;
        if (this.webShareOpts.get() != null) {
            viewKey = this.webShareOpts.get().viewkey;
        }
        if (viewKey == null) {
            return null;
        }
        if (GlobalModel.isDev) {
            return sprintf(
                "http://devtest.getprompt.com:9001/static/index-dev.html?screenid=%s&viewkey=%s",
                this.screenId,
                viewKey
            );
        }
        return sprintf("https://share.getprompt.dev/share/%s?viewkey=%s", this.screenId, viewKey);
    }

    mergeData(data: ScreenDataType) {
        if (data.sessionid != this.sessionId || data.screenid != this.screenId) {
            throw new Error("invalid screen update, ids don't match");
        }
        mobx.action(() => {
            this.screenIdx.set(data.screenidx);
            this.opts.set(data.screenopts);
            this.name.set(data.name);
            this.archived.set(!!data.archived);
            let oldSelectedLine = this.selectedLine.get();
            let oldFocusType = this.focusType.get();
            this.selectedLine.set(data.selectedline);
            this.curRemote.set(data.curremote);
            this.focusType.set(data.focustype);
            this.refocusLine(data, oldFocusType, oldSelectedLine);
            this.shareMode.set(data.sharemode);
            this.webShareOpts.set(data.webshareopts);
            // do not update anchorLine/anchorOffset (only stored)
        })();
    }

    getContentHeight(context: RendererContext): number {
        return GlobalModel.getContentHeight(context);
    }

    setContentHeight(context: RendererContext, height: number): void {
        GlobalModel.setContentHeight(context, height);
    }

    getCmd(line: LineType): Cmd {
        return GlobalModel.getCmd(line);
    }

    getAnchorStr(): string {
        let anchor = this.anchor.get();
        if (anchor.anchorLine == null || anchor.anchorLine == 0) {
            return "0";
        }
        return sprintf("%d:%d", anchor.anchorLine, anchor.anchorOffset);
    }

    getTabColor(): string {
        let tabColor = "green";
        let screenOpts = this.opts.get();
        if (screenOpts != null && !isBlank(screenOpts.tabcolor)) {
            tabColor = screenOpts.tabcolor;
        }
        return tabColor;
    }

    getCurRemoteInstance(): RemoteInstanceType {
        let session = GlobalModel.getSessionById(this.sessionId);
        let rptr = this.curRemote.get();
        if (rptr == null) {
            return null;
        }
        return session.getRemoteInstance(this.screenId, rptr);
    }

    setAnchorFields(anchorLine: number, anchorOffset: number, reason: string): void {
        mobx.action(() => {
            this.anchor.set({ anchorLine: anchorLine, anchorOffset: anchorOffset });
        })();
        // console.log("set-anchor-fields", anchorLine, anchorOffset, reason);
    }

    refocusLine(sdata: ScreenDataType, oldFocusType: string, oldSelectedLine: number): void {
        let isCmdFocus = sdata.focustype == "cmd";
        if (!isCmdFocus) {
            return;
        }
        let curLineFocus = GlobalModel.getFocusedLine();
        let sline: LineType = null;
        if (sdata.selectedline != 0) {
            sline = this.getLineByNum(sdata.selectedline);
        }
        // console.log("refocus", curLineFocus.linenum, "=>", sdata.selectedline, sline.lineid);
        if (
            curLineFocus.cmdInputFocus ||
            (curLineFocus.linenum != null && curLineFocus.linenum != sdata.selectedline)
        ) {
            (document.activeElement as HTMLElement).blur();
        }
        if (sline != null) {
            let renderer = this.getRenderer(sline.lineid);
            if (renderer != null) {
                renderer.giveFocus();
            }
            let termWrap = this.getTermWrap(sline.lineid);
            if (termWrap != null) {
                termWrap.giveFocus();
            }
        }
    }

    setFocusType(ftype: FocusTypeStrs): void {
        mobx.action(() => {
            this.focusType.set(ftype);
        })();
    }

    setAnchor(anchorLine: number, anchorOffset: number): void {
        let setVal = anchorLine == null || anchorLine == 0 ? "0" : sprintf("%d:%d", anchorLine, anchorOffset);
        GlobalCommandRunner.screenSetAnchor(this.sessionId, this.screenId, setVal);
    }

    getAnchor(): { anchorLine: number; anchorOffset: number } {
        let anchor = this.anchor.get();
        if (anchor.anchorLine == null || anchor.anchorLine == 0) {
            return { anchorLine: this.selectedLine.get(), anchorOffset: 0 };
        }
        return anchor;
    }

    getMaxLineNum(): number {
        let win = this.getScreenLines();
        if (win == null) {
            return null;
        }
        let lines = win.lines;
        if (lines == null || lines.length == 0) {
            return null;
        }
        return lines[lines.length - 1].linenum;
    }

    getLineByNum(lineNum: number): LineType {
        if (lineNum == null) {
            return null;
        }
        let win = this.getScreenLines();
        if (win == null) {
            return null;
        }
        let lines = win.lines;
        if (lines == null || lines.length == 0) {
            return null;
        }
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].linenum == lineNum) {
                return lines[i];
            }
        }
        return null;
    }

    getPresentLineNum(lineNum: number): number {
        let win = this.getScreenLines();
        if (win == null || !win.loaded.get()) {
            return lineNum;
        }
        let lines = win.lines;
        if (lines == null || lines.length == 0) {
            return null;
        }
        if (lineNum == 0) {
            return null;
        }
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            if (line.linenum == lineNum) {
                return lineNum;
            }
            if (line.linenum > lineNum) {
                return line.linenum;
            }
        }
        return lines[lines.length - 1].linenum;
    }

    setSelectedLine(lineNum: number): void {
        mobx.action(() => {
            let pln = this.getPresentLineNum(lineNum);
            if (pln != this.selectedLine.get()) {
                this.selectedLine.set(pln);
            }
        })();
    }

    checkSelectedLine(): void {
        let pln = this.getPresentLineNum(this.selectedLine.get());
        if (pln != this.selectedLine.get()) {
            this.setSelectedLine(pln);
        }
    }

    updatePtyData(ptyMsg: PtyDataUpdateType) {
        let lineId = ptyMsg.lineid;
        let renderer = this.renderers[lineId];
        if (renderer != null) {
            let data = base64ToArray(ptyMsg.ptydata64);
            renderer.receiveData(ptyMsg.ptypos, data, "from-sw");
        }
        let term = this.terminals[lineId];
        if (term != null) {
            let data = base64ToArray(ptyMsg.ptydata64);
            term.receiveData(ptyMsg.ptypos, data, "from-sw");
        }
    }

    isActive(): boolean {
        let activeScreen = GlobalModel.getActiveScreen();
        if (activeScreen == null) {
            return false;
        }
        return this.sessionId == activeScreen.sessionId && this.screenId == activeScreen.screenId;
    }

    screenSizeCallback(winSize: WindowSize): void {
        if (winSize.height == 0 || winSize.width == 0) {
            return;
        }
        if (
            this.lastScreenSize != null &&
            this.lastScreenSize.height == winSize.height &&
            this.lastScreenSize.width == winSize.width
        ) {
            return;
        }
        this.lastScreenSize = winSize;
        let cols = windowWidthToCols(winSize.width, GlobalModel.termFontSize.get());
        let rows = windowHeightToRows(winSize.height, GlobalModel.termFontSize.get());
        this._termSizeCallback(rows, cols);
    }

    getMaxContentSize(): WindowSize {
        if (this.lastScreenSize == null) {
            let width = termWidthFromCols(80, GlobalModel.termFontSize.get());
            let height = termHeightFromRows(25, GlobalModel.termFontSize.get());
            return { width, height };
        }
        let winSize = this.lastScreenSize;
        let width = boundInt(winSize.width - 50, 100, 5000);
        let height = boundInt(winSize.height - 100, 100, 5000);
        return { width, height };
    }

    getIdealContentSize(): WindowSize {
        if (this.lastScreenSize == null) {
            let width = termWidthFromCols(80, GlobalModel.termFontSize.get());
            let height = termHeightFromRows(25, GlobalModel.termFontSize.get());
            return { width, height };
        }
        let winSize = this.lastScreenSize;
        let width = boundInt(Math.ceil((winSize.width - 50) * 0.7), 100, 5000);
        let height = boundInt(Math.ceil((winSize.height - 100) * 0.5), 100, 5000);
        return { width, height };
    }

    _termSizeCallback(rows: number, cols: number): void {
        if (cols == 0 || rows == 0) {
            return;
        }
        if (rows == this.lastRows && cols == this.lastCols) {
            return;
        }
        this.lastRows = rows;
        this.lastCols = cols;
        for (let lineid in this.terminals) {
            this.terminals[lineid].resizeCols(cols);
        }
        GlobalCommandRunner.resizeScreen(this.screenId, rows, cols);
    }

    getTermWrap(lineId: string): TermWrap {
        return this.terminals[lineId];
    }

    getRenderer(lineId: string): RendererModel {
        return this.renderers[lineId];
    }

    registerRenderer(lineId: string, renderer: RendererModel) {
        this.renderers[lineId] = renderer;
    }

    setTermFocus(lineNum: number, focus: boolean): void {
        // console.log("SW setTermFocus", lineNum, focus);
        mobx.action(() => this.termLineNumFocus.set(focus ? lineNum : 0))();
        if (focus && this.selectedLine.get() != lineNum) {
            GlobalCommandRunner.screenSelectLine(String(lineNum), "cmd");
        } else if (focus && this.focusType.get() == "input") {
            GlobalCommandRunner.screenSetFocus("cmd");
        }
    }

    termCustomKeyHandlerInternal(e: any, termWrap: TermWrap): void {
        if (e.code == "ArrowUp") {
            termWrap.terminal.scrollLines(-1);
            return;
        }
        if (e.code == "ArrowDown") {
            termWrap.terminal.scrollLines(1);
            return;
        }
        if (e.code == "PageUp") {
            termWrap.terminal.scrollPages(-1);
            return;
        }
        if (e.code == "PageDown") {
            termWrap.terminal.scrollPages(1);
            return;
        }
    }

    isTermCapturedKey(e: any): boolean {
        let keys = ["ArrowUp", "ArrowDown", "PageUp", "PageDown"];
        if (keys.includes(e.code) && keyHasNoMods(e)) {
            return true;
        }
        return false;
    }

    termCustomKeyHandler(e: any, termWrap: TermWrap): boolean {
        if (termWrap.isRunning) {
            return true;
        }
        let isCaptured = this.isTermCapturedKey(e);
        if (!isCaptured) {
            return true;
        }
        if (e.type != "keydown" || isModKeyPress(e)) {
            return false;
        }
        e.stopPropagation();
        e.preventDefault();
        this.termCustomKeyHandlerInternal(e, termWrap);
        return false;
    }

    loadTerminalRenderer(elem: Element, line: LineType, cmd: Cmd, width: number) {
        let lineId = cmd.lineId;
        let termWrap = this.getTermWrap(lineId);
        if (termWrap != null) {
            console.log("term-wrap already exists for", this.screenId, lineId);
            return;
        }
        let cols = windowWidthToCols(width, GlobalModel.termFontSize.get());
        let usedRows = GlobalModel.getContentHeight(getRendererContext(line));
        if (line.contentheight != null && line.contentheight != -1) {
            usedRows = line.contentheight;
        }
        let termContext = {
            sessionId: this.sessionId,
            screenId: this.screenId,
            lineId: line.lineid,
            lineNum: line.linenum,
        };
        termWrap = new TermWrap(elem, {
            termContext: termContext,
            usedRows: usedRows,
            termOpts: cmd.getTermOpts(),
            winSize: { height: 0, width: width },
            dataHandler: cmd.handleData.bind(cmd),
            focusHandler: (focus: boolean) => this.setTermFocus(line.linenum, focus),
            isRunning: cmd.isRunning(),
            customKeyHandler: this.termCustomKeyHandler.bind(this),
            fontSize: GlobalModel.termFontSize.get(),
            ptyDataSource: getTermPtyData,
            onUpdateContentHeight: (termContext: RendererContext, height: number) => {
                GlobalModel.setContentHeight(termContext, height);
            },
        });
        this.terminals[lineId] = termWrap;
        if (this.focusType.get() == "cmd" && this.selectedLine.get() == line.linenum) {
            termWrap.giveFocus();
        }
        return;
    }

    unloadRenderer(lineId: string) {
        let rmodel = this.renderers[lineId];
        if (rmodel != null) {
            rmodel.dispose();
            delete this.renderers[lineId];
        }
        let term = this.terminals[lineId];
        if (term != null) {
            term.dispose();
            delete this.terminals[lineId];
        }
    }

    getUsedRows(context: RendererContext, line: LineType, cmd: Cmd, width: number): number {
        if (cmd == null) {
            return 0;
        }
        let termOpts = cmd.getTermOpts();
        if (!termOpts.flexrows) {
            return termOpts.rows;
        }
        let termWrap = this.getTermWrap(cmd.lineId);
        if (termWrap == null) {
            let cols = windowWidthToCols(width, GlobalModel.termFontSize.get());
            let usedRows = GlobalModel.getContentHeight(context);
            if (usedRows != null) {
                return usedRows;
            }
            if (line.contentheight != null && line.contentheight != -1) {
                return line.contentheight;
            }
            return cmd.isRunning() ? 1 : 0;
        }
        return termWrap.getUsedRows();
    }

    getIsFocused(lineNum: number): boolean {
        return this.termLineNumFocus.get() == lineNum;
    }

    getSelectedLine(): number {
        return this.selectedLine.get();
    }

    getScreenLines(): ScreenLines {
        return GlobalModel.getScreenLinesById(this.screenId);
    }

    getFocusType(): FocusTypeStrs {
        return this.focusType.get();
    }

    giveFocus(): void {
        if (!this.isActive()) {
            return;
        }
        let ftype = this.focusType.get();
        if (ftype == "input") {
            GlobalModel.inputModel.giveFocus();
        } else {
            let sline: LineType = null;
            if (this.selectedLine.get() != 0) {
                sline = this.getLineByNum(this.selectedLine.get());
            }
            if (sline != null) {
                let renderer = this.getRenderer(sline.lineid);
                if (renderer != null) {
                    renderer.giveFocus();
                }
                let termWrap = this.getTermWrap(sline.lineid);
                if (termWrap != null) {
                    termWrap.giveFocus();
                }
            }
        }
    }
}

class ScreenLines {
    screenId: string;
    loaded: OV<boolean> = mobx.observable.box(false, { name: "slines-loaded" });
    loadError: OV<string> = mobx.observable.box(null);
    lines: OArr<LineType> = mobx.observable.array([], {
        name: "slines-lines",
        deep: false,
    });
    cmds: Record<string, Cmd> = {}; // lineid => Cmd

    constructor(screenId: string) {
        this.screenId = screenId;
    }

    getNonArchivedLines(): LineType[] {
        let rtn: LineType[] = [];
        for (let i = 0; i < this.lines.length; i++) {
            let line = this.lines[i];
            if (line.archived) {
                continue;
            }
            rtn.push(line);
        }
        return rtn;
    }

    updateData(slines: ScreenLinesType, load: boolean) {
        mobx.action(() => {
            if (load) {
                this.loaded.set(true);
            }
            genMergeSimpleData(
                this.lines,
                slines.lines,
                (l: LineType) => String(l.lineid),
                (l: LineType) => sprintf("%013d:%s", l.ts, l.lineid)
            );
            let cmds = slines.cmds || [];
            for (let i = 0; i < cmds.length; i++) {
                this.cmds[cmds[i].lineid] = new Cmd(cmds[i]);
            }
        })();
    }

    setLoadError(errStr: string) {
        mobx.action(() => {
            this.loaded.set(true);
            this.loadError.set(errStr);
        })();
    }

    dispose() {}

    getCmd(lineId: string): Cmd {
        return this.cmds[lineId];
    }

    getRunningCmdLines(): LineType[] {
        let rtn: LineType[] = [];
        for (let i = 0; i < this.lines.length; i++) {
            let line = this.lines[i];
            let cmd = this.getCmd(line.lineid);
            if (cmd == null) {
                continue;
            }
            let status = cmd.getStatus();
            if (cmdStatusIsRunning(status)) {
                rtn.push(line);
            }
        }
        return rtn;
    }

    updateCmd(cmd: CmdDataType): void {
        if (cmd.remove) {
            throw new Error("cannot remove cmd with updateCmd call [" + cmd.lineid + "]");
        }
        let origCmd = this.cmds[cmd.lineid];
        if (origCmd != null) {
            origCmd.setCmd(cmd);
        }
        return;
    }

    mergeCmd(cmd: CmdDataType): void {
        if (cmd.remove) {
            delete this.cmds[cmd.lineid];
            return;
        }
        let origCmd = this.cmds[cmd.lineid];
        if (origCmd == null) {
            this.cmds[cmd.lineid] = new Cmd(cmd);
            return;
        }
        origCmd.setCmd(cmd);
        return;
    }

    addLineCmd(line: LineType, cmd: CmdDataType, interactive: boolean) {
        if (!this.loaded.get()) {
            return;
        }
        mobx.action(() => {
            if (cmd != null) {
                this.mergeCmd(cmd);
            }
            if (line != null) {
                let lines = this.lines;
                if (line.remove) {
                    for (let i = 0; i < lines.length; i++) {
                        if (lines[i].lineid == line.lineid) {
                            this.lines.splice(i, 1);
                            break;
                        }
                    }
                    return;
                }
                let lineIdx = 0;
                for (lineIdx = 0; lineIdx < lines.length; lineIdx++) {
                    let lineId = lines[lineIdx].lineid;
                    let curTs = lines[lineIdx].ts;
                    if (lineId == line.lineid) {
                        this.lines[lineIdx] = line;
                        return;
                    }
                    if (curTs > line.ts || (curTs == line.ts && lineId > line.lineid)) {
                        break;
                    }
                }
                if (lineIdx == lines.length) {
                    this.lines.push(line);
                    return;
                }
                this.lines.splice(lineIdx, 0, line);
            }
        })();
    }
}

class Session {
    sessionId: string;
    name: OV<string>;
    activeScreenId: OV<string>;
    sessionIdx: OV<number>;
    notifyNum: OV<number> = mobx.observable.box(0);
    remoteInstances: OArr<RemoteInstanceType>;
    archived: OV<boolean>;

    constructor(sdata: SessionDataType) {
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
        return GlobalModel.getScreenById(this.sessionId, screenId);
    }

    getRemoteInstance(screenId: string, rptr: RemotePtrType): RemoteInstanceType {
        if (rptr.name.startsWith("*")) {
            screenId = "";
        }
        for (let i = 0; i < this.remoteInstances.length; i++) {
            let rdata = this.remoteInstances[i];
            if (
                rdata.screenid == screenId &&
                rdata.remoteid == rptr.remoteid &&
                rdata.remoteownerid == rptr.ownerid &&
                rdata.name == rptr.name
            ) {
                return rdata;
            }
        }
        let remote = GlobalModel.getRemote(rptr.remoteid);
        if (remote != null) {
            return {
                riid: "",
                sessionid: this.sessionId,
                screenid: screenId,
                remoteownerid: rptr.ownerid,
                remoteid: rptr.remoteid,
                name: rptr.name,
                festate: remote.defaultfestate,
            };
        }
        return null;
    }
}

function getDefaultHistoryQueryOpts(): HistoryQueryOpts {
    return {
        queryType: "screen",
        limitRemote: true,
        limitRemoteInstance: true,
        limitUser: true,
        queryStr: "",
        maxItems: 10000,
        includeMeta: true,
        fromTs: 0,
    };
}

class InputModel {
    historyShow: OV<boolean> = mobx.observable.box(false);
    infoShow: OV<boolean> = mobx.observable.box(false);
    cmdInputHeight: OV<number> = mobx.observable.box(0);

    historyType: mobx.IObservableValue<HistoryTypeStrs> = mobx.observable.box("screen");
    historyLoading: mobx.IObservableValue<boolean> = mobx.observable.box(false);
    historyAfterLoadIndex: number = 0;
    historyItems: mobx.IObservableValue<HistoryItem[]> = mobx.observable.box(null, {
        name: "history-items",
        deep: false,
    }); // sorted in reverse (most recent is index 0)
    filteredHistoryItems: mobx.IComputedValue<HistoryItem[]> = null;
    historyIndex: mobx.IObservableValue<number> = mobx.observable.box(0, {
        name: "history-index",
    }); // 1-indexed (because 0 is current)
    modHistory: mobx.IObservableArray<string> = mobx.observable.array([""], {
        name: "mod-history",
    });
    historyQueryOpts: OV<HistoryQueryOpts> = mobx.observable.box(getDefaultHistoryQueryOpts());

    infoMsg: OV<InfoType> = mobx.observable.box(null);
    infoTimeoutId: any = null;
    inputMode: OV<null | "comment" | "global"> = mobx.observable.box(null);
    inputExpanded: OV<boolean> = mobx.observable.box(false, {
        name: "inputExpanded",
    });

    // cursor
    forceCursorPos: OV<number> = mobx.observable.box(null);

    // focus
    inputFocused: OV<boolean> = mobx.observable.box(false);
    lineFocused: OV<boolean> = mobx.observable.box(false);
    physicalInputFocused: OV<boolean> = mobx.observable.box(false);
    forceInputFocus: boolean = false;

    constructor() {
        this.filteredHistoryItems = mobx.computed(() => {
            return this._getFilteredHistoryItems();
        });
    }

    setInputMode(inputMode: null | "comment" | "global"): void {
        mobx.action(() => {
            this.inputMode.set(inputMode);
        })();
    }

    onInputFocus(isFocused: boolean): void {
        mobx.action(() => {
            if (isFocused) {
                this.inputFocused.set(true);
                this.lineFocused.set(false);
            } else {
                if (this.inputFocused.get()) {
                    this.inputFocused.set(false);
                }
            }
        })();
    }

    onLineFocus(isFocused: boolean): void {
        mobx.action(() => {
            if (isFocused) {
                this.inputFocused.set(false);
                this.lineFocused.set(true);
            } else {
                if (this.lineFocused.get()) {
                    this.lineFocused.set(false);
                }
            }
        })();
    }

    _focusCmdInput(): void {
        let elem = document.getElementById("main-cmd-input");
        if (elem != null) {
            elem.focus();
        }
    }

    _focusHistoryInput(): void {
        let elem: HTMLElement = document.querySelector(".cmd-input input.history-input");
        if (elem != null) {
            elem.focus();
        }
    }

    giveFocus(): void {
        if (this.historyShow.get()) {
            this._focusHistoryInput();
        } else {
            this._focusCmdInput();
        }
    }

    setPhysicalInputFocused(isFocused: boolean): void {
        mobx.action(() => {
            this.physicalInputFocused.set(isFocused);
        })();
        if (isFocused) {
            let screen = GlobalModel.getActiveScreen();
            if (screen != null) {
                if (screen.focusType.get() != "input") {
                    GlobalCommandRunner.screenSetFocus("input");
                }
            }
        }
    }

    hasFocus(): boolean {
        let mainInputElem = document.getElementById("main-cmd-input");
        if (document.activeElement == mainInputElem) {
            return true;
        }
        let historyInputElem = document.querySelector(".cmd-input input.history-input");
        if (document.activeElement == historyInputElem) {
            return true;
        }
        return false;
    }

    setHistoryType(htype: HistoryTypeStrs): void {
        if (this.historyQueryOpts.get().queryType == htype) {
            return;
        }
        this.loadHistory(true, -1, htype);
    }

    findBestNewIndex(oldItem: HistoryItem): number {
        if (oldItem == null) {
            return 0;
        }
        let newItems = this.getFilteredHistoryItems();
        if (newItems.length == 0) {
            return 0;
        }
        let bestIdx = 0;
        for (let i = 0; i < newItems.length; i++) {
            // still start at i=0 to catch the historynum equality case
            let item = newItems[i];
            if (item.historynum == oldItem.historynum) {
                bestIdx = i;
                break;
            }
            let bestTsDiff = Math.abs(item.ts - newItems[bestIdx].ts);
            let curTsDiff = Math.abs(item.ts - oldItem.ts);
            if (curTsDiff < bestTsDiff) {
                bestIdx = i;
            }
        }
        return bestIdx + 1;
    }

    setHistoryQueryOpts(opts: HistoryQueryOpts): void {
        mobx.action(() => {
            let oldItem = this.getHistorySelectedItem();
            this.historyQueryOpts.set(opts);
            let bestIndex = this.findBestNewIndex(oldItem);
            setTimeout(() => this.setHistoryIndex(bestIndex, true), 10);
            return;
        })();
    }

    setHistoryShow(show: boolean): void {
        if (this.historyShow.get() == show) {
            return;
        }
        mobx.action(() => {
            this.historyShow.set(show);
            if (this.hasFocus()) {
                this.giveFocus();
            }
        })();
    }

    isHistoryLoaded(): boolean {
        if (this.historyLoading.get()) {
            return false;
        }
        let hitems = this.historyItems.get();
        return hitems != null;
    }

    loadHistory(show: boolean, afterLoadIndex: number, htype: HistoryTypeStrs) {
        if (this.historyLoading.get()) {
            return;
        }
        if (this.isHistoryLoaded()) {
            if (this.historyQueryOpts.get().queryType == htype) {
                return;
            }
        }
        this.historyAfterLoadIndex = afterLoadIndex;
        mobx.action(() => {
            this.historyLoading.set(true);
        })();
        GlobalCommandRunner.loadHistory(show, htype);
    }

    openHistory(): void {
        if (this.historyLoading.get()) {
            return;
        }
        if (!this.isHistoryLoaded()) {
            this.loadHistory(true, 0, "screen");
            return;
        }
        if (!this.historyShow.get()) {
            mobx.action(() => {
                this.setHistoryShow(true);
                this.infoShow.set(false);
                this.dropModHistory(true);
                this.giveFocus();
            })();
        }
    }

    updateCmdLine(cmdLine: CmdLineUpdateType): void {
        mobx.action(() => {
            this.setCurLine(cmdLine.cmdline);
            this.forceCursorPos.set(cmdLine.cursorpos);
        })();
    }

    getHistorySelectedItem(): HistoryItem {
        let hidx = this.historyIndex.get();
        if (hidx == 0) {
            return null;
        }
        let hitems = this.getFilteredHistoryItems();
        if (hidx > hitems.length) {
            return null;
        }
        return hitems[hidx - 1];
    }

    getFirstHistoryItem(): HistoryItem {
        let hitems = this.getFilteredHistoryItems();
        if (hitems.length == 0) {
            return null;
        }
        return hitems[0];
    }

    setHistorySelectionNum(hnum: string): void {
        let hitems = this.getFilteredHistoryItems();
        for (let i = 0; i < hitems.length; i++) {
            if (hitems[i].historynum == hnum) {
                this.setHistoryIndex(i + 1);
                return;
            }
        }
    }

    setHistoryInfo(hinfo: HistoryInfoType): void {
        mobx.action(() => {
            let oldItem = this.getHistorySelectedItem();
            let hitems: HistoryItem[] = hinfo.items ?? [];
            this.historyItems.set(hitems);
            this.historyLoading.set(false);
            this.historyQueryOpts.get().queryType = hinfo.historytype;
            if (hinfo.historytype == "session" || hinfo.historytype == "global") {
                this.historyQueryOpts.get().limitRemote = false;
                this.historyQueryOpts.get().limitRemoteInstance = false;
            }
            if (this.historyAfterLoadIndex == -1) {
                let bestIndex = this.findBestNewIndex(oldItem);
                setTimeout(() => this.setHistoryIndex(bestIndex, true), 100);
            } else if (this.historyAfterLoadIndex) {
                if (hitems.length >= this.historyAfterLoadIndex) {
                    this.setHistoryIndex(this.historyAfterLoadIndex);
                }
            }
            this.historyAfterLoadIndex = 0;
            if (hinfo.show) {
                this.openHistory();
            }
        })();
    }

    getFilteredHistoryItems(): HistoryItem[] {
        return this.filteredHistoryItems.get();
    }

    _getFilteredHistoryItems(): HistoryItem[] {
        let hitems: HistoryItem[] = this.historyItems.get() ?? [];
        let rtn: HistoryItem[] = [];
        let opts = mobx.toJS(this.historyQueryOpts.get());
        let ctx = GlobalModel.getUIContext();
        let curRemote: RemotePtrType = ctx.remote;
        if (curRemote == null) {
            curRemote = { ownerid: "", name: "", remoteid: "" };
        }
        curRemote = mobx.toJS(curRemote);
        for (let i = 0; i < hitems.length; i++) {
            let hitem = hitems[i];
            if (hitem.ismetacmd) {
                if (!opts.includeMeta) {
                    continue;
                }
            } else {
                if (opts.limitRemoteInstance) {
                    if (hitem.remote == null || isBlank(hitem.remote.remoteid)) {
                        continue;
                    }
                    if (
                        (curRemote.ownerid ?? "") != (hitem.remote.ownerid ?? "") ||
                        (curRemote.remoteid ?? "") != (hitem.remote.remoteid ?? "") ||
                        (curRemote.name ?? "") != (hitem.remote.name ?? "")
                    ) {
                        continue;
                    }
                } else if (opts.limitRemote) {
                    if (hitem.remote == null || isBlank(hitem.remote.remoteid)) {
                        continue;
                    }
                    if (
                        (curRemote.ownerid ?? "") != (hitem.remote.ownerid ?? "") ||
                        (curRemote.remoteid ?? "") != (hitem.remote.remoteid ?? "")
                    ) {
                        continue;
                    }
                }
            }
            if (!isBlank(opts.queryStr)) {
                if (isBlank(hitem.cmdstr)) {
                    continue;
                }
                let idx = hitem.cmdstr.indexOf(opts.queryStr);
                if (idx == -1) {
                    continue;
                }
            }

            rtn.push(hitem);
        }
        return rtn;
    }

    scrollHistoryItemIntoView(hnum: string): void {
        let elem: HTMLElement = document.querySelector(".cmd-history .hnum-" + hnum);
        if (elem == null) {
            return;
        }
        let historyDiv = elem.closest(".cmd-history");
        if (historyDiv == null) {
            return;
        }
        let buffer = 15;
        let titleHeight = 24;
        let titleDiv: HTMLElement = document.querySelector(".cmd-history .history-title");
        if (titleDiv != null) {
            titleHeight = titleDiv.offsetHeight + 2;
        }
        let elemOffset = elem.offsetTop;
        let elemHeight = elem.clientHeight;
        let topPos = historyDiv.scrollTop;
        let endPos = topPos + historyDiv.clientHeight;
        if (elemOffset + elemHeight + buffer > endPos) {
            if (elemHeight + buffer > historyDiv.clientHeight - titleHeight) {
                historyDiv.scrollTop = elemOffset - titleHeight;
                return;
            }
            historyDiv.scrollTop = elemOffset - historyDiv.clientHeight + elemHeight + buffer;
            return;
        }
        if (elemOffset < topPos + titleHeight) {
            if (elemHeight + buffer > historyDiv.clientHeight - titleHeight) {
                historyDiv.scrollTop = elemOffset - titleHeight;
                return;
            }
            historyDiv.scrollTop = elemOffset - titleHeight - buffer;
            return;
        }
    }

    grabSelectedHistoryItem(): void {
        let hitem = this.getHistorySelectedItem();
        if (hitem == null) {
            this.resetHistory();
            return;
        }
        mobx.action(() => {
            this.resetInput();
            this.setCurLine(hitem.cmdstr);
        })();
    }

    setHistoryIndex(hidx: number, force?: boolean): void {
        if (hidx < 0) {
            return;
        }
        if (!force && this.historyIndex.get() == hidx) {
            return;
        }
        mobx.action(() => {
            this.historyIndex.set(hidx);
            if (this.historyShow.get()) {
                let hitem = this.getHistorySelectedItem();
                if (hitem == null) {
                    hitem = this.getFirstHistoryItem();
                }
                if (hitem != null) {
                    this.scrollHistoryItemIntoView(hitem.historynum);
                }
            }
        })();
    }

    moveHistorySelection(amt: number): void {
        if (amt == 0) {
            return;
        }
        if (!this.isHistoryLoaded()) {
            return;
        }
        let hitems = this.getFilteredHistoryItems();
        let idx = this.historyIndex.get();
        idx += amt;
        if (idx < 0) {
            idx = 0;
        }
        if (idx > hitems.length) {
            idx = hitems.length;
        }
        this.setHistoryIndex(idx);
    }

    flashInfoMsg(info: InfoType, timeoutMs: number): void {
        this._clearInfoTimeout();
        mobx.action(() => {
            this.infoMsg.set(info);
            if (info == null) {
                this.infoShow.set(false);
            } else {
                this.infoShow.set(true);
                this.setHistoryShow(false);
            }
        })();
        if (info != null && timeoutMs) {
            this.infoTimeoutId = setTimeout(() => {
                if (this.historyShow.get()) {
                    return;
                }
                this.clearInfoMsg(false);
            }, timeoutMs);
        }
    }

    hasScrollingInfoMsg(): boolean {
        if (!this.infoShow.get()) {
            return false;
        }
        let info = this.infoMsg.get();
        if (info == null) {
            return false;
        }
        let div = document.querySelector(".cmd-input-info");
        if (div == null) {
            return false;
        }
        return div.scrollHeight > div.clientHeight;
    }

    _clearInfoTimeout(): void {
        if (this.infoTimeoutId != null) {
            clearTimeout(this.infoTimeoutId);
            this.infoTimeoutId = null;
        }
    }

    clearInfoMsg(setNull: boolean): void {
        this._clearInfoTimeout();
        mobx.action(() => {
            this.setHistoryShow(false);
            this.infoShow.set(false);
            if (setNull) {
                this.infoMsg.set(null);
            }
        })();
    }

    toggleInfoMsg(): void {
        this._clearInfoTimeout();
        mobx.action(() => {
            if (this.historyShow.get()) {
                this.setHistoryShow(false);
                return;
            }
            let isShowing = this.infoShow.get();
            if (isShowing) {
                this.infoShow.set(false);
            } else {
                if (this.infoMsg.get() != null) {
                    this.infoShow.set(true);
                }
            }
        })();
    }

    @boundMethod
    uiSubmitCommand(): void {
        mobx.action(() => {
            let commandStr = this.getCurLine();
            if (commandStr.trim() == "") {
                return;
            }
            this.resetInput();
            GlobalModel.submitRawCommand(commandStr, true, true);
        })();
    }

    isEmpty(): boolean {
        return this.getCurLine().trim() == "";
    }

    resetInputMode(): void {
        mobx.action(() => {
            this.setInputMode(null);
            this.setCurLine("");
        })();
    }

    setCurLine(val: string): void {
        let hidx = this.historyIndex.get();
        mobx.action(() => {
            // if (val == "\" ") {
            //     this.setInputMode("comment");
            //     val = "";
            // }
            // if (val == "//") {
            //     this.setInputMode("global");
            //     val = "";
            // }
            if (this.modHistory.length <= hidx) {
                this.modHistory.length = hidx + 1;
            }
            this.modHistory[hidx] = val;
        })();
    }

    resetInput(): void {
        mobx.action(() => {
            this.setHistoryShow(false);
            this.infoShow.set(false);
            this.inputMode.set(null);
            this.resetHistory();
            this.dropModHistory(false);
            this.infoMsg.set(null);
            this.inputExpanded.set(false);
            this._clearInfoTimeout();
        })();
    }

    @boundMethod
    toggleExpandInput(): void {
        mobx.action(() => {
            this.inputExpanded.set(!this.inputExpanded.get());
            this.forceInputFocus = true;
        })();
    }

    getCurLine(): string {
        let model = GlobalModel;
        let hidx = this.historyIndex.get();
        if (hidx < this.modHistory.length && this.modHistory[hidx] != null) {
            return this.modHistory[hidx];
        }
        let hitems = this.getFilteredHistoryItems();
        if (hidx == 0 || hitems == null || hidx > hitems.length) {
            return "";
        }
        let hitem = hitems[hidx - 1];
        if (hitem == null) {
            return "";
        }
        return hitem.cmdstr;
    }

    dropModHistory(keepLine0: boolean): void {
        mobx.action(() => {
            if (keepLine0) {
                if (this.modHistory.length > 1) {
                    this.modHistory.splice(1, this.modHistory.length - 1);
                }
            } else {
                this.modHistory.replace([""]);
            }
        })();
    }

    resetHistory(): void {
        mobx.action(() => {
            this.setHistoryShow(false);
            this.historyLoading.set(false);
            this.historyType.set("screen");
            this.historyItems.set(null);
            this.historyIndex.set(0);
            this.historyQueryOpts.set(getDefaultHistoryQueryOpts());
            this.historyAfterLoadIndex = 0;
            this.dropModHistory(true);
        })();
    }
}

type LineFocusType = {
    cmdInputFocus: boolean;
    lineid?: string;
    linenum?: number;
    screenid?: string;
};

class SpecialHistoryViewLineContainer {
    historyItem: HistoryItem;
    terminal: TermWrap;
    renderer: RendererModel;
    cmd: Cmd;

    constructor(hitem: HistoryItem) {
        this.historyItem = hitem;
    }

    getCmd(line: LineType): Cmd {
        if (this.cmd == null) {
            this.cmd = GlobalModel.historyViewModel.getCmdById(line.lineid);
        }
        return this.cmd;
    }

    setTermFocus(lineNum: number, focus: boolean): void {
        return;
    }

    setContentHeight(context: RendererContext, height: number): void {
        return;
    }

    getMaxContentSize(): WindowSize {
        let width = termWidthFromCols(80, GlobalModel.termFontSize.get());
        let height = termHeightFromRows(25, GlobalModel.termFontSize.get());
        return { width, height };
    }

    getIdealContentSize(): WindowSize {
        let width = termWidthFromCols(80, GlobalModel.termFontSize.get());
        let height = termHeightFromRows(25, GlobalModel.termFontSize.get());
        return { width, height };
    }

    loadTerminalRenderer(elem: Element, line: LineType, cmd: Cmd, width: number): void {
        this.unloadRenderer(null);
        let lineId = cmd.lineId;
        let termWrap = this.getTermWrap(lineId);
        if (termWrap != null) {
            console.log("term-wrap already exists for", line.screenid, lineId);
            return;
        }
        let cols = windowWidthToCols(width, GlobalModel.termFontSize.get());
        let usedRows = GlobalModel.getContentHeight(getRendererContext(line));
        if (line.contentheight != null && line.contentheight != -1) {
            usedRows = line.contentheight;
        }
        let termContext = {
            screenId: line.screenid,
            lineId: line.lineid,
            lineNum: line.linenum,
        };
        termWrap = new TermWrap(elem, {
            termContext: termContext,
            usedRows: usedRows,
            termOpts: cmd.getTermOpts(),
            winSize: { height: 0, width: width },
            dataHandler: null,
            focusHandler: null,
            isRunning: cmd.isRunning(),
            customKeyHandler: null,
            fontSize: GlobalModel.termFontSize.get(),
            ptyDataSource: getTermPtyData,
            onUpdateContentHeight: null,
        });
        this.terminal = termWrap;
        return;
    }

    registerRenderer(lineId: string, renderer: RendererModel): void {
        this.renderer = renderer;
    }

    unloadRenderer(lineId: string): void {
        if (this.renderer != null) {
            this.renderer.dispose();
            this.renderer = null;
        }
        if (this.terminal != null) {
            this.terminal.dispose();
            this.terminal = null;
        }
    }

    getContentHeight(context: RendererContext): number {
        return GlobalModel.getContentHeight(context);
    }

    getUsedRows(context: RendererContext, line: LineType, cmd: Cmd, width: number): number {
        if (cmd == null) {
            return 0;
        }
        let termOpts = cmd.getTermOpts();
        if (!termOpts.flexrows) {
            return termOpts.rows;
        }
        let termWrap = this.getTermWrap(cmd.lineId);
        if (termWrap == null) {
            let cols = windowWidthToCols(width, GlobalModel.termFontSize.get());
            let usedRows = GlobalModel.getContentHeight(context);
            if (usedRows != null) {
                return usedRows;
            }
            if (line.contentheight != null && line.contentheight != -1) {
                return line.contentheight;
            }
            return cmd.isRunning() ? 1 : 0;
        }
        return termWrap.getUsedRows();
    }

    getIsFocused(lineNum: number): boolean {
        return false;
    }

    getRenderer(lineId: string): RendererModel {
        return this.renderer;
    }

    getTermWrap(lineId: string): TermWrap {
        return this.terminal;
    }

    getFocusType(): FocusTypeStrs {
        return "input";
    }

    getSelectedLine(): number {
        return null;
    }
}

const HistoryPageSize = 50;

class HistoryViewModel {
    items: OArr<HistoryItem> = mobx.observable.array([], {
        name: "HistoryItems",
    });
    hasMore: OV<boolean> = mobx.observable.box(false, {
        name: "historyview-hasmore",
    });
    offset: OV<number> = mobx.observable.box(0, { name: "historyview-offset" });
    searchText: OV<string> = mobx.observable.box("", {
        name: "historyview-searchtext",
    });
    activeSearchText: string = null;
    selectedItems: OMap<string, boolean> = mobx.observable.map({}, { name: "historyview-selectedItems" });
    deleteActive: OV<boolean> = mobx.observable.box(false, {
        name: "historyview-deleteActive",
    });
    activeItem: OV<string> = mobx.observable.box(null, {
        name: "historyview-activeItem",
    });
    searchSessionId: OV<string> = mobx.observable.box(null, {
        name: "historyview-searchSessionId",
    });
    searchRemoteId: OV<string> = mobx.observable.box(null, {
        name: "historyview-searchRemoteId",
    });
    searchShowMeta: OV<boolean> = mobx.observable.box(false, {
        name: "historyview-searchShowMeta",
    });
    searchFromDate: OV<string> = mobx.observable.box(null, {
        name: "historyview-searchfromts",
    });
    searchFilterCmds: OV<boolean> = mobx.observable.box(true, {
        name: "historyview-filtercmds",
    });
    nextRawOffset: number = 0;
    curRawOffset: number = 0;

    historyItemLines: LineType[] = [];
    historyItemCmds: CmdDataType[] = [];

    specialLineContainer: SpecialHistoryViewLineContainer;

    constructor() {}

    closeView(): void {
        GlobalModel.showSessionView();
        setTimeout(() => GlobalModel.inputModel.giveFocus(), 50);
    }

    getLineById(lineId: string): LineType {
        if (isBlank(lineId)) {
            return null;
        }
        for (let i = 0; i < this.historyItemLines.length; i++) {
            let line = this.historyItemLines[i];
            if (line.lineid == lineId) {
                return line;
            }
        }
        return null;
    }

    getCmdById(lineId: string): Cmd {
        if (isBlank(lineId)) {
            return null;
        }
        for (let i = 0; i < this.historyItemCmds.length; i++) {
            let cmd = this.historyItemCmds[i];
            if (cmd.lineid == lineId) {
                return new Cmd(cmd);
            }
        }
        return null;
    }

    getHistoryItemById(historyId: string): HistoryItem {
        if (isBlank(historyId)) {
            return null;
        }
        for (let i = 0; i < this.items.length; i++) {
            let hitem = this.items[i];
            if (hitem.historyid == historyId) {
                return hitem;
            }
        }
        return null;
    }

    setActiveItem(historyId: string) {
        if (this.activeItem.get() == historyId) {
            return;
        }
        let hitem = this.getHistoryItemById(historyId);
        mobx.action(() => {
            if (hitem == null) {
                this.activeItem.set(null);
                this.specialLineContainer = null;
            } else {
                this.activeItem.set(hitem.historyid);
                this.specialLineContainer = new SpecialHistoryViewLineContainer(hitem);
            }
        })();
    }

    doSelectedDelete(): void {
        if (!this.deleteActive.get()) {
            mobx.action(() => {
                this.deleteActive.set(true);
            })();
            setTimeout(this.clearActiveDelete, 2000);
            return;
        }
        let prtn = GlobalModel.showAlert({
            message: "Deleting lines from history also deletes their content from your sessions.",
            confirm: true,
        });
        prtn.then((result) => {
            if (!result) {
                return;
            }
            if (result) {
                this._deleteSelected();
            }
        });
    }

    _deleteSelected(): void {
        let lineIds = Array.from(this.selectedItems.keys());
        let prtn = GlobalCommandRunner.historyPurgeLines(lineIds);
        prtn.then((result: CommandRtnType) => {
            if (!result.success) {
                GlobalModel.showAlert({ message: "Error removing history lines." });
                return;
            }
        });
        let params = this._getSearchParams();
        GlobalCommandRunner.historyView(params);
    }

    @boundMethod
    clearActiveDelete(): void {
        mobx.action(() => {
            this.deleteActive.set(false);
        })();
    }

    _getSearchParams(newOffset?: number, newRawOffset?: number): HistorySearchParams {
        let offset = newOffset != null ? newOffset : this.offset.get();
        let rawOffset = newRawOffset != null ? newRawOffset : this.curRawOffset;
        let opts: HistorySearchParams = {
            offset: offset,
            rawOffset: rawOffset,
            searchText: this.activeSearchText,
            searchSessionId: this.searchSessionId.get(),
            searchRemoteId: this.searchRemoteId.get(),
        };
        if (!this.searchShowMeta.get()) {
            opts.noMeta = true;
        }
        if (this.searchFromDate.get() != null) {
            let fromDate = this.searchFromDate.get();
            let fromTs = dayjs(fromDate, "YYYY-MM-DD").valueOf();
            let d = new Date(fromTs);
            d.setDate(d.getDate() + 1);
            let ts = d.getTime() - 1;
            opts.fromTs = ts;
        }
        if (this.searchFilterCmds.get()) {
            opts.filterCmds = true;
        }
        return opts;
    }

    reSearch(): void {
        this.setActiveItem(null);
        GlobalCommandRunner.historyView(this._getSearchParams());
    }

    resetAllFilters(): void {
        mobx.action(() => {
            this.activeSearchText = "";
            this.searchText.set("");
            this.searchSessionId.set(null);
            this.searchRemoteId.set(null);
            this.searchFromDate.set(null);
            this.searchShowMeta.set(false);
            this.searchFilterCmds.set(true);
        })();
        GlobalCommandRunner.historyView(this._getSearchParams(0, 0));
    }

    setFromDate(fromDate: string): void {
        if (this.searchFromDate.get() == fromDate) {
            return;
        }
        mobx.action(() => {
            this.searchFromDate.set(fromDate);
        })();
        GlobalCommandRunner.historyView(this._getSearchParams(0, 0));
    }

    setSearchFilterCmds(filter: boolean): void {
        if (this.searchFilterCmds.get() == filter) {
            return;
        }
        mobx.action(() => {
            this.searchFilterCmds.set(filter);
        })();
        GlobalCommandRunner.historyView(this._getSearchParams(0, 0));
    }

    setSearchShowMeta(show: boolean): void {
        if (this.searchShowMeta.get() == show) {
            return;
        }
        mobx.action(() => {
            this.searchShowMeta.set(show);
        })();
        GlobalCommandRunner.historyView(this._getSearchParams(0, 0));
    }

    setSearchSessionId(sessionId: string): void {
        if (this.searchSessionId.get() == sessionId) {
            return;
        }
        mobx.action(() => {
            this.searchSessionId.set(sessionId);
        })();
        GlobalCommandRunner.historyView(this._getSearchParams(0, 0));
    }

    setSearchRemoteId(remoteId: string): void {
        if (this.searchRemoteId.get() == remoteId) {
            return;
        }
        mobx.action(() => {
            this.searchRemoteId.set(remoteId);
        })();
        GlobalCommandRunner.historyView(this._getSearchParams(0, 0));
    }

    goPrev(): void {
        let offset = this.offset.get();
        offset = offset - HistoryPageSize;
        if (offset < 0) {
            offset = 0;
        }
        let params = this._getSearchParams(offset, 0);
        GlobalCommandRunner.historyView(params);
    }

    goNext(): void {
        let offset = this.offset.get();
        offset += HistoryPageSize;
        let params = this._getSearchParams(offset, this.nextRawOffset ?? 0);
        GlobalCommandRunner.historyView(params);
    }

    submitSearch(): void {
        mobx.action(() => {
            this.hasMore.set(false);
            this.items.replace([]);
            this.activeSearchText = this.searchText.get();
            this.historyItemLines = [];
            this.historyItemCmds = [];
        })();
        GlobalCommandRunner.historyView(this._getSearchParams(0, 0));
    }

    handleDocKeyDown(e: any): void {
        if (e.code == "Escape") {
            e.preventDefault();
            this.closeView();
            return;
        }
    }

    showHistoryView(data: HistoryViewDataType): void {
        mobx.action(() => {
            GlobalModel.activeMainView.set("history");
            this.hasMore.set(data.hasmore);
            this.items.replace(data.items || []);
            this.offset.set(data.offset);
            this.nextRawOffset = data.nextrawoffset;
            this.curRawOffset = data.rawoffset;
            this.historyItemLines = data.lines ?? [];
            this.historyItemCmds = data.cmds ?? [];
            this.selectedItems.clear();
        })();
    }
}

class BookmarksModel {
    bookmarks: OArr<BookmarkType> = mobx.observable.array([], {
        name: "Bookmarks",
    });
    activeBookmark: OV<string> = mobx.observable.box(null, {
        name: "activeBookmark",
    });
    editingBookmark: OV<string> = mobx.observable.box(null, {
        name: "editingBookmark",
    });
    pendingDelete: OV<string> = mobx.observable.box(null, {
        name: "pendingDelete",
    });
    copiedIndicator: OV<string> = mobx.observable.box(null, {
        name: "copiedIndicator",
    });

    tempDesc: OV<string> = mobx.observable.box("", {
        name: "bookmarkEdit-tempDesc",
    });
    tempCmd: OV<string> = mobx.observable.box("", {
        name: "bookmarkEdit-tempCmd",
    });

    showBookmarksView(bmArr: BookmarkType[], selectedBookmarkId: string): void {
        bmArr = bmArr ?? [];
        mobx.action(() => {
            this.reset();
            GlobalModel.activeMainView.set("bookmarks");
            this.bookmarks.replace(bmArr);
            if (selectedBookmarkId != null) {
                this.selectBookmark(selectedBookmarkId);
            }
            if (this.activeBookmark.get() == null && bmArr.length > 0) {
                this.activeBookmark.set(bmArr[0].bookmarkid);
            }
        })();
    }

    reset(): void {
        mobx.action(() => {
            this.activeBookmark.set(null);
            this.editingBookmark.set(null);
            this.pendingDelete.set(null);
            this.tempDesc.set("");
            this.tempCmd.set("");
        })();
    }

    closeView(): void {
        GlobalModel.showSessionView();
        setTimeout(() => GlobalModel.inputModel.giveFocus(), 50);
    }

    @boundMethod
    clearPendingDelete(): void {
        mobx.action(() => this.pendingDelete.set(null))();
    }

    useBookmark(bookmarkId: string): void {
        let bm = this.getBookmark(bookmarkId);
        if (bm == null) {
            return;
        }
        mobx.action(() => {
            this.reset();
            GlobalModel.showSessionView();
            GlobalModel.inputModel.setCurLine(bm.cmdstr);
            setTimeout(() => GlobalModel.inputModel.giveFocus(), 50);
        })();
    }

    selectBookmark(bookmarkId: string): void {
        let bm = this.getBookmark(bookmarkId);
        if (bm == null) {
            return;
        }
        if (this.activeBookmark.get() == bookmarkId) {
            return;
        }
        mobx.action(() => {
            this.cancelEdit();
            this.activeBookmark.set(bookmarkId);
        })();
    }

    cancelEdit(): void {
        mobx.action(() => {
            this.pendingDelete.set(null);
            this.editingBookmark.set(null);
            this.tempDesc.set("");
            this.tempCmd.set("");
        })();
    }

    confirmEdit(): void {
        if (this.editingBookmark.get() == null) {
            return;
        }
        let bm = this.getBookmark(this.editingBookmark.get());
        mobx.action(() => {
            this.editingBookmark.set(null);
            bm.description = this.tempDesc.get();
            bm.cmdstr = this.tempCmd.get();
            this.tempDesc.set("");
            this.tempCmd.set("");
        })();
        GlobalCommandRunner.editBookmark(bm.bookmarkid, bm.description, bm.cmdstr);
    }

    handleDeleteBookmark(bookmarkId: string): void {
        if (this.pendingDelete.get() == null || this.pendingDelete.get() != this.activeBookmark.get()) {
            mobx.action(() => this.pendingDelete.set(this.activeBookmark.get()))();
            setTimeout(this.clearPendingDelete, 2000);
            return;
        }
        GlobalCommandRunner.deleteBookmark(bookmarkId);
        this.clearPendingDelete();
    }

    getBookmark(bookmarkId: string): BookmarkType {
        if (bookmarkId == null) {
            return null;
        }
        for (let i = 0; i < this.bookmarks.length; i++) {
            let bm = this.bookmarks[i];
            if (bm.bookmarkid == bookmarkId) {
                return bm;
            }
        }
        return null;
    }

    getBookmarkPos(bookmarkId: string): number {
        if (bookmarkId == null) {
            return -1;
        }
        for (let i = 0; i < this.bookmarks.length; i++) {
            let bm = this.bookmarks[i];
            if (bm.bookmarkid == bookmarkId) {
                return i;
            }
        }
        return -1;
    }

    getActiveBookmark(): BookmarkType {
        let activeBookmarkId = this.activeBookmark.get();
        return this.getBookmark(activeBookmarkId);
    }

    handleEditBookmark(bookmarkId: string): void {
        let bm = this.getBookmark(bookmarkId);
        if (bm == null) {
            return;
        }
        mobx.action(() => {
            this.pendingDelete.set(null);
            this.activeBookmark.set(bookmarkId);
            this.editingBookmark.set(bookmarkId);
            this.tempDesc.set(bm.description ?? "");
            this.tempCmd.set(bm.cmdstr ?? "");
        })();
    }

    handleCopyBookmark(bookmarkId: string): void {
        let bm = this.getBookmark(bookmarkId);
        if (bm == null) {
            return;
        }
        navigator.clipboard.writeText(bm.cmdstr);
        mobx.action(() => {
            this.copiedIndicator.set(bm.bookmarkid);
        })();
        setTimeout(() => {
            mobx.action(() => {
                this.copiedIndicator.set(null);
            })();
        }, 600);
    }

    mergeBookmarks(bmArr: BookmarkType[]): void {
        mobx.action(() => {
            genMergeSimpleData(
                this.bookmarks,
                bmArr,
                (bm: BookmarkType) => bm.bookmarkid,
                (bm: BookmarkType) => sprintf("%05d", bm.orderidx)
            );
        })();
    }

    handleDocKeyDown(e: any): void {
        if (e.code == "Escape") {
            e.preventDefault();
            if (this.editingBookmark.get() != null) {
                this.cancelEdit();
                return;
            }
            this.closeView();
            return;
        }
        if (this.editingBookmark.get() != null) {
            return;
        }
        if (e.code == "Backspace" || e.code == "Delete") {
            if (this.activeBookmark.get() == null) {
                return;
            }
            e.preventDefault();
            this.handleDeleteBookmark(this.activeBookmark.get());
            return;
        }
        if (e.code == "ArrowUp" || e.code == "ArrowDown" || e.code == "PageUp" || e.code == "PageDown") {
            e.preventDefault();
            if (this.bookmarks.length == 0) {
                return;
            }
            let newPos = 0; // if active is null, then newPos will be 0 (select the first)
            if (this.activeBookmark.get() != null) {
                let amtMap = { ArrowUp: -1, ArrowDown: 1, PageUp: -10, PageDown: 10 };
                let amt = amtMap[e.code];
                let curIdx = this.getBookmarkPos(this.activeBookmark.get());
                newPos = curIdx + amt;
                if (newPos < 0) {
                    newPos = 0;
                }
                if (newPos >= this.bookmarks.length) {
                    newPos = this.bookmarks.length - 1;
                }
            }
            let bm = this.bookmarks[newPos];
            mobx.action(() => {
                this.activeBookmark.set(bm.bookmarkid);
            })();
            return;
        }
        if (e.code == "Enter") {
            if (this.activeBookmark.get() == null) {
                return;
            }
            this.useBookmark(this.activeBookmark.get());
            return;
        }
        if (e.code == "KeyE") {
            if (this.activeBookmark.get() == null) {
                return;
            }
            e.preventDefault();
            this.handleEditBookmark(this.activeBookmark.get());
            return;
        }
        if (e.code == "KeyC") {
            if (this.activeBookmark.get() == null) {
                return;
            }
            e.preventDefault();
            this.handleCopyBookmark(this.activeBookmark.get());
            return;
        }
    }
    return;
}

class RemotesModalModel {
    openState: OV<boolean> = mobx.observable.box(false, {
        name: "RemotesModalModel-isOpen",
    });
    selectedRemoteId: OV<string> = mobx.observable.box(null, {
        name: "RemotesModalModel-selectedRemoteId",
    });
    remoteTermWrap: TermWrap;
    remoteTermWrapFocus: OV<boolean> = mobx.observable.box(false, {
        name: "RemotesModalModel-remoteTermWrapFocus",
    });
    showNoInputMsg: OV<boolean> = mobx.observable.box(false, {
        name: "RemotesModel-showNoInputMg",
    });
    showNoInputTimeoutId: any = null;
    remoteEdit: OV<RemoteEditType> = mobx.observable.box(null, {
        name: "RemoteModal-remoteEdit",
    });

    openModal(remoteId?: string): void {
        if (remoteId == null) {
            let ri = GlobalModel.getCurRemoteInstance();
            if (ri != null) {
                remoteId = ri.remoteid;
            } else {
                let localRemote = GlobalModel.getLocalRemote();
                if (localRemote != null) {
                    remoteId = localRemote.remoteid;
                }
            }
        }
        mobx.action(() => {
            this.openState.set(true);
            this.selectedRemoteId.set(remoteId);
            this.remoteEdit.set(null);
        })();
    }

    deSelectRemote(): void {
        mobx.action(() => {
            this.selectedRemoteId.set(null);
            this.remoteEdit.set(null);
        })();
    }

    openModalForEdit(redit: RemoteEditType): void {
        mobx.action(() => {
            this.openState.set(true);
            this.selectedRemoteId.set(redit.remoteid);
            this.remoteEdit.set(redit);
        })();
    }

    selectRemote(remoteId: string): void {
        if (this.selectedRemoteId.get() == remoteId) {
            return;
        }
        mobx.action(() => {
            this.selectedRemoteId.set(remoteId);
            this.remoteEdit.set(null);
        })();
    }

    @boundMethod
    startEditAuth(): void {
        let remoteId = this.selectedRemoteId.get();
        if (remoteId != null) {
            GlobalCommandRunner.openEditRemote(remoteId);
        }
    }

    @boundMethod
    cancelEditAuth(): void {
        mobx.action(() => {
            this.remoteEdit.set(null);
            if (this.selectedRemoteId.get() == null) {
                this.openModal();
            }
        })();
    }

    isOpen(): boolean {
        return this.openState.get();
    }

    isAuthEditMode(): boolean {
        return this.remoteEdit.get() != null;
    }

    closeModal(): void {
        if (!this.openState.get()) {
            return;
        }
        mobx.action(() => {
            this.openState.set(false);
            this.selectedRemoteId.set(null);
            this.remoteEdit.set(null);
        })();
        setTimeout(() => GlobalModel.refocus(), 10);
    }

    disposeTerm(): void {
        if (this.remoteTermWrap == null) {
            return;
        }
        this.remoteTermWrap.dispose();
        this.remoteTermWrap = null;
        mobx.action(() => {
            this.remoteTermWrapFocus.set(false);
        })();
    }

    receiveData(remoteId: string, ptyPos: number, ptyData: Uint8Array, reason?: string) {
        if (this.remoteTermWrap == null) {
            return;
        }
        if (this.remoteTermWrap.getContextRemoteId() != remoteId) {
            return;
        }
        this.remoteTermWrap.receiveData(ptyPos, ptyData);
    }

    @boundMethod
    setRemoteTermWrapFocus(focus: boolean): void {
        mobx.action(() => {
            this.remoteTermWrapFocus.set(focus);
        })();
    }

    @boundMethod
    setShowNoInputMsg(val: boolean) {
        mobx.action(() => {
            if (this.showNoInputTimeoutId != null) {
                clearTimeout(this.showNoInputTimeoutId);
                this.showNoInputTimeoutId = null;
            }
            if (val) {
                this.showNoInputMsg.set(true);
                this.showNoInputTimeoutId = setTimeout(() => this.setShowNoInputMsg(false), 2000);
            } else {
                this.showNoInputMsg.set(false);
            }
        })();
    }

    @boundMethod
    termKeyHandler(remoteId: string, event: any, termWrap: TermWrap): void {
        let remote = GlobalModel.getRemote(remoteId);
        if (remote == null) {
            return;
        }
        if (remote.status != "connecting" && remote.installstatus != "connecting") {
            this.setShowNoInputMsg(true);
            return;
        }
        let inputPacket: RemoteInputPacketType = {
            type: "remoteinput",
            remoteid: remoteId,
            inputdata64: btoa(event.key),
        };
        GlobalModel.sendInputPacket(inputPacket);
    }

    createTermWrap(elem: HTMLElement): void {
        this.disposeTerm();
        let remoteId = this.selectedRemoteId.get();
        if (remoteId == null) {
            return;
        }
        let termOpts = {
            rows: RemotePtyRows,
            cols: RemotePtyCols,
            flexrows: false,
            maxptysize: 64 * 1024,
        };
        let termWrap = new TermWrap(elem, {
            termContext: { remoteId: remoteId },
            usedRows: RemotePtyRows,
            termOpts: termOpts,
            winSize: null,
            keyHandler: (e, termWrap) => {
                this.termKeyHandler(remoteId, e, termWrap);
            },
            focusHandler: this.setRemoteTermWrapFocus.bind(this),
            isRunning: true,
            fontSize: GlobalModel.termFontSize.get(),
            ptyDataSource: getTermPtyData,
            onUpdateContentHeight: null,
        });
        this.remoteTermWrap = termWrap;
    }
}

class Model {
    clientId: string;
    activeSessionId: OV<string> = mobx.observable.box(null, {
        name: "activeSessionId",
    });
    sessionListLoaded: OV<boolean> = mobx.observable.box(false, {
        name: "sessionListLoaded",
    });
    sessionList: OArr<Session> = mobx.observable.array([], {
        name: "SessionList",
        deep: false,
    });
    screenMap: OMap<string, Screen> = mobx.observable.map({}, { name: "ScreenMap", deep: false });
    ws: WSControl;
    remotes: OArr<RemoteType> = mobx.observable.array([], {
        name: "remotes",
        deep: false,
    });
    remotesLoaded: OV<boolean> = mobx.observable.box(false, {
        name: "remotesLoaded",
    });
    screenLines: OMap<string, ScreenLines> = mobx.observable.map({}, { name: "screenLines", deep: false }); // key = "sessionid/screenid" (screenlines)
    termUsedRowsCache: Record<string, number> = {}; // key = "screenid/lineid"
    debugCmds: number = 0;
    debugScreen: OV<boolean> = mobx.observable.box(false);
    localServerRunning: OV<boolean>;
    authKey: string;
    isDev: boolean;
    activeMainView: OV<"session" | "history" | "bookmarks" | "webshare"> = mobx.observable.box("session", {
        name: "activeMainView",
    });
    termFontSize: CV<number>;
    alertMessage: OV<AlertMessageType> = mobx.observable.box(null, {
        name: "alertMessage",
    });
    alertPromiseResolver: (result: boolean) => void;
    welcomeModalOpen: OV<boolean> = mobx.observable.box(false, {
        name: "welcomeModalOpen",
    });
    screenSettingsModal: OV<{ sessionId: string; screenId: string }> = mobx.observable.box(null, {
        name: "screenSettingsModal",
    });
    sessionSettingsModal: OV<string> = mobx.observable.box(null, {
        name: "sessionSettingsModal",
    });
    clientSettingsModal: OV<boolean> = mobx.observable.box(false, {
        name: "clientSettingsModal",
    });
    lineSettingsModal: OV<number> = mobx.observable.box(null, {
        name: "lineSettingsModal",
    }); // linenum
    remotesModalModel: RemotesModalModel;

    inputModel: InputModel;
    bookmarksModel: BookmarksModel;
    historyViewModel: HistoryViewModel;
    clientData: OV<ClientDataType> = mobx.observable.box(null, {
        name: "clientData",
    });
    showLinks: OV<boolean> = mobx.observable.box(true, {
        name: "model-showLinks",
    });

    constructor() {
        this.clientId = getApi().getId();
        this.isDev = getApi().getIsDev();
        this.authKey = getApi().getAuthKey();
        this.ws = new WSControl(this.getBaseWsHostPort(), this.clientId, this.authKey, (message: any) =>
            this.runUpdate(message, false)
        );
        this.ws.reconnect();
        this.inputModel = new InputModel();
        this.bookmarksModel = new BookmarksModel();
        this.historyViewModel = new HistoryViewModel();
        this.remotesModalModel = new RemotesModalModel();
        let isLocalServerRunning = getApi().getLocalServerStatus();
        this.localServerRunning = mobx.observable.box(isLocalServerRunning, {
            name: "model-local-server-running",
        });
        this.termFontSize = mobx.computed(() => {
            let cdata = this.clientData.get();
            if (cdata == null || cdata.feopts == null || cdata.feopts.termfontsize == null) {
                return DefaultTermFontSize;
            }
            let fontSize = Math.ceil(cdata.feopts.termfontsize);
            if (fontSize < MinFontSize) {
                return MinFontSize;
            }
            if (fontSize > MaxFontSize) {
                return MaxFontSize;
            }
            return fontSize;
        });
        getApi().onTCmd(this.onTCmd.bind(this));
        getApi().onICmd(this.onICmd.bind(this));
        getApi().onLCmd(this.onLCmd.bind(this));
        getApi().onHCmd(this.onHCmd.bind(this));
        getApi().onMetaArrowUp(this.onMetaArrowUp.bind(this));
        getApi().onMetaArrowDown(this.onMetaArrowDown.bind(this));
        getApi().onMetaPageUp(this.onMetaPageUp.bind(this));
        getApi().onMetaPageDown(this.onMetaPageDown.bind(this));
        getApi().onBracketCmd(this.onBracketCmd.bind(this));
        getApi().onDigitCmd(this.onDigitCmd.bind(this));
        getApi().onLocalServerStatusChange(this.onLocalServerStatusChange.bind(this));
        document.addEventListener("keydown", this.docKeyDownHandler.bind(this));
        document.addEventListener("selectionchange", this.docSelectionChangeHandler.bind(this));
        setTimeout(() => this.getClientDataLoop(1), 10);
    }

    needsTos(): boolean {
        let cdata = this.clientData.get();
        if (cdata == null) {
            return false;
        }
        return cdata.clientopts == null || !cdata.clientopts.acceptedtos;
    }

    refreshClient(): void {
        getApi().reloadWindow();
    }

    refocus() {
        // givefocus() give back focus to cmd or input
        let activeScreen = this.getActiveScreen();
        if (screen == null) {
            return;
        }
        activeScreen.giveFocus();
    }

    getWebSharedScreens(): Screen[] {
        let rtn: Screen[] = [];
        for (let screen of this.screenMap.values()) {
            if (screen.shareMode.get() == "web") {
                rtn.push(screen);
            }
        }
        return rtn;
    }

    getHasClientStop(): boolean {
        if (this.clientData.get() == null) {
            return true;
        }
        let cdata = this.clientData.get();
        if (cdata.cmdstoretype == "session") {
            return true;
        }
        return false;
    }

    showAlert(alertMessage: AlertMessageType): Promise<boolean> {
        mobx.action(() => {
            this.alertMessage.set(alertMessage);
        })();
        let prtn = new Promise<boolean>((resolve, reject) => {
            this.alertPromiseResolver = resolve;
        });
        return prtn;
    }

    cancelAlert(): void {
        mobx.action(() => {
            this.alertMessage.set(null);
        })();
        if (this.alertPromiseResolver != null) {
            this.alertPromiseResolver(false);
            this.alertPromiseResolver = null;
        }
    }

    confirmAlert(): void {
        mobx.action(() => {
            this.alertMessage.set(null);
        })();
        if (this.alertPromiseResolver != null) {
            this.alertPromiseResolver(true);
            this.alertPromiseResolver = null;
        }
    }

    showSessionView(): void {
        mobx.action(() => {
            this.activeMainView.set("session");
        })();
    }

    showWebShareView(): void {
        mobx.action(() => {
            this.activeMainView.set("webshare");
        })();
    }

    getBaseHostPort(): string {
        if (this.isDev) {
            return DevServerEndpoint;
        }
        return ProdServerEndpoint;
    }

    setTermFontSize(fontSize: number) {
        if (fontSize < MinFontSize) {
            fontSize = MinFontSize;
        }
        if (fontSize > MaxFontSize) {
            fontSize = MaxFontSize;
        }
        mobx.action(() => {
            this.termFontSize.set(fontSize);
        })();
    }

    getBaseWsHostPort(): string {
        if (this.isDev) {
            return DevServerWsEndpoint;
        }
        return ProdServerWsEndpoint;
    }

    getFetchHeaders(): Record<string, string> {
        return {
            "x-authkey": this.authKey,
        };
    }

    docSelectionChangeHandler(e: any) {
        // nothing for now
    }

    docKeyDownHandler(e: any) {
        if (isModKeyPress(e)) {
            return;
        }
        if (this.alertMessage.get() != null) {
            if (e.code == "Escape") {
                e.preventDefault();
                this.cancelAlert();
                return;
            }
            if (e.code == "Enter") {
                e.preventDefault();
                this.confirmAlert();
                return;
            }
            return;
        }
        if (this.activeMainView.get() == "bookmarks") {
            this.bookmarksModel.handleDocKeyDown(e);
            return;
        }
        if (this.activeMainView.get() == "history") {
            this.historyViewModel.handleDocKeyDown(e);
            return;
        }
        if (e.code == "Escape") {
            e.preventDefault();
            if (this.activeMainView.get() == "webshare") {
                this.showSessionView();
                return;
            }
            if (this.clearModals()) {
                return;
            }
            let inputModel = this.inputModel;
            inputModel.toggleInfoMsg();
            if (inputModel.inputMode.get() != null) {
                inputModel.resetInputMode();
            }
            return;
        }
        if (e.code == "KeyB" && e.getModifierState("Meta")) {
            e.preventDefault();
            GlobalCommandRunner.bookmarksView();
        }
    }

    clearModals(): boolean {
        let didSomething = false;
        mobx.action(() => {
            if (GlobalModel.screenSettingsModal.get()) {
                GlobalModel.screenSettingsModal.set(null);
                didSomething = true;
            }
            if (GlobalModel.sessionSettingsModal.get()) {
                GlobalModel.sessionSettingsModal.set(null);
                didSomething = true;
            }
            if (GlobalModel.screenSettingsModal.get()) {
                GlobalModel.screenSettingsModal.set(null);
                didSomething = true;
            }
            if (GlobalModel.remotesModalModel.isOpen()) {
                GlobalModel.remotesModalModel.closeModal();
                didSomething = true;
            }
            if (GlobalModel.clientSettingsModal.get()) {
                GlobalModel.clientSettingsModal.set(false);
                didSomething = true;
            }
            if (GlobalModel.lineSettingsModal.get()) {
                GlobalModel.lineSettingsModal.set(null);
                didSomething = true;
            }
            if (GlobalModel.welcomeModalOpen.get()) {
                GlobalModel.welcomeModalOpen.set(false);
                didSomething = true;
            }
        })();
        return didSomething;
    }

    restartLocalServer(): void {
        getApi().restartLocalServer();
    }

    getLocalRemote(): RemoteType {
        for (let i = 0; i < this.remotes.length; i++) {
            if (this.remotes[i].local) {
                return this.remotes[i];
            }
        }
        return null;
    }

    getCurRemoteInstance(): RemoteInstanceType {
        let screen = this.getActiveScreen();
        if (screen == null) {
            return null;
        }
        return screen.getCurRemoteInstance();
    }

    onLocalServerStatusChange(status: boolean): void {
        mobx.action(() => {
            this.localServerRunning.set(status);
        })();
    }

    getContentHeight(context: RendererContext): number {
        let key = context.screenId + "/" + context.lineId;
        return this.termUsedRowsCache[key];
    }

    setContentHeight(context: RendererContext, height: number): void {
        let key = context.screenId + "/" + context.lineId;
        this.termUsedRowsCache[key] = height;
        GlobalCommandRunner.setTermUsedRows(context, height);
    }

    contextScreen(e: any, screenId: string) {
        getApi().contextScreen({ screenId: screenId }, { x: e.x, y: e.y });
    }

    contextEditMenu(e: any, opts: ContextMenuOpts) {
        getApi().contextEditMenu({ x: e.x, y: e.y }, opts);
    }

    getUIContext(): UIContextType {
        let rtn: UIContextType = {
            sessionid: null,
            screenid: null,
            remote: null,
            winsize: null,
            linenum: null,
            build: VERSION + " " + BUILD,
        };
        let session = this.getActiveSession();
        if (session != null) {
            rtn.sessionid = session.sessionId;
            let screen = session.getActiveScreen();
            if (screen != null) {
                rtn.screenid = screen.screenId;
                rtn.remote = screen.curRemote.get();
                rtn.winsize = { rows: screen.lastRows, cols: screen.lastCols };
                rtn.linenum = screen.selectedLine.get();
            }
        }
        return rtn;
    }

    onTCmd(e: any, mods: KeyModsType) {
        GlobalCommandRunner.createNewScreen();
    }

    onICmd(e: any, mods: KeyModsType) {
        this.inputModel.giveFocus();
    }

    onLCmd(e: any, mods: KeyModsType) {
        let screen = this.getActiveScreen();
        if (screen != null) {
            GlobalCommandRunner.screenSetFocus("cmd");
        }
    }

    onHCmd(e: any, mods: KeyModsType) {
        GlobalModel.historyViewModel.reSearch();
    }

    getFocusedLine(): LineFocusType {
        if (this.inputModel.hasFocus()) {
            return { cmdInputFocus: true };
        }
        let lineElem: any = document.activeElement.closest(".line[data-lineid]");
        if (lineElem == null) {
            return { cmdInputFocus: false };
        }
        let lineNum = parseInt(lineElem.dataset.linenum);
        return {
            cmdInputFocus: false,
            lineid: lineElem.dataset.lineid,
            linenum: isNaN(lineNum) ? null : lineNum,
            screenid: lineElem.dataset.screenid,
        };
    }

    cmdStatusUpdate(screenId: string, lineId: string, origStatus: string, newStatus: string) {
        let wasRunning = cmdStatusIsRunning(origStatus);
        let isRunning = cmdStatusIsRunning(newStatus);
        if (wasRunning && !isRunning) {
            // console.log("cmd status", screenId, lineId, origStatus, "=>", newStatus);
            let ptr = this.getActiveLine(screenId, lineId);
            if (ptr != null) {
                let screen = ptr.screen;
                let renderer = screen.getRenderer(lineId);
                if (renderer != null) {
                    renderer.setIsDone();
                }
                let term = screen.getTermWrap(lineId);
                if (term != null) {
                    term.cmdDone();
                }
            }
        }
    }

    onMetaPageUp(): void {
        GlobalCommandRunner.screenSelectLine("-1");
    }

    onMetaPageDown(): void {
        GlobalCommandRunner.screenSelectLine("+1");
    }

    onMetaArrowUp(): void {
        GlobalCommandRunner.screenSelectLine("-1");
    }

    onMetaArrowDown(): void {
        GlobalCommandRunner.screenSelectLine("+1");
    }

    onBracketCmd(e: any, arg: { relative: number }, mods: KeyModsType) {
        if (arg.relative == 1) {
            GlobalCommandRunner.switchScreen("+");
        } else if (arg.relative == -1) {
            GlobalCommandRunner.switchScreen("-");
        }
    }

    onDigitCmd(e: any, arg: { digit: number }, mods: KeyModsType) {
        if (mods.meta && mods.ctrl) {
            GlobalCommandRunner.switchSession(String(arg.digit));
            return;
        }
        GlobalCommandRunner.switchScreen(String(arg.digit));
    }

    isConnected(): boolean {
        return this.ws.open.get();
    }

    runUpdate(genUpdate: UpdateMessage, interactive: boolean) {
        mobx.action(() => {
            let oldContext = this.getUIContext();
            try {
                this.runUpdate_internal(genUpdate, oldContext, interactive);
            } catch (e) {
                console.log("error running update", e, genUpdate);
                throw e;
            }
            let newContext = this.getUIContext();
            if (oldContext.sessionid != newContext.sessionid || oldContext.screenid != newContext.screenid) {
                this.inputModel.resetInput();
            } else if (remotePtrToString(oldContext.remote) != remotePtrToString(newContext.remote)) {
                this.inputModel.resetHistory();
            }
        })();
    }

    runUpdate_internal(genUpdate: UpdateMessage, uiContext: UIContextType, interactive: boolean) {
        if ("ptydata64" in genUpdate) {
            let ptyMsg: PtyDataUpdateType = genUpdate;
            if (isBlank(ptyMsg.remoteid)) {
                // regular update
                this.updatePtyData(ptyMsg);
            } else {
                // remote update
                let ptyData = base64ToArray(ptyMsg.ptydata64);
                this.remotesModalModel.receiveData(ptyMsg.remoteid, ptyMsg.ptypos, ptyData);
            }
            return;
        }
        let update: ModelUpdateType = genUpdate;
        if ("screens" in update) {
            if (update.connect) {
                this.screenMap.clear();
            }
            let mods = genMergeDataMap(
                this.screenMap,
                update.screens,
                (s: Screen) => s.screenId,
                (sdata: ScreenDataType) => sdata.screenid,
                (sdata: ScreenDataType) => new Screen(sdata)
            );
            for (let i = 0; i < mods.removed.length; i++) {
                this.removeScreenLinesByScreenId(mods.removed[i]);
            }
        }
        if ("sessions" in update || "activesessionid" in update) {
            if (update.connect) {
                this.sessionList.clear();
            }
            let [oldActiveSessionId, oldActiveScreenId] = this.getActiveIds();
            genMergeData(
                this.sessionList,
                update.sessions,
                (s: Session) => s.sessionId,
                (sdata: SessionDataType) => sdata.sessionid,
                (sdata: SessionDataType) => new Session(sdata),
                (s: Session) => s.sessionIdx.get()
            );
            if ("activesessionid" in update) {
                let newSessionId = update.activesessionid;
                if (this.activeSessionId.get() != newSessionId) {
                    this.activeSessionId.set(newSessionId);
                }
            }
            let [newActiveSessionId, newActiveScreenId] = this.getActiveIds();
            if (oldActiveSessionId != newActiveSessionId || oldActiveScreenId != newActiveScreenId) {
                this.activeMainView.set("session");
                this.deactivateScreenLines();
                this.ws.watchScreen(newActiveSessionId, newActiveScreenId);
            }
        }
        if ("line" in update) {
            this.addLineCmd(update.line, update.cmd, interactive);
        } else if ("cmd" in update) {
            this.updateCmd(update.cmd);
        }
        if ("lines" in update) {
            for (let i = 0; i < update.lines.length; i++) {
                this.addLineCmd(update.lines[i], null, interactive);
            }
        }
        if ("screenlines" in update) {
            this.updateScreenLines(update.screenlines, false);
        }
        if ("remotes" in update) {
            if (update.connect) {
                this.remotes.clear();
            }
            this.updateRemotes(update.remotes);
        }
        if ("mainview" in update) {
            if (update.mainview == "bookmarks") {
                this.bookmarksModel.showBookmarksView(update.bookmarks, update.selectedbookmark);
            } else if (update.mainview == "session") {
                this.activeMainView.set("session");
            } else if (update.mainview == "history") {
                this.historyViewModel.showHistoryView(update.historyviewdata);
            } else {
                console.log("invalid mainview in update:", update.mainview);
            }
        } else if ("bookmarks" in update) {
            this.bookmarksModel.mergeBookmarks(update.bookmarks);
        }
        if ("clientdata" in update) {
            this.clientData.set(update.clientdata);
        }
        if (interactive && "info" in update) {
            let info: InfoType = update.info;
            this.inputModel.flashInfoMsg(info, info.timeoutms);
        }
        if (interactive && "remoteview" in update) {
            let rview: RemoteViewType = update.remoteview;
            if (rview.remoteshowall) {
                this.remotesModalModel.openModal();
            } else if (rview.remoteedit != null) {
                this.remotesModalModel.openModalForEdit(rview.remoteedit);
            } else if (rview.ptyremoteid) {
                this.remotesModalModel.openModal(rview.ptyremoteid);
            }
        }
        if ("cmdline" in update) {
            this.inputModel.updateCmdLine(update.cmdline);
        }
        if (interactive && "history" in update) {
            if (uiContext.sessionid == update.history.sessionid && uiContext.screenid == update.history.screenid) {
                this.inputModel.setHistoryInfo(update.history);
            }
        }
        if ("connect" in update) {
            this.sessionListLoaded.set(true);
            this.remotesLoaded.set(true);
        }
        // console.log("run-update>", Date.now(), interactive, update);
    }

    updateRemotes(remotes: RemoteType[]): void {
        genMergeSimpleData(this.remotes, remotes, (r) => r.remoteid, null);
    }

    getActiveSession(): Session {
        return this.getSessionById(this.activeSessionId.get());
    }

    getSessionNames(): Record<string, string> {
        let rtn: Record<string, string> = {};
        for (let i = 0; i < this.sessionList.length; i++) {
            let session = this.sessionList[i];
            rtn[session.sessionId] = session.name.get();
        }
        return rtn;
    }

    getScreenNames(): Record<string, string> {
        let rtn: Record<string, string> = {};
        for (let screen of this.screenMap.values()) {
            rtn[screen.screenId] = screen.name.get();
        }
        return rtn;
    }

    getSessionById(sessionId: string): Session {
        if (sessionId == null) {
            return null;
        }
        for (let i = 0; i < this.sessionList.length; i++) {
            if (this.sessionList[i].sessionId == sessionId) {
                return this.sessionList[i];
            }
        }
        return null;
    }

    deactivateScreenLines() {
        mobx.action(() => {
            this.screenLines.clear();
        })();
    }

    getScreenLinesById(screenId: string): ScreenLines {
        return this.screenLines.get(screenId);
    }

    updateScreenLines(slines: ScreenLinesType, load: boolean) {
        mobx.action(() => {
            let existingWin = this.screenLines.get(slines.screenid);
            if (existingWin == null) {
                if (!load) {
                    console.log("cannot update screen-lines that does not exist", slines.screenid);
                    return;
                }
                let newWindow = new ScreenLines(slines.screenid);
                this.screenLines.set(slines.screenid, newWindow);
                newWindow.updateData(slines, load);
                return;
            } else {
                existingWin.updateData(slines, load);
                existingWin.loaded.set(true);
            }
        })();
    }

    removeScreenLinesByScreenId(screenId: string) {
        mobx.action(() => {
            this.screenLines.delete(screenId);
        })();
    }

    getScreenById(sessionId: string, screenId: string): Screen {
        return this.screenMap.get(screenId);
    }

    getScreenById_single(screenId: string): Screen {
        return this.screenMap.get(screenId);
    }

    getSessionScreens(sessionId: string): Screen[] {
        let rtn: Screen[] = [];
        for (let screen of this.screenMap.values()) {
            if (screen.sessionId == sessionId) {
                rtn.push(screen);
            }
        }
        return rtn;
    }

    getScreenLinesForActiveScreen(): ScreenLines {
        let screen = this.getActiveScreen();
        if (screen == null) {
            return null;
        }
        return this.screenLines.get(screen.screenId);
    }

    getActiveScreen(): Screen {
        let session = this.getActiveSession();
        if (session == null) {
            return null;
        }
        return session.getActiveScreen();
    }

    addLineCmd(line: LineType, cmd: CmdDataType, interactive: boolean) {
        let slines = this.getScreenLinesById(line.screenid);
        if (slines == null) {
            return;
        }
        slines.addLineCmd(line, cmd, interactive);
    }

    updateCmd(cmd: CmdDataType) {
        let slines = this.screenLines.get(cmd.screenid);
        if (slines != null) {
            slines.updateCmd(cmd);
        }
    }

    isInfoUpdate(update: UpdateMessage): boolean {
        if (update == null || "ptydata64" in update) {
            return false;
        }
        return update.info != null || update.history != null;
    }

    getClientDataLoop(loopNum: number): void {
        this.getClientData();
        let clientStop = this.getHasClientStop();
        if (this.clientData.get() != null && !clientStop) {
            return;
        }
        let timeoutMs = 1000;
        if (!clientStop && loopNum > 5) {
            timeoutMs = 3000;
        }
        if (!clientStop && loopNum > 10) {
            timeoutMs = 10000;
        }
        if (!clientStop && loopNum > 15) {
            timeoutMs = 30000;
        }
        setTimeout(() => this.getClientDataLoop(loopNum + 1), timeoutMs);
    }

    getClientData(): void {
        let url = sprintf(GlobalModel.getBaseHostPort() + "/api/get-client-data");
        let fetchHeaders = this.getFetchHeaders();
        fetch(url, { method: "post", body: null, headers: fetchHeaders })
            .then((resp) => handleJsonFetchResponse(url, resp))
            .then((data) => {
                mobx.action(() => {
                    let clientData: ClientDataType = data.data;
                    this.clientData.set(clientData);
                })();
            })
            .catch((err) => {
                this.errorHandler("calling get-client-data", err, true);
            });
    }

    submitCommandPacket(cmdPk: FeCmdPacketType, interactive: boolean): Promise<CommandRtnType> {
        if (this.debugCmds > 0) {
            console.log("[cmd]", cmdPacketString(cmdPk));
            if (this.debugCmds > 1) {
                console.trace();
            }
        }
        let url = sprintf(GlobalModel.getBaseHostPort() + "/api/run-command");
        let fetchHeaders = this.getFetchHeaders();
        let prtn = fetch(url, {
            method: "post",
            body: JSON.stringify(cmdPk),
            headers: fetchHeaders,
        })
            .then((resp) => handleJsonFetchResponse(url, resp))
            .then((data) => {
                mobx.action(() => {
                    let update = data.data;
                    if (update != null) {
                        this.runUpdate(update, interactive);
                    }
                    if (interactive && !this.isInfoUpdate(update)) {
                        GlobalModel.inputModel.clearInfoMsg(true);
                    }
                })();
                return { success: true };
            })
            .catch((err) => {
                this.errorHandler("calling run-command", err, interactive);
                let errMessage = "error running command";
                if (err != null && !isBlank(err.message)) {
                    errMessage = err.message;
                }
                return { success: false, error: errMessage };
            });
        return prtn;
    }

    submitCommand(
        metaCmd: string,
        metaSubCmd: string,
        args: string[],
        kwargs: Record<string, string>,
        interactive: boolean
    ): Promise<CommandRtnType> {
        let pk: FeCmdPacketType = {
            type: "fecmd",
            metacmd: metaCmd,
            metasubcmd: metaSubCmd,
            args: args,
            kwargs: Object.assign({}, kwargs),
            uicontext: this.getUIContext(),
            interactive: interactive,
        };
        // console.log("CMD", pk.metacmd + (pk.metasubcmd != null ? ":" + pk.metasubcmd : ""), pk.args, pk.kwargs, pk.interactive);
        return this.submitCommandPacket(pk, interactive);
    }

    submitRawCommand(cmdStr: string, addToHistory: boolean, interactive: boolean): Promise<CommandRtnType> {
        let pk: FeCmdPacketType = {
            type: "fecmd",
            metacmd: "eval",
            args: [cmdStr],
            kwargs: null,
            uicontext: this.getUIContext(),
            interactive: interactive,
            rawstr: cmdStr,
        };
        if (!addToHistory) {
            pk.kwargs["nohist"] = "1";
        }
        return this.submitCommandPacket(pk, interactive);
    }

    // returns [sessionId, screenId]
    getActiveIds(): [string, string] {
        let activeSession = this.getActiveSession();
        let activeScreen = this.getActiveScreen();
        return [
            activeSession == null ? null : activeSession.sessionId,
            activeScreen == null ? null : activeScreen.screenId,
        ];
    }

    _loadScreenLinesAsync(newWin: ScreenLines) {
        this.screenLines.set(newWin.screenId, newWin);
        let usp = new URLSearchParams({ screenid: newWin.screenId });
        let url = new URL(GlobalModel.getBaseHostPort() + "/api/get-screen-lines?" + usp.toString());
        let fetchHeaders = GlobalModel.getFetchHeaders();
        fetch(url, { headers: fetchHeaders })
            .then((resp) => handleJsonFetchResponse(url, resp))
            .then((data) => {
                if (data.data == null) {
                    console.log("null screen-lines returned from get-screen-lines");
                    return;
                }
                let slines: ScreenLinesType = data.data;
                this.updateScreenLines(slines, true);
                return;
            })
            .catch((err) => {
                this.errorHandler(sprintf("getting screen-lines=%s", newWin.screenId), err, false);
            });
    }

    loadScreenLines(screenId: string): ScreenLines {
        let newWin = new ScreenLines(screenId);
        setTimeout(() => this._loadScreenLinesAsync(newWin), 0);
        return newWin;
    }

    getRemote(remoteId: string): RemoteType {
        for (let i = 0; i < this.remotes.length; i++) {
            if (this.remotes[i].remoteid == remoteId) {
                return this.remotes[i];
            }
        }
        return null;
    }

    getRemoteNames(): Record<string, string> {
        let rtn: Record<string, string> = {};
        for (let i = 0; i < this.remotes.length; i++) {
            let remote = this.remotes[i];
            if (!isBlank(remote.remotealias)) {
                rtn[remote.remoteid] = remote.remotealias;
            } else {
                rtn[remote.remoteid] = remote.remotecanonicalname;
            }
        }
        return rtn;
    }

    getRemoteByName(name: string): RemoteType {
        for (let i = 0; i < this.remotes.length; i++) {
            if (this.remotes[i].remotecanonicalname == name || this.remotes[i].remotealias == name) {
                return this.remotes[i];
            }
        }
        return null;
    }

    getCmd(line: LineType): Cmd {
        let slines = this.getScreenLinesById(line.screenid);
        if (slines == null) {
            return null;
        }
        return slines.getCmd(line.lineid);
    }

    getActiveLine(screenId: string, lineid: string): SWLinePtr {
        let slines = this.screenLines.get(screenId);
        if (slines == null) {
            return null;
        }
        if (!slines.loaded.get()) {
            return null;
        }
        let cmd = slines.getCmd(lineid);
        if (cmd == null) {
            return null;
        }
        let line: LineType = null;
        for (let i = 0; i < slines.lines.length; i++) {
            if (slines.lines[i].lineid == lineid) {
                line = slines.lines[i];
                break;
            }
        }
        if (line == null) {
            return null;
        }
        let screen = this.getScreenById_single(slines.screenId);
        return { line: line, slines: slines, screen: screen };
    }

    updatePtyData(ptyMsg: PtyDataUpdateType): void {
        let linePtr = this.getActiveLine(ptyMsg.screenid, ptyMsg.lineid);
        if (linePtr != null) {
            linePtr.screen.updatePtyData(ptyMsg);
        }
    }

    errorHandler(str: string, err: any, interactive: boolean) {
        console.log("[error]", str, err);
        if (interactive) {
            let errMsg = "error running command";
            if (err != null && err.message) {
                errMsg = err.message;
            }
            this.inputModel.flashInfoMsg({ infoerror: errMsg }, null);
        }
    }

    sendInputPacket(inputPacket: any) {
        this.ws.pushMessage(inputPacket);
    }

    resolveUserIdToName(userid: string): string {
        return "@[unknown]";
    }

    resolveRemoteIdToRef(remoteId: string) {
        let remote = this.getRemote(remoteId);
        if (remote == null) {
            return "[unknown]";
        }
        if (!isBlank(remote.remotealias)) {
            return remote.remotealias;
        }
        return remote.remotecanonicalname;
    }

    resolveRemoteIdToFullRef(remoteId: string) {
        let remote = this.getRemote(remoteId);
        if (remote == null) {
            return "[unknown]";
        }
        if (!isBlank(remote.remotealias)) {
            return remote.remotealias + " (" + remote.remotecanonicalname + ")";
        }
        return remote.remotecanonicalname;
    }

    readRemoteFile(screenId: string, lineId: string, path: string): Promise<File> {
        let urlParams = {
            screenid: screenId,
            lineid: lineId,
            path: path,
        };
        let usp = new URLSearchParams(urlParams);
        let url = new URL(GlobalModel.getBaseHostPort() + "/api/read-file?" + usp.toString());
        let fetchHeaders = this.getFetchHeaders();
        let fileInfo: T.FileInfoType = null;
        let contentType: string = null;
        let isError = false;
        let badResponseStr: string = null;
        let prtn = fetch(url, { method: "get", headers: fetchHeaders })
            .then((resp) => {
                if (!resp.ok) {
                    isError = true;
                    badResponseStr = sprintf(
                        "Bad fetch response for /api/read-file: %d %s",
                        resp.status,
                        resp.statusText
                    );
                    return resp.text() as any;
                }
                contentType = resp.headers.get("Content-Type");
                fileInfo = JSON.parse(atob(resp.headers.get("X-FileInfo")));
                return resp.blob();
            })
            .then((blobOrText: any) => {
                if (blobOrText instanceof Blob) {
                    let blob: Blob = blobOrText;
                    let file = new File([blob], fileInfo.name, { type: blob.type, lastModified: fileInfo.modts });
                    let isWriteable = (fileInfo.perm & 0o222) > 0; // checks for unix permission "w" bits
                    (file as any).readOnly = !isWriteable;
                    return file;
                } else {
                    let textError: string = blobOrText;
                    if (textError == null || textError.length == 0) {
                        throw new Error(badResponseStr);
                    }
                    throw new Error(textError);
                    return null;
                }
            });
        return prtn;
    }

    writeRemoteFile(screenId: string, lineId: string, path: string, data: Uint8Array, opts?: { useTemp?: boolean }) {
        opts = opts || {};
        let params = {
            screenid: screenId,
            lineid: lineId,
            path: path,
            usetemp: !!opts.useTemp,
        };
        let formData = new FormData();
        formData.append("params", JSON.stringify(params));
        let blob = new Blob([data], { type: "application/octet-stream" });
        formData.append("data", blob);
        let url = new URL(GlobalModel.getBaseHostPort() + "/api/write-file");
        let fetchHeaders = this.getFetchHeaders();
        let prtn = fetch(url, { method: "post", headers: fetchHeaders, body: formData });
        return prtn;
    }
}

class CommandRunner {
    constructor() {}

    loadHistory(show: boolean, htype: string) {
        let kwargs = { nohist: "1" };
        if (!show) {
            kwargs["noshow"] = "1";
        }
        if (htype != null && htype != "screen") {
            kwargs["type"] = htype;
        }
        GlobalModel.submitCommand("history", null, null, kwargs, true);
    }

    historyPurgeLines(lines: string[]): Promise<CommandRtnType> {
        let prtn = GlobalModel.submitCommand("history", "purge", lines, { nohist: "1" }, false);
        return prtn;
    }

    switchSession(session: string) {
        mobx.action(() => {
            GlobalModel.activeMainView.set("session");
        })();
        GlobalModel.submitCommand("session", null, [session], { nohist: "1" }, false);
    }

    switchScreen(screen: string) {
        mobx.action(() => {
            GlobalModel.activeMainView.set("session");
        })();
        GlobalModel.submitCommand("screen", null, [screen], { nohist: "1" }, false);
    }

    lineView(sessionId: string, screenId: string, lineNum?: number) {
        let screen = GlobalModel.getScreenById(sessionId, screenId);
        if (screen != null && lineNum != null) {
            screen.setAnchorFields(lineNum, 0, "line:view");
        }
        let lineNumStr = lineNum == null || lineNum == 0 ? "E" : String(lineNum);
        GlobalModel.submitCommand("line", "view", [sessionId, screenId, lineNumStr], { nohist: "1" }, false);
    }

    lineArchive(lineArg: string, archive: boolean): Promise<CommandRtnType> {
        let kwargs = { nohist: "1" };
        let archiveStr = archive ? "1" : "0";
        return GlobalModel.submitCommand("line", "archive", [lineArg, archiveStr], kwargs, false);
    }

    lineSet(lineArg: string, opts: { renderer?: string }): Promise<CommandRtnType> {
        let kwargs = { nohist: "1" };
        if ("renderer" in opts) {
            kwargs["renderer"] = opts.renderer ?? "";
        }
        return GlobalModel.submitCommand("line", "set", [lineArg], kwargs, false);
    }

    createNewSession() {
        GlobalModel.submitCommand("session", "open", null, { nohist: "1" }, false);
    }

    createNewScreen() {
        GlobalModel.submitCommand("screen", "open", null, { nohist: "1" }, false);
    }

    closeScreen(screen: string) {
        GlobalModel.submitCommand("screen", "close", [screen], { nohist: "1" }, false);
    }

    resizeScreen(screenId: string, rows: number, cols: number) {
        GlobalModel.submitCommand(
            "screen",
            "resize",
            null,
            { nohist: "1", screen: screenId, cols: String(cols), rows: String(rows) },
            false
        );
    }

    screenArchive(screenId: string, shouldArchive: boolean): Promise<CommandRtnType> {
        return GlobalModel.submitCommand(
            "screen",
            "archive",
            [screenId, shouldArchive ? "1" : "0"],
            { nohist: "1" },
            false
        );
    }

    screenPurge(screenId: string): Promise<CommandRtnType> {
        return GlobalModel.submitCommand("screen", "purge", [screenId], { nohist: "1" }, false);
    }

    screenWebShare(screenId: string, shouldShare: boolean): Promise<CommandRtnType> {
        let kwargs: Record<string, string> = { nohist: "1" };
        kwargs["screen"] = screenId;
        return GlobalModel.submitCommand("screen", "webshare", [shouldShare ? "1" : "0"], kwargs, false);
    }

    showRemote(remoteid: string) {
        GlobalModel.submitCommand("remote", "show", null, { nohist: "1", remote: remoteid }, true);
    }

    showAllRemotes() {
        GlobalModel.submitCommand("remote", "showall", null, { nohist: "1" }, true);
    }

    connectRemote(remoteid: string) {
        GlobalModel.submitCommand("remote", "connect", null, { nohist: "1", remote: remoteid }, true);
    }

    disconnectRemote(remoteid: string) {
        GlobalModel.submitCommand("remote", "disconnect", null, { nohist: "1", remote: remoteid }, true);
    }

    installRemote(remoteid: string) {
        GlobalModel.submitCommand("remote", "install", null, { nohist: "1", remote: remoteid }, true);
    }

    installCancelRemote(remoteid: string) {
        GlobalModel.submitCommand("remote", "installcancel", null, { nohist: "1", remote: remoteid }, true);
    }

    createRemote(cname: string, kwargsArg: Record<string, string>) {
        let kwargs = Object.assign({}, kwargsArg);
        kwargs["nohist"] = "1";
        GlobalModel.submitCommand("remote", "new", [cname], kwargs, true);
    }

    openCreateRemote(): void {
        GlobalModel.submitCommand("remote", "new", null, { nohist: "1", visual: "1" }, true);
    }

    editRemote(remoteid: string, kwargsArg: Record<string, string>): void {
        let kwargs = Object.assign({}, kwargsArg);
        kwargs["nohist"] = "1";
        kwargs["remote"] = remoteid;
        GlobalModel.submitCommand("remote", "set", null, kwargs, true);
    }

    openEditRemote(remoteid: string): void {
        GlobalModel.submitCommand("remote", "set", null, { remote: remoteid, nohist: "1", visual: "1" }, true);
    }

    archiveRemote(remoteid: string) {
        GlobalModel.submitCommand("remote", "archive", null, { remote: remoteid, nohist: "1" }, true);
    }

    screenSelectLine(lineArg: string, focusVal?: string) {
        let kwargs: Record<string, string> = {
            nohist: "1",
            line: lineArg,
        };
        if (focusVal != null) {
            kwargs["focus"] = focusVal;
        }
        GlobalModel.submitCommand("screen", "set", null, kwargs, false);
    }

    setTermUsedRows(termContext: RendererContext, height: number) {
        let kwargs: Record<string, string> = {};
        kwargs["screen"] = termContext.screenId;
        kwargs["hohist"] = "1";
        let posargs = [String(termContext.lineNum), String(height)];
        GlobalModel.submitCommand("line", "setheight", posargs, kwargs, false);
    }

    screenSetAnchor(sessionId: string, screenId: string, anchorVal: string): void {
        let kwargs = {
            nohist: "1",
            anchor: anchorVal,
            session: sessionId,
            screen: screenId,
        };
        GlobalModel.submitCommand("screen", "set", null, kwargs, false);
    }

    screenSetFocus(focusVal: string): void {
        GlobalModel.submitCommand("screen", "set", null, { focus: focusVal, nohist: "1" }, false);
    }

    screenSetSettings(
        screenId: string,
        settings: { tabcolor?: string; name?: string; sharename?: string },
        interactive: boolean
    ): Promise<CommandRtnType> {
        let kwargs = Object.assign({}, settings);
        kwargs["nohist"] = "1";
        kwargs["screen"] = screenId;
        return GlobalModel.submitCommand("screen", "set", null, kwargs, interactive);
    }

    sessionArchive(sessionId: string, shouldArchive: boolean): Promise<CommandRtnType> {
        return GlobalModel.submitCommand(
            "session",
            "archive",
            [sessionId, shouldArchive ? "1" : "0"],
            { nohist: "1" },
            false
        );
    }

    sessionPurge(sessionId: string): Promise<CommandRtnType> {
        return GlobalModel.submitCommand("session", "purge", [sessionId], { nohist: "1" }, false);
    }

    sessionSetSettings(sessionId: string, settings: { name?: string }, interactive: boolean): Promise<CommandRtnType> {
        let kwargs = Object.assign({}, settings);
        kwargs["nohist"] = "1";
        kwargs["session"] = sessionId;
        return GlobalModel.submitCommand("session", "set", null, kwargs, interactive);
    }

    lineStar(lineId: string, starVal: number) {
        GlobalModel.submitCommand("line", "star", [lineId, String(starVal)], { nohist: "1" }, true);
    }

    lineBookmark(lineId: string) {
        GlobalModel.submitCommand("line", "bookmark", [lineId], { nohist: "1" }, true);
    }

    linePin(lineId: string, val: boolean) {
        GlobalModel.submitCommand("line", "pin", [lineId, val ? "1" : "0"], { nohist: "1" }, true);
    }

    bookmarksView() {
        GlobalModel.submitCommand("bookmarks", "show", null, { nohist: "1" }, true);
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
        GlobalModel.submitCommand("history", "viewall", null, kwargs, true);
    }

    telemetryOff(interactive: boolean): Promise<CommandRtnType> {
        return GlobalModel.submitCommand("telemetry", "off", null, { nohist: "1" }, interactive);
    }

    telemetryOn(interactive: boolean): Promise<CommandRtnType> {
        return GlobalModel.submitCommand("telemetry", "on", null, { nohist: "1" }, interactive);
    }

    setTermFontSize(fsize: number, interactive: boolean): Promise<CommandRtnType> {
        let kwargs = {
            nohist: "1",
            termfontsize: String(fsize),
        };
        return GlobalModel.submitCommand("client", "set", null, kwargs, interactive);
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
        return GlobalModel.submitCommand("client", "set", null, kwargs, false);
    }

    clientAcceptTos(): void {
        GlobalModel.submitCommand("client", "accepttos", null, { nohist: "1" }, true);
    }

    editBookmark(bookmarkId: string, desc: string, cmdstr: string) {
        let kwargs = {
            nohist: "1",
            desc: desc,
            cmdstr: cmdstr,
        };
        GlobalModel.submitCommand("bookmark", "set", [bookmarkId], kwargs, true);
    }

    deleteBookmark(bookmarkId: string): void {
        GlobalModel.submitCommand("bookmark", "delete", [bookmarkId], { nohist: "1" }, true);
    }

    openSharedSession(): void {
        GlobalModel.submitCommand("session", "openshared", null, { nohist: "1" }, true);
    }
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

function _getPtyDataFromUrl(url: string): Promise<PtyDataType> {
    let ptyOffset = 0;
    let fetchHeaders = GlobalModel.getFetchHeaders();
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

function getTermPtyData(termContext: TermContextUnion): Promise<PtyDataType> {
    if ("remoteId" in termContext) {
        return getRemotePtyData(termContext.remoteId);
    }
    return getPtyData(termContext.screenId, termContext.lineId, termContext.lineNum);
}

function getPtyData(screenId: string, lineId: string, lineNum: number): Promise<PtyDataType> {
    let url = sprintf(
        GlobalModel.getBaseHostPort() + "/api/ptyout?linenum=%d&screenid=%s&lineid=%s",
        lineNum,
        screenId,
        lineId
    );
    return _getPtyDataFromUrl(url);
}

function getRemotePtyData(remoteId: string): Promise<PtyDataType> {
    let url = sprintf(GlobalModel.getBaseHostPort() + "/api/remote-pty?remoteid=%s", remoteId);
    return _getPtyDataFromUrl(url);
}

let GlobalModel: Model = null;
let GlobalCommandRunner: CommandRunner = null;
if ((window as any).GlobalModel == null) {
    (window as any).GlobalModel = new Model();
    (window as any).GlobalCommandRunner = new CommandRunner();
    (window as any).getMonoFontSize = getMonoFontSize;
}
GlobalModel = (window as any).GlobalModel;
GlobalCommandRunner = (window as any).GlobalCommandRunner;

export {
    Model,
    Session,
    ScreenLines,
    GlobalModel,
    GlobalCommandRunner,
    Cmd,
    Screen,
    riToRPtr,
    TabColors,
    RemoteColors,
    getTermPtyData,
    RemotesModalModel,
};
export type { LineContainerModel };
