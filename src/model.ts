import * as mobx from "mobx";
import {sprintf} from "sprintf-js";
import {boundMethod} from "autobind-decorator";
import {debounce} from "throttle-debounce";
import {handleJsonFetchResponse, base64ToArray, genMergeData, genMergeSimpleData, boundInt, isModKeyPress} from "./util";
import {TermWrap} from "./term";
import {v4 as uuidv4} from "uuid";
import type {SessionDataType, WindowDataType, LineType, RemoteType, HistoryItem, RemoteInstanceType, RemotePtrType, CmdDataType, FeCmdPacketType, TermOptsType, RemoteStateType, ScreenDataType, ScreenWindowType, ScreenOptsType, LayoutType, PtyDataUpdateType, ModelUpdateType, UpdateMessage, InfoType, CmdLineUpdateType, UIContextType, HistoryInfoType, HistoryQueryOpts, FeInputPacketType, TermWinSize, RemoteInputPacketType, FeStateType, ContextMenuOpts, RendererContext, RendererModel, PtyDataType, BookmarkType} from "./types";
import {WSControl} from "./ws";
import {ImageRendererModel} from "./imagerenderer";

var GlobalUser = "sawka";
const DefaultCellWidth = 7.203125;
const DefaultCellHeight = 16;
const RemotePtyRows = 8; // also in main.tsx
const RemotePtyCols = 80;
const MinTermCols = 10;
const MaxTermCols = 1024;
const ProdServerEndpoint = "http://localhost:1619";
const ProdServerWsEndpoint = "ws://localhost:1623";
const DevServerEndpoint = "http://localhost:8090";
const DevServerWsEndpoint = "ws://localhost:8091";


type SWLinePtr = {
    line : LineType,
    win : Window,
    sw : ScreenWindow,
};

function windowWidthToCols(width : number) : number {
    let cols = Math.trunc((width - 50) / DefaultCellWidth) - 1;
    cols = boundInt(cols, MinTermCols, MaxTermCols);
    return cols;
}

function windowHeightToRows(height : number) : number {
    let rows = Math.floor((height - 80)/DefaultCellHeight) - 1;
    if (rows <= 0) {
        rows = 1;
    }
    return rows;
}

function termWidthFromCols(cols : number) : number {
    return Math.ceil(DefaultCellWidth*cols) + 15;
}

function termHeightFromRows(rows : number) : number {
    return Math.ceil(DefaultCellHeight*rows);
}

function cmdStatusIsRunning(status : string) : boolean {
    return status == "running" || status == "detached";
}

function keyHasNoMods(e : any) {
    return !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;
}

type OV<V> = mobx.IObservableValue<V>;
type OArr<V> = mobx.IObservableArray<V>;
type OMap<K,V> = mobx.ObservableMap<K,V>;

function isBlank(s : string) {
    return (s == null || s == "");
}

function remotePtrToString(rptr : RemotePtrType) : string {
    if (rptr == null || isBlank(rptr.remoteid)) {
        return null;
    }
    if (isBlank(rptr.ownerid) && isBlank(rptr.name)) {
        return rptr.remoteid;
    }
    if (!isBlank(rptr.ownerid) && isBlank(rptr.name)) {
        return sprintf("@%s:%s", rptr.ownerid, rptr.remoteid)
    }
    if (isBlank(rptr.ownerid) && !isBlank(rptr.name)) {
        return sprintf("%s:%s", rptr.remoteid, rptr.name)
    }
    return sprintf("@%s:%s:%s", rptr.ownerid, rptr.remoteid, rptr.name)
}

function riToRPtr(ri : RemoteInstanceType) : RemotePtrType {
    if (ri == null) {
        return null;
    }
    return {ownerid: ri.remoteownerid, remoteid: ri.remoteid, name: ri.name};
}

type KeyModsType = {
    meta? : boolean,
    ctrl? : boolean,
    alt? : boolean,
    shift? : boolean,
};

type ElectronApi = {
    getId : () => string,
    getIsDev : () => boolean,
    getAuthKey : () => string,
    getLocalServerStatus : () => boolean,
    restartLocalServer : () => boolean,
    onTCmd : (callback : (mods : KeyModsType) => void) => void,
    onICmd : (callback : (mods : KeyModsType) => void) => void,
    onLCmd : (callback : (mods : KeyModsType) => void) => void,
    onHCmd : (callback : (mods : KeyModsType) => void) => void,
    onMetaArrowUp : (callback : () => void) => void,
    onMetaArrowDown : (callback : () => void) => void,
    onMetaPageUp : (callback : () => void) => void,
    onMetaPageDown : (callback : () => void) => void,
    onBracketCmd : (callback : (event : any, arg : {relative : number}, mods : KeyModsType) => void) => void,
    onDigitCmd : (callback : (event : any, arg : {digit : number}, mods : KeyModsType) => void) => void,
    contextScreen : (screenOpts : {screenId : string}, position : {x : number, y : number}) => void,
    contextEditMenu : (position : {x : number, y : number}, opts : ContextMenuOpts) => void,
    onLocalServerStatusChange : (callback : (status : boolean, pid : number) => void) => void,
};

function getApi() : ElectronApi {
    return (window as any).api;
}

function getLineId(line : LineType) : string {
    return sprintf("%s-%s-%s", line.sessionid, line.windowid, line.lineid);
}

// clean empty string
function ces(s : string) {
    if (s == "") {
        return null;
    }
    return s;
}

class Cmd {
    sessionId : string;
    remote : RemotePtrType;
    remoteId : string;
    cmdId : string;
    data : OV<CmdDataType>;
    watching : boolean = false;

    constructor(cmd : CmdDataType) {
        this.sessionId = cmd.sessionid;
        this.cmdId = cmd.cmdid;
        this.remote = cmd.remote;
        this.data = mobx.observable.box(cmd, {deep: false, name: "cmd-data"});
    }

    setCmd(cmd : CmdDataType) {
        mobx.action(() => {
            let origData = this.data.get();
            this.data.set(cmd);
            if (origData != null && cmd != null && origData.status != cmd.status) {
                GlobalModel.cmdStatusUpdate(this.sessionId, this.cmdId, origData.status, cmd.status);
            }
        })();
    }

    getRtnState() : boolean {
        return this.data.get().rtnstate;
    }

    getStatus() : string {
        return this.data.get().status;
    }

    getTermOpts() : TermOptsType {
        return this.data.get().termopts;
    }

    getCmdStr() : string {
        return this.data.get().cmdstr;
    }

    getRemoteFeState() : FeStateType {
        return this.data.get().festate;
    }

    getSingleLineCmdText() {
        let cmdText = this.data.get().cmdstr;
        if (cmdText == null) {
            return "(none)";
        }
        cmdText = cmdText.trim();
        let nlIdx = cmdText.indexOf("\n");
        if (nlIdx != -1) {
            cmdText = cmdText.substr(0, nlIdx) + "...";
        }
        if (cmdText.length > 80) {
            cmdText = cmdText.substr(0, 77) + "...";
        }
        return cmdText;
    }

    isRunning() : boolean {
        let data = this.data.get();
        return cmdStatusIsRunning(data.status);
    }

    handleData(data : string, termWrap : TermWrap) : void {
        // console.log("handle data", {data: data});
        if (!this.isRunning()) {
            return;
        }
        let inputPacket : FeInputPacketType = {
            type: "feinput",
            ck: this.sessionId + "/" + this.cmdId,
            remote: this.remote,
            inputdata64: btoa(data),
        };
        GlobalModel.sendInputPacket(inputPacket);
    }
};

class Screen {
    sessionId : string;
    screenId : string;
    screenIdx : OV<number>;
    opts : OV<ScreenOptsType>;
    name : OV<string>;
    activeWindowId : OV<string>;
    windows : OArr<ScreenWindow>;
    archived : OV<boolean>;

    constructor(sdata : ScreenDataType) {
        this.sessionId = sdata.sessionid;
        this.screenId = sdata.screenid;
        this.name = mobx.observable.box(sdata.name, {name: "screen-name"});
        this.screenIdx = mobx.observable.box(sdata.screenidx, {name: "screen-screenidx"});
        this.opts = mobx.observable.box(sdata.screenopts, {name: "screen-opts"});
        this.activeWindowId = mobx.observable.box(ces(sdata.activewindowid), {name: "screen-activewindowid"});
        this.archived = mobx.observable.box(!!sdata.archived, {name: "screen-archived"});
        let swArr : ScreenWindow[] = [];
        let wins = sdata.windows || [];
        for (let i=0; i<wins.length; i++) {
            let sw = new ScreenWindow(wins[i]);
            swArr.push(sw);
        }
        this.windows = mobx.observable.array(swArr, {deep: false})
    }

    dispose() {
    }

    mergeData(data : ScreenDataType) {
        if (data.sessionid != this.sessionId || data.screenid != this.screenId) {
            throw new Error("invalid screen update, ids don't match")
        }
        mobx.action(() => {
            if (data.screenidx != 0) {
                this.screenIdx.set(data.screenidx);
            }
            if (data.screenopts != null) {
                this.opts.set(data.screenopts);
            }
            if (!isBlank(data.name)) {
                this.name.set(data.name);
            }
            if (!isBlank(data.activewindowid)) {
                this.activeWindowId.set(data.activewindowid);
            }
            this.archived.set(!!data.archived);
            // TODO merge windows
        })();
    }

    getActiveSW() : ScreenWindow {
        return this.getSW(this.activeWindowId.get());
    }

    getTabColor() : string {
        let tabColor = "green";
        let screenOpts = this.opts.get();
        if (screenOpts != null && !isBlank(screenOpts.tabcolor)) {
            tabColor = screenOpts.tabcolor;
        }
        return tabColor;
    }

    getSW(windowId : string) : ScreenWindow {
        if (windowId == null) {
            return null;
        }
        for (let i=0; i<this.windows.length; i++) {
            if (this.windows[i].windowId == windowId) {
                return this.windows[i];
            }
        }
        return null;
    }
}

class ScreenWindow {
    sessionId : string;
    screenId : string;
    windowId : string;
    name : OV<string>;
    layout : OV<LayoutType>;
    lastCols : number;
    lastRows : number;
    selectedLine : OV<number>;
    focusType : OV<"input"|"cmd"|"cmd-fg">;
    anchorLine : number = null;
    anchorOffset : number = 0;
    termLineNumFocus : OV<number>;

    // cmdid => TermWrap
    renderers : Record<string, RendererModel> = {};

    setAnchor_debounced : (anchorLine : number, anchorOffset : number) => void;

    constructor(swdata : ScreenWindowType) {
        this.sessionId = swdata.sessionid;
        this.screenId = swdata.screenid;
        this.windowId = swdata.windowid;
        this.name = mobx.observable.box(swdata.name, {name: "name"});
        this.layout = mobx.observable.box(swdata.layout, {name: "layout"});
        this.focusType = mobx.observable.box(swdata.focustype, {name: "focusType"});
        this.selectedLine = mobx.observable.box(swdata.selectedline == 0 ? null : swdata.selectedline, {name: "selectedLine"});
        this.setAnchor_debounced = debounce(1000, this.setAnchor.bind(this));
        if (swdata.selectedline != 0) {
            this.setAnchorFields(swdata.selectedline, 0, "init");
        }
        this.termLineNumFocus = mobx.observable.box(0, {name: "termLineNumFocus"});
    }

    getAnchorStr() : string {
        if (this.anchorLine == null || this.anchorLine == 0) {
            return "0";
        }
        return sprintf("%d:%d", this.anchorLine, this.anchorOffset);
    }

    setAnchorFields(anchorLine : number, anchorOffset : number, reason : string) {
        this.anchorLine = anchorLine;
        this.anchorOffset = anchorOffset;
        // console.log("set-anchor-fields", anchorLine, anchorOffset, reason);
    }

    updateSelf(swdata : ScreenWindowType) {
        mobx.action(() => {
            this.name.set(swdata.name);
            this.layout.set(swdata.layout);
            let oldSelectedLine = this.selectedLine.get();
            let oldFocusType = this.focusType.get();
            this.selectedLine.set(swdata.selectedline);
            this.focusType.set(swdata.focustype);
            this.refocusLine(swdata, oldFocusType, oldSelectedLine);
            // do not update anchorLine/anchorOffset (only stored)
        })();
    }

    refocusLine(swdata : ScreenWindowType, oldFocusType : string, oldSelectedLine : number) : void {
        let isCmdFocus = (swdata.focustype == "cmd" || swdata.focustype == "cmd-fg");
        if (!isCmdFocus) {
            return;
        }
        let curLineFocus = GlobalModel.getFocusedLine();
        let sline : LineType = null;
        if (swdata.selectedline != 0) {
            sline = this.getLineByNum(swdata.selectedline);
        }
        // console.log("refocus", curLineFocus.linenum, "=>", swdata.selectedline, sline.cmdid);
        if (curLineFocus.cmdInputFocus || (curLineFocus.linenum != null && curLineFocus.linenum != swdata.selectedline)) {
            (document.activeElement as HTMLElement).blur();
        }
        if (sline != null && sline.cmdid != null) {
            let termWrap = this.getRenderer(sline.cmdid);
            if (termWrap != null) {
                termWrap.giveFocus();
            }
        }
    }

    setFocusType(ftype : "input" | "cmd" | "cmd-fg") : void {
        mobx.action(() => {
            this.focusType.set(ftype);
        })();
    }

    setAnchor(anchorLine : number, anchorOffset : number) : void {
        let setVal = ((anchorLine == null || anchorLine == 0) ? "0" : sprintf("%d:%d", anchorLine, anchorOffset));
        GlobalCommandRunner.swSetAnchor(this.sessionId, this.screenId, this.windowId, setVal);
    }

    getMaxLineNum() : number {
        let win = this.getWindow();
        if (win == null) {
            return null;
        }
        let lines = win.lines;
        if (lines == null || lines.length == 0) {
            return null;
        }
        return lines[lines.length-1].linenum;
    }

    getLineByNum(lineNum : number) : LineType {
        let win = this.getWindow();
        if (win == null) {
            return null;
        }
        let lines = win.lines;
        if (lines == null || lines.length == 0) {
            return null;
        }
        for (let i=0; i<lines.length; i++) {
            if (lines[i].linenum == lineNum) {
                return lines[i];
            }
        }
        return null;
    }

    getPresentLineNum(lineNum : number) : number {
        let win = this.getWindow();
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
        for (let i=0; i<lines.length; i++) {
            let line = lines[i];
            if (line.linenum == lineNum) {
                return lineNum;
            }
            if (line.linenum > lineNum) {
                return line.linenum;
            }
        }
        return lines[lines.length-1].linenum;
    }

    setSelectedLine(lineNum : number) : void {
        mobx.action(() => {
            let pln = this.getPresentLineNum(lineNum);
            if (pln != this.selectedLine.get()) {
                this.selectedLine.set(pln);
            }
        })();
    }

    checkSelectedLine() : void {
        let pln = this.getPresentLineNum(this.selectedLine.get());
        if (pln != this.selectedLine.get()) {
            this.setSelectedLine(pln);
        }
    }

    updatePtyData(ptyMsg : PtyDataUpdateType) {
        let cmdId = ptyMsg.cmdid;
        let renderer = this.renderers[cmdId];
        if (renderer == null) {
            return;
        }
        let data = base64ToArray(ptyMsg.ptydata64);
        renderer.receiveData(ptyMsg.ptypos, data, "from-sw");
    }

    isActive() : boolean {
        let activeScreen = GlobalModel.getActiveScreen();
        if (activeScreen == null) {
            return false;
        }
        return (this.sessionId == activeScreen.sessionId) && (this.screenId == activeScreen.screenId);
    }

    termSizeCallback(rows : number, cols : number) : void {
        if (!this.isActive()) {
            console.log("termSize (not active)");
            return;
        }
        if (cols == 0 || rows == 0) {
            return;
        }
        if (rows == this.lastRows && cols == this.lastCols) {
            return;
        }
        this.lastRows = rows;
        this.lastCols = cols;
        for (let cmdid in this.renderers) {
            this.renderers[cmdid].resizeCols(cols);
        }
        GlobalCommandRunner.resizeWindow(this.windowId, rows, cols);
    }

    getRenderer(cmdId : string) : RendererModel {
        return this.renderers[cmdId];
    }

    setTermFocus(lineNum : number, focus : boolean) : void {
        // console.log("SW setTermFocus", lineNum, focus);
        mobx.action(() => this.termLineNumFocus.set(focus ? lineNum : 0))();
        if (focus && this.selectedLine.get() != lineNum) {
            GlobalCommandRunner.swSelectLine(String(lineNum), "cmd");
        }
        else if (focus && this.focusType.get() == "input") {
            GlobalCommandRunner.swSetFocus("cmd");
        }
    }

    termCustomKeyHandlerInternal(e : any, termWrap : TermWrap) : void {
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

    isTermCapturedKey(e : any) : boolean {
        let keys = ["ArrowUp", "ArrowDown", "PageUp", "PageDown"];
        if (keys.includes(e.code) && keyHasNoMods(e)) {
            return true;
        }
        return false;
    }

    termCustomKeyHandler(e : any, termWrap : TermWrap) : boolean {
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

    loadImageRenderer(imageDivElem : any, line : LineType, cmd : Cmd) : ImageRendererModel {
        let cmdId = cmd.cmdId;
        let context = {sessionId: this.sessionId, screenId: this.screenId, windowId: this.windowId, cmdId: cmdId, lineId : line.lineid, lineNum: line.linenum};
        let imageModel = new ImageRendererModel(imageDivElem, context, cmd.getTermOpts(), !cmd.isRunning());
        this.renderers[cmdId] = imageModel;
        return imageModel;
    }

    loadTerminalRenderer(elem : Element, line : LineType, cmd : Cmd, width : number) {
        let cmdId = cmd.cmdId;
        let termWrap = this.getRenderer(cmdId);
        if (termWrap != null) {
            console.log("term-wrap already exists for", this.screenId, this.windowId, cmdId);
            return;
        }
        let cols = windowWidthToCols(width);
        let usedRows = GlobalModel.getTUR(this.sessionId, cmdId, cols);
        if (line.contentheight != null && line.contentheight != -1) {
            usedRows = line.contentheight;
        }
        let termContext = {sessionId: this.sessionId, screenId: this.screenId, windowId: this.windowId, cmdId: cmdId, lineId : line.lineid, lineNum: line.linenum};
        termWrap = new TermWrap(elem, {
            termContext: termContext,
            usedRows: usedRows,
            termOpts: cmd.getTermOpts(),
            winSize: {height: 0, width: width},
            dataHandler: cmd.handleData.bind(cmd),
            focusHandler: (focus : boolean) => this.setTermFocus(line.linenum, focus),
            isRunning: cmd.isRunning(),
            customKeyHandler: this.termCustomKeyHandler.bind(this),
        });
        this.renderers[cmdId] = termWrap;
        if ((this.focusType.get() == "cmd" || this.focusType.get() == "cmd-fg") && this.selectedLine.get() == line.linenum) {
            termWrap.giveFocus();
        }
        return;
    }

    unloadRenderer(cmdId : string) {
        let rmodel = this.renderers[cmdId];
        if (rmodel != null) {
            rmodel.dispose();
            delete this.renderers[cmdId];
        }
    }

    getUsedRows(line : LineType, cmd : Cmd, width : number) : number {
        let termOpts = cmd.getTermOpts();
        if (!termOpts.flexrows) {
            return termOpts.rows;
        }
        let termWrap = this.getRenderer(cmd.cmdId);
        if (termWrap == null) {
            let cols = windowWidthToCols(width);
            let usedRows = GlobalModel.getTUR(this.sessionId, cmd.cmdId, cols);
            if (usedRows != null) {
                return usedRows;
            }
            if (line.contentheight != null && line.contentheight != -1) {
                return line.contentheight;
            }
            return (cmd.isRunning() ? 1 : 0);
        }
        return termWrap.getUsedRows();
    }

    getIsFocused(lineNum : number) : boolean {
        return (this.termLineNumFocus.get() == lineNum);
    }

    getWindow() : Window {
        return GlobalModel.getWindowById(this.sessionId, this.windowId);
    }
}

class Window {
    sessionId : string;
    windowId : string;
    curRemote : OV<RemotePtrType> = mobx.observable.box(null, {name: "window-curRemote"});
    loaded : OV<boolean> = mobx.observable.box(false, {name: "window-loaded"});
    loadError : OV<string> = mobx.observable.box(null);
    lines : OArr<LineType> = mobx.observable.array([], {name: "window-lines", deep: false});
    cmds : Record<string, Cmd> = {};

    constructor(sessionId : string, windowId : string) {
        this.sessionId = sessionId;
        this.windowId = windowId;
    }

    getNonArchivedLines() : LineType[] {
        let rtn : LineType[] = [];
        for (let i=0; i<this.lines.length; i++) {
            let line = this.lines[i];
            if (line.archived) {
                continue;
            }
            rtn.push(line);
        }
        return rtn;
    }

    updateWindow(win : WindowDataType, load : boolean) {
        mobx.action(() => {
            if (win.curremote != null && win.curremote.remoteid != "") {
                this.curRemote.set(win.curremote);
            }
            if (load) {
                this.loaded.set(true);
            }
            genMergeSimpleData(this.lines, win.lines, (l : LineType) => String(l.lineid), (l : LineType) => sprintf("%013d:%s", l.ts, l.lineid));
            
            let cmds = win.cmds || [];
            for (let i=0; i<cmds.length; i++) {
                this.cmds[cmds[i].cmdid] = new Cmd(cmds[i]);
            }
        })();
    }

    setWindowLoadError(errStr : string) {
        mobx.action(() => {
            this.loaded.set(true);
            this.loadError.set(errStr);
        })();
    }

    dispose() {
    }

    getCmd(cmdId : string) {
        return this.cmds[cmdId];
    }

    getRunningCmdLines() : LineType[] {
        let rtn : LineType[] = [];
        for (let i=0; i<this.lines.length; i++) {
            let line = this.lines[i];
            if (line.cmdid == null) {
                continue;
            }
            let cmd = this.getCmd(line.cmdid);
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

    getCurRemoteInstance() : RemoteInstanceType {
        let session = GlobalModel.getSessionById(this.sessionId);
        let rptr = this.curRemote.get();
        if (rptr == null) {
            return null;
        }
        return session.getRemoteInstance(this.windowId, this.curRemote.get());
    }

    updateCmd(cmd : CmdDataType) : void {
        if (cmd.remove) {
            throw new Error("cannot remove cmd with updateCmd call [" + cmd.cmdid + "]");
        }
        let origCmd = this.cmds[cmd.cmdid];
        if (origCmd != null) {
            origCmd.setCmd(cmd);
        }
        return;
    }

    mergeCmd(cmd : CmdDataType) : void {
        if (cmd.remove) {
            delete this.cmds[cmd.cmdid];
            return;
        }
        let origCmd = this.cmds[cmd.cmdid];
        if (origCmd == null) {
            this.cmds[cmd.cmdid] = new Cmd(cmd);
            return;
        }
        origCmd.setCmd(cmd);
        return;
    }

    addLineCmd(line : LineType, cmd : CmdDataType, interactive : boolean) {
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
                    for (let i=0; i<lines.length; i++) {
                        if (lines[i].lineid == line.lineid) {
                            this.lines.splice(i, 1);
                            break;
                        }
                    }
                    return;
                }
                let lineIdx = 0;
                for (lineIdx=0; lineIdx<lines.length; lineIdx++) {
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
};

class Session {
    sessionId : string;
    name : OV<string>;
    activeScreenId : OV<string>;
    sessionIdx : OV<number>;
    screens : OArr<Screen>;
    notifyNum : OV<number> = mobx.observable.box(0);
    remoteInstances : OArr<RemoteInstanceType>;
    archived : OV<boolean>;

    constructor(sdata : SessionDataType) {
        this.sessionId = sdata.sessionid;
        this.name = mobx.observable.box(sdata.name);
        this.sessionIdx = mobx.observable.box(sdata.sessionidx);
        this.archived = mobx.observable.box(!!sdata.archived);
        let screenData = sdata.screens || [];
        let screens : Screen[] = [];
        for (let i=0; i<screenData.length; i++) {
            let screen = new Screen(screenData[i]);
            screens.push(screen);
        }
        this.screens = mobx.observable.array(screens, {deep: false});
        this.activeScreenId = mobx.observable.box(ces(sdata.activescreenid));
        let remotes = sdata.remotes || [];
        this.remoteInstances = mobx.observable.array(remotes);
    }

    dispose() : void {
    }

    // session updates only contain screens (no windows)
    mergeData(sdata : SessionDataType) {
        if (sdata.sessionid != this.sessionId) {
            throw new Error(sprintf("cannot merge session data, sessionids don't match sid=%s, data-sid=%s", this.sessionId, sdata.sessionid));
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
            genMergeData(this.screens, sdata.screens, (s : Screen) => s.screenId, (s : ScreenDataType) => s.screenid, (data : ScreenDataType) => new Screen(data), (s : Screen) => s.screenIdx.get());
            if (!isBlank(sdata.activescreenid)) {
                let screen = this.getScreenById(sdata.activescreenid);
                if (screen == null) {
                    console.log(sprintf("got session update, activescreenid=%s, screen not found", sdata.activescreenid));
                }
                else {
                    this.activeScreenId.set(sdata.activescreenid);
                }
            }
            genMergeSimpleData(this.remoteInstances, sdata.remotes, (r) => r.riid, null);
        })();
    }

    getActiveScreen() : Screen {
        return this.getScreenById(this.activeScreenId.get());
    }

    setActiveScreenId(screenId : string) {
        this.activeScreenId.set(screenId);
    }

    getScreenById(screenId : string) : Screen {
        if (screenId == null) {
            return null;
        }
        for (let i=0; i<this.screens.length; i++) {
            if (this.screens[i].screenId == screenId) {
                return this.screens[i];
            }
        }
        return null;
    }

    getRemoteInstance(windowId : string, rptr : RemotePtrType) : RemoteInstanceType {
        if (rptr.name.startsWith("*")) {
            windowId = "";
        }
        for (let i=0; i<this.remoteInstances.length; i++) {
            let rdata = this.remoteInstances[i];
            if (rdata.windowid == windowId && rdata.remoteid == rptr.remoteid && rdata.remoteownerid == rptr.ownerid && rdata.name == rptr.name) {
                return rdata;
            }
        }
        let remote = GlobalModel.getRemote(rptr.remoteid);
        if (remote != null) {
            return {riid: "", sessionid: this.sessionId, windowid: windowId,
                    remoteownerid: rptr.ownerid, remoteid: rptr.remoteid, name: rptr.name, festate: remote.defaultfestate};
        }
        return null;
    }

    getSWs(windowId : string) : ScreenWindow[] {
        let rtn : ScreenWindow[] = [];
        for (let screen of this.screens) {
            let sw = screen.getSW(windowId);
            if (sw != null) {
                rtn.push(sw);
            }
        }
        return rtn;
    }
}

function getDefaultHistoryQueryOpts() : HistoryQueryOpts {
    return {
        queryType: "window",
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
    historyShow : OV<boolean> = mobx.observable.box(false);
    infoShow : OV<boolean> = mobx.observable.box(false);
    cmdInputHeight : OV<number> = mobx.observable.box(0);

    historyType : mobx.IObservableValue<string> = mobx.observable.box("window");
    historyLoading : mobx.IObservableValue<boolean> = mobx.observable.box(false);
    historyAfterLoadIndex : number = 0;
    historyItems : mobx.IObservableValue<HistoryItem[]> = mobx.observable.box(null, {name: "history-items", deep: false}); // sorted in reverse (most recent is index 0)
    filteredHistoryItems : mobx.IComputedValue<HistoryItem[]> = null;
    historyIndex : mobx.IObservableValue<number> = mobx.observable.box(0, {name: "history-index"});  // 1-indexed (because 0 is current)
    modHistory : mobx.IObservableArray<string> = mobx.observable.array([""], {name: "mod-history"});
    historyQueryOpts : OV<HistoryQueryOpts> = mobx.observable.box(getDefaultHistoryQueryOpts());
    
    infoMsg : OV<InfoType> = mobx.observable.box(null);
    infoTimeoutId : any = null;
    remoteTermWrap : TermWrap;
    remoteTermWrapFocus : OV<boolean> = mobx.observable.box(false, {name: "remoteTermWrapFocus"});
    showNoInputMsg : OV<boolean> = mobx.observable.box(false);
    showNoInputTimeoutId : any = null;
    inputMode : OV<null | "comment" | "global"> = mobx.observable.box(null);

    // cursor
    forceCursorPos : OV<number> = mobx.observable.box(null);

    // focus
    inputFocused : OV<boolean> = mobx.observable.box(false);
    lineFocused : OV<boolean> = mobx.observable.box(false);
    physicalInputFocused : OV<boolean> = mobx.observable.box(false);

    constructor() {
        this.filteredHistoryItems = mobx.computed(() => {
            return this._getFilteredHistoryItems();
        });
    }

    setRemoteTermWrapFocus(focus : boolean) : void {
        mobx.action(() => {
            this.remoteTermWrapFocus.set(focus);
        })();
    }

    setInputMode(inputMode : null | "comment" | "global") : void {
        mobx.action(() => {
            this.inputMode.set(inputMode);
        })();
    }

    setShowNoInputMsg(val : boolean) {
        mobx.action(() => {
            if (this.showNoInputTimeoutId != null) {
                clearTimeout(this.showNoInputTimeoutId);
                this.showNoInputTimeoutId = null;
            }
            if (val) {
                this.showNoInputMsg.set(true);
                this.showNoInputTimeoutId = setTimeout(() => this.setShowNoInputMsg(false), 2000);
            }
            else {
                this.showNoInputMsg.set(false);
            }
        })();
    }

    onInputFocus(isFocused : boolean) : void {
        mobx.action(() => {
            if (isFocused) {
                this.inputFocused.set(true);
                this.lineFocused.set(false);
            }
            else {
                if (this.inputFocused.get()) {
                    this.inputFocused.set(false);
                }
            }
        })();
    }

    onLineFocus(isFocused : boolean) : void {
        mobx.action(() => {
            if (isFocused) {
                this.inputFocused.set(false);
                this.lineFocused.set(true);
            }
            else {
                if (this.lineFocused.get()) {
                    this.lineFocused.set(false);
                }
            }
        })();
    }

    _focusCmdInput() : void {
        let elem = document.getElementById("main-cmd-input");
        if (elem != null) {
            elem.focus();
        }
    }

    _focusHistoryInput() : void {
        let elem : HTMLElement = document.querySelector(".cmd-input input.history-input");
        if (elem != null) {
            elem.focus();
        }
    }

    giveFocus() : void {
        if (this.historyShow.get()) {
            this._focusHistoryInput();
        }
        else {
            this._focusCmdInput();
        }
    }

    setPhysicalInputFocused(isFocused : boolean) : void {
        mobx.action(() => {
            this.physicalInputFocused.set(isFocused);
        })();
        if (isFocused) {
            let sw = GlobalModel.getActiveSW();
            if (sw != null) {
                if (sw.focusType.get() != "input") {
                    GlobalCommandRunner.swSetFocus("input");
                }
            }
        }
    }

    getPtyRemoteId() : string {
        let info = this.infoMsg.get();
        if (info == null || isBlank(info.ptyremoteid)) {
            return null;
        }
        return info.ptyremoteid;
    }

    hasFocus() : boolean {
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

    setHistoryType(htype : string) : void {
        if (this.historyQueryOpts.get().queryType == htype) {
            return;
        }
        this.loadHistory(true, -1, htype);
    }

    findBestNewIndex(oldItem : HistoryItem) : number {
        if (oldItem == null) {
            return 0;
        }
        let newItems = this.getFilteredHistoryItems();
        if (newItems.length == 0) {
            return 0;
        }
        let bestIdx = 0;
        for (let i=0; i<newItems.length; i++) {  // still start at i=0 to catch the historynum equality case
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

    setHistoryQueryOpts(opts : HistoryQueryOpts) : void {
        mobx.action(() => {
            let oldItem = this.getHistorySelectedItem();
            this.historyQueryOpts.set(opts);
            let bestIndex = this.findBestNewIndex(oldItem);
            setTimeout(() => this.setHistoryIndex(bestIndex, true), 10);
            return;
        })();
    }

    setHistoryShow(show : boolean) : void {
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

    isHistoryLoaded() : boolean {
        if (this.historyLoading.get()) {
            return false;
        }
        let hitems = this.historyItems.get();
        return (hitems != null);
    }

    loadHistory(show : boolean, afterLoadIndex : number, htype : string) {
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

    openHistory() : void {
        if (this.historyLoading.get()) {
            return;
        }
        if (!this.isHistoryLoaded()) {
            this.loadHistory(true, 0, "window");
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

    updateCmdLine(cmdLine : CmdLineUpdateType) : void {
        mobx.action(() => {
            this.setCurLine(cmdLine.cmdline);
            this.forceCursorPos.set(cmdLine.cursorpos);
        })();
    }

    getHistorySelectedItem() : HistoryItem {
        let hidx = this.historyIndex.get();
        if (hidx == 0) {
            return null;
        }
        let hitems = this.getFilteredHistoryItems();
        if (hidx > hitems.length) {
            return null;
        }
        return hitems[hidx-1];
    }

    getFirstHistoryItem() : HistoryItem {
        let hitems = this.getFilteredHistoryItems();
        if (hitems.length == 0) {
            return null;
        }
        return hitems[0];
    }

    setHistorySelectionNum(hnum : string) : void {
        let hitems = this.getFilteredHistoryItems();
        for (let i=0; i<hitems.length; i++) {
            if (hitems[i].historynum == hnum) {
                this.setHistoryIndex(i+1);
                return;
            }
        }
    }

    setHistoryInfo(hinfo : HistoryInfoType) : void {
        mobx.action(() => {
            let oldItem = this.getHistorySelectedItem();
            let hitems : HistoryItem[] = hinfo.items ?? [];
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
            }
            else if (this.historyAfterLoadIndex) {
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

    getFilteredHistoryItems() : HistoryItem[] {
        return this.filteredHistoryItems.get();
    }

    _getFilteredHistoryItems() : HistoryItem[] {
        let hitems : HistoryItem[] = this.historyItems.get() ?? [];
        let rtn : HistoryItem[] = [];
        let opts = mobx.toJS(this.historyQueryOpts.get());
        let ctx = GlobalModel.getUIContext();
        let curRemote : RemotePtrType = ctx.remote;
        if (curRemote == null) {
            curRemote = {ownerid: "", name: "", remoteid: ""};
        }
        curRemote = mobx.toJS(curRemote);
        for (let i=0; i<hitems.length; i++) {
            let hitem = hitems[i];
            if (hitem.ismetacmd) {
                if (!opts.includeMeta) {
                    continue;
                }
            }
            else {
                if (opts.limitRemoteInstance) {
                    if (hitem.remote == null || isBlank(hitem.remote.remoteid)) {
                        continue;
                    }
                    if (((curRemote.ownerid ?? "") != (hitem.remote.ownerid ?? ""))
                        || ((curRemote.remoteid ?? "") != (hitem.remote.remoteid ?? ""))
                        || ((curRemote.name ?? "" ) != (hitem.remote.name ?? ""))) {
                        continue;
                    }
                }
                else if (opts.limitRemote) {
                    if (hitem.remote == null || isBlank(hitem.remote.remoteid)) {
                        continue;
                    }
                    if (((curRemote.ownerid ?? "") != (hitem.remote.ownerid ?? ""))
                        || ((curRemote.remoteid ?? "") != (hitem.remote.remoteid ?? ""))) {
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

    scrollHistoryItemIntoView(hnum : string) : void {
        let elem : HTMLElement = document.querySelector(".cmd-history .hnum-" + hnum);
        if (elem == null) {
            return;
        }
        let historyDiv = elem.closest(".cmd-history");
        if (historyDiv == null) {
            return;
        }
        let buffer = 15;
        let titleHeight = 24;
        let titleDiv : HTMLElement = document.querySelector(".cmd-history .history-title");
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

    grabSelectedHistoryItem() : void {
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

    setHistoryIndex(hidx : number, force? : boolean) : void {
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

    moveHistorySelection(amt : number) : void {
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

    flashInfoMsg(info : InfoType, timeoutMs : number) : void {
        this._clearInfoTimeout();
        mobx.action(() => {
            this.infoMsg.set(info);
            this.syncTermWrap();
            if (info == null) {
                this.infoShow.set(false);
            }
            else {
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

    hasScrollingInfoMsg() : boolean {
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

    _clearInfoTimeout() : void {
        if (this.infoTimeoutId != null) {
            clearTimeout(this.infoTimeoutId);
            this.infoTimeoutId = null;
        }
    }

    clearInfoMsg(setNull : boolean) : void {
        this._clearInfoTimeout();
        mobx.action(() => {
            this.setHistoryShow(false);
            this.infoShow.set(false);
            if (setNull) {
                this.infoMsg.set(null);
                this.syncTermWrap();
            }
        })();
    }

    toggleInfoMsg() : void {
        this._clearInfoTimeout();
        mobx.action(() => {
            if (this.historyShow.get()) {
                this.setHistoryShow(false);
                return;
            }
            let isShowing = this.infoShow.get();
            if (isShowing) {
                this.infoShow.set(false);
            }
            else {
                if (this.infoMsg.get() != null) {
                    this.infoShow.set(true);
                }
            }
        })();
    }

    @boundMethod
    uiSubmitCommand() : void {
        mobx.action(() => {
            let commandStr = this.getCurLine();
            if (commandStr.trim() == "") {
                return;
            }
            this.resetInput();
            GlobalModel.submitRawCommand(commandStr, true, true);
        })();
    }

    isEmpty() : boolean {
        return this.getCurLine().trim() == "";
    }

    resetInputMode() : void {
        mobx.action(() => {
            this.setInputMode(null);
            this.setCurLine("");
        })();
    }

    setCurLine(val : string) : void {
        let hidx = this.historyIndex.get();
        mobx.action(() => {
            if (val == "\" ") {
                this.setInputMode("comment");
                val = "";
            }
            if (val == "//") {
                this.setInputMode("global");
                val = "";
            }
            if (this.modHistory.length <= hidx) {
                this.modHistory.length = hidx + 1;
            }
            this.modHistory[hidx] = val;
        })();
    }

    resetInput() : void {
        mobx.action(() => {
            this.setHistoryShow(false);
            this.infoShow.set(false);
            this.inputMode.set(null);
            this.resetHistory();
            this.dropModHistory(false);
            this.infoMsg.set(null);
            this.syncTermWrap();
            this._clearInfoTimeout();
        })();
    }

    termKeyHandler(remoteId : string, event : any, termWrap : TermWrap) : void {
        let remote = GlobalModel.getRemote(remoteId);
        if (remote == null) {
            return;
        }
        if (remote.status != "connecting" && remote.installstatus != "connecting") {
            this.setShowNoInputMsg(true);
            return;
        }
        let inputPacket : RemoteInputPacketType = {
            type: "remoteinput",
            remoteid: remoteId,
            inputdata64: btoa(event.key),
        };
        GlobalModel.sendInputPacket(inputPacket);
    }

    syncTermWrap() : void {
        let infoMsg = this.infoMsg.get();
        let remoteId = (infoMsg == null ? null : infoMsg.ptyremoteid);
        let curTermRemoteId = (this.remoteTermWrap == null ? null : this.remoteTermWrap.getContextRemoteId());
        if (remoteId == curTermRemoteId) {
            return;
        }
        if (this.remoteTermWrap != null) {
            this.remoteTermWrap.dispose();
            this.remoteTermWrap = null;
        }
        if (remoteId != null) {
            let elem = document.getElementById("term-remote");
            if (elem == null) {
                console.log("ERROR null term-remote element");
            }
            else {
                let termOpts = {rows: RemotePtyRows, cols: RemotePtyCols, flexrows: false, maxptysize: 64*1024};
                this.remoteTermWrap = new TermWrap(elem, {
                    termContext: {remoteId: remoteId},
                    usedRows: RemotePtyRows,
                    termOpts: termOpts,
                    winSize: null,
                    keyHandler: (e, termWrap) => { this.termKeyHandler(remoteId, e, termWrap)},
                    focusHandler: this.setRemoteTermWrapFocus.bind(this),
                    isRunning: true,
                });
            }
        }
    }

    getCurLine() : string {
        let model = GlobalModel;
        let hidx = this.historyIndex.get();
        if (hidx < this.modHistory.length && this.modHistory[hidx] != null) {
            return this.modHistory[hidx];
        }
        let hitems = this.getFilteredHistoryItems();
        if (hidx == 0 || hitems == null || hidx > hitems.length) {
            return "";
        }
        let hitem = hitems[hidx-1];
        if (hitem == null) {
            return "";
        }
        return hitem.cmdstr;
    }

    dropModHistory(keepLine0 : boolean) : void {
        mobx.action(() => {
            if (keepLine0) {
                if (this.modHistory.length > 1) {
                    this.modHistory.splice(1, this.modHistory.length-1);
                }
            }
            else {
                this.modHistory.replace([""]);
            }
        })();
    }

    resetHistory() : void {
        mobx.action(() => {
            this.setHistoryShow(false);
            this.historyLoading.set(false);
            this.historyType.set("window");
            this.historyItems.set(null);
            this.historyIndex.set(0);
            this.historyQueryOpts.set(getDefaultHistoryQueryOpts());
            this.historyAfterLoadIndex = 0;
            this.dropModHistory(true);
        })();
    }
};

type LineFocusType = {
    cmdInputFocus : boolean,
    lineid? : string,
    linenum? : number,
    windowid? : string,
    cmdid? : string,
};

class BookmarksModel {
    bookmarks : OArr<BookmarkType> = mobx.observable.array([], {name: "Bookmarks"});
    activeBookmark : OV<string> = mobx.observable.box(null, {name: "activeBookmark"});
    editingBookmark : OV<string> = mobx.observable.box(null, {name: "editingBookmark"});
    pendingDelete : OV<string> = mobx.observable.box(null, {name: "pendingDelete"});

    tempDesc : OV<string> = mobx.observable.box("", {name: "bookmarkEdit-tempDesc"});
    tempCmd : OV<string> = mobx.observable.box("", {name: "bookmarkEdit-tempCmd"});

    showBookmarksView(bmArr : BookmarkType[]) : void {
        bmArr = bmArr ?? [];
        mobx.action(() => {
            this.reset();
            GlobalModel.activeMainView.set("bookmarks");
            this.bookmarks.replace(bmArr);
            if (bmArr.length > 0) {
                this.activeBookmark.set(bmArr[0].bookmarkid);
            }
            
        })();
    }

    reset() : void {
        mobx.action(() => {
            this.activeBookmark.set(null);
            this.editingBookmark.set(null);
            this.pendingDelete.set(null);
            this.tempDesc.set("");
            this.tempCmd.set("");
        })();
    }

    closeView() : void {
        mobx.action(() => {
            GlobalModel.activeMainView.set("session");
        })();
    }

    @boundMethod
    clearPendingDelete() : void {
        mobx.action(() => this.pendingDelete.set(null))();
    }

    useBookmark(bookmarkId : string) : void {
        let bm = this.getBookmark(bookmarkId);
        if (bm == null) {
            return;
        }
        mobx.action(() => {
            this.reset();
            GlobalModel.activeMainView.set("session");
            GlobalModel.inputModel.setCurLine(bm.cmdstr);
            setTimeout(() => GlobalModel.inputModel.giveFocus(), 50);
        })();
    }

    selectBookmark(bookmarkId : string) : void {
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

    cancelEdit() : void {
        mobx.action(() => {
            this.pendingDelete.set(null);
            this.editingBookmark.set(null);
            this.tempDesc.set("");
            this.tempCmd.set("");
        })();
    }

    confirmEdit() : void {
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

    handleDeleteBookmark(bookmarkId : string) : void {
        if (this.pendingDelete.get() == null || this.pendingDelete.get() != this.activeBookmark.get()) {
            mobx.action(() => this.pendingDelete.set(this.activeBookmark.get()))();
            setTimeout(this.clearPendingDelete, 2000);
            return;
        }
        GlobalCommandRunner.deleteBookmark(bookmarkId);
        this.clearPendingDelete();
    }

    getBookmark(bookmarkId : string) : BookmarkType {
        if (bookmarkId == null) {
            return null;
        }
        for (let i=0; i<this.bookmarks.length; i++) {
            let bm = this.bookmarks[i];
            if (bm.bookmarkid == bookmarkId) {
                return bm;
            }
        }
        return null;
    }

    getBookmarkPos(bookmarkId : string) : number {
        if (bookmarkId == null) {
            return -1;
        }
        for (let i=0; i<this.bookmarks.length; i++) {
            let bm = this.bookmarks[i];
            if (bm.bookmarkid == bookmarkId) {
                return i;
            }
        }
        return -1;
    }

    getActiveBookmark() : BookmarkType {
        let activeBookmarkId = this.activeBookmark.get();
        return this.getBookmark(activeBookmarkId);
    }

    handleEditBookmark(bookmarkId : string) : void {
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

    mergeBookmarks(bmArr : BookmarkType[]) : void {
        mobx.action(() => {
            genMergeSimpleData(this.bookmarks, bmArr, (bm : BookmarkType) => bm.bookmarkid, (bm : BookmarkType) => sprintf("%05d", bm.orderidx));
        })();
    }
    
    handleDocKeyDown(e : any) : void {
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
                let amtMap = {"ArrowUp": -1, "ArrowDown": 1, "PageUp": -10, "PageDown": 10};
                let amt = amtMap[e.code];
                let curIdx = this.getBookmarkPos(this.activeBookmark.get());
                newPos = curIdx + amt;
                if (newPos < 0) {
                    newPos = 0;
                }
                if (newPos >= this.bookmarks.length) {
                    newPos = this.bookmarks.length-1;
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
    }
    return;
}

class Model {
    clientId : string;
    activeSessionId : OV<string> = mobx.observable.box(null, {name: "activeSessionId"});
    sessionListLoaded : OV<boolean> = mobx.observable.box(false, {name: "sessionListLoaded"});
    sessionList : OArr<Session> = mobx.observable.array([], {name: "SessionList", deep: false});
    ws : WSControl;
    remotes : OArr<RemoteType> = mobx.observable.array([], {name: "remotes", deep: false});
    remotesLoaded : OV<boolean> = mobx.observable.box(false, {name: "remotesLoaded"});
    windows : OMap<string, Window> = mobx.observable.map({}, {name: "windows", deep: false});  // key = "sessionid/windowid"
    termUsedRowsCache : Record<string, number> = {};
    debugCmds : number = 0;
    debugSW : OV<boolean> = mobx.observable.box(false);
    localServerRunning : OV<boolean>;
    authKey : string;
    isDev : boolean;
    activeMainView : OV<"session" | "history" | "bookmarks"> = mobx.observable.box("session", {name: "activeMainView"});

    inputModel : InputModel;
    bookmarksModel : BookmarksModel;
    
    constructor() {
        this.clientId = getApi().getId();
        this.isDev = getApi().getIsDev();
        this.authKey = getApi().getAuthKey();
        this.ws = new WSControl(this.getBaseWsHostPort(), this.clientId, this.authKey, (message : any) => this.runUpdate(message, false));
        this.ws.reconnect();
        this.inputModel = new InputModel();
        this.bookmarksModel = new BookmarksModel();
        let isLocalServerRunning = getApi().getLocalServerStatus();
        this.localServerRunning = mobx.observable.box(isLocalServerRunning, {name: "model-local-server-running"});
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
    }

    getBaseHostPort() : string {
        if (this.isDev) {
            return DevServerEndpoint;
        }
        return ProdServerEndpoint;
    }

    getBaseWsHostPort() : string {
        if (this.isDev) {
            return DevServerWsEndpoint;
        }
        return ProdServerWsEndpoint;
    }

    getFetchHeaders() : Record<string, string> {
        return {
            "x-authkey": this.authKey,
        };
    }

    docSelectionChangeHandler(e : any) {
        // nothing for now
    }

    docKeyDownHandler(e : any) {
        if (isModKeyPress(e)) {
            return;
        }
        if (this.activeMainView.get() == "bookmarks") {
            this.bookmarksModel.handleDocKeyDown(e);
            return;
        }
        if (e.code == "Escape") {
            e.preventDefault();
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

    restartLocalServer() : void {
        getApi().restartLocalServer();
    }

    onLocalServerStatusChange(status : boolean) : void {
        mobx.action(() => {
            this.localServerRunning.set(status);
        })();
    }

    dumpStructure() : void {
        for (let i=0; i<this.sessionList.length; i++) {
            let session = this.sessionList[i];
            console.log("SESSION", session.sessionId);
            for (let j=0; j<session.screens.length; j++) {
                let screen = session.screens[j];
                console.log("  SCREEN", screen.sessionId, screen.screenId);
                for (let k=0; k<screen.windows.length; k++) {
                    let win = screen.windows[k];
                    console.log("    WINDOW", win.sessionId, win.screenId, win.windowId);
                }
            }
        }
    }

    getTUR(sessionId : string, cmdId : string, cols : number) : number {
        let key = sessionId + "/" + cmdId + "/" + cols;
        return this.termUsedRowsCache[key];
    }

    setTUR(termContext : RendererContext, size : TermWinSize, usedRows : number) : void {
        let key = termContext.sessionId + "/" + termContext.cmdId + "/" + size.cols;
        this.termUsedRowsCache[key] = usedRows;
        GlobalCommandRunner.setTermUsedRows(termContext, usedRows);
    }
    
    contextScreen(e : any, screenId : string) {
        getApi().contextScreen({screenId: screenId}, {x: e.x, y: e.y});
    }

    contextEditMenu(e : any, opts : ContextMenuOpts) {
        getApi().contextEditMenu({x: e.x, y: e.y}, opts);
    }

    getUIContext() : UIContextType {
        let rtn : UIContextType = {
            sessionid : null,
            screenid : null,
            windowid : null,
            remote : null,
            winsize: null,
            linenum: null,
        };
        let session = this.getActiveSession();
        if (session != null) {
            rtn.sessionid = session.sessionId;
            let screen = session.getActiveScreen();
            if (screen != null) {
                rtn.screenid = screen.screenId;
                let win = this.getActiveWindow();
                if (win != null) {
                    rtn.windowid = win.windowId;
                    rtn.remote = win.curRemote.get();
                }
                let sw = screen.getActiveSW();
                if (sw != null) {
                    rtn.winsize = {rows: sw.lastRows, cols: sw.lastCols};
                    rtn.linenum = sw.selectedLine.get();
                }
            }
        }
        return rtn;
    }

    onTCmd(e : any, mods : KeyModsType) {
        GlobalCommandRunner.createNewScreen();
    }

    onICmd(e : any, mods : KeyModsType) {
        this.inputModel.giveFocus();
    }

    onLCmd(e : any, mods : KeyModsType) {
        let sw = this.getActiveSW();
        if (sw != null) {
            GlobalCommandRunner.swSetFocus("cmd");
        }
    }

    onHCmd(e : any, mods : KeyModsType) {
        let focusedLine = this.getFocusedLine();
        if (focusedLine != null && focusedLine.cmdInputFocus) {
            this.inputModel.openHistory();
        }
    }

    getFocusedLine() : LineFocusType {
        if (this.inputModel.hasFocus()) {
            return {cmdInputFocus: true};
        }
        let lineElem : any = document.activeElement.closest(".line[data-lineid]");
        if (lineElem == null) {
            return {cmdInputFocus: false};
        }
        let lineNum = parseInt(lineElem.dataset.linenum);
        return {
            cmdInputFocus: false,
            lineid: lineElem.dataset.lineid,
            linenum: (isNaN(lineNum) ? null : lineNum),
            windowid: lineElem.dataset.windowid,
            cmdid: lineElem.dataset.cmdid,
        };
    }

    cmdStatusUpdate(sessionId : string, cmdId : string, origStatus : string, newStatus : string) {
        let wasRunning = cmdStatusIsRunning(origStatus);
        let isRunning = cmdStatusIsRunning(newStatus);
        if (wasRunning && !isRunning) {
            // console.log("cmd status", sessionId, cmdId, origStatus, "=>", newStatus);
            let lines = this.getActiveLinesByCmdId(sessionId, cmdId);
            for (let ptr of lines) {
                let sw = ptr.sw;
                let renderer = sw.getRenderer(cmdId);
                if (renderer != null) {
                    renderer.cmdDone();
                }
            }
        }
    }

    onMetaPageUp() : void {
        GlobalCommandRunner.swSelectLine("-1");
    }

    onMetaPageDown() : void {
        GlobalCommandRunner.swSelectLine("+1");
    }

    onMetaArrowUp() : void {
        GlobalCommandRunner.swSelectLine("-1");
    }

    onMetaArrowDown() : void {
        GlobalCommandRunner.swSelectLine("+1");
    }

    onBracketCmd(e : any, arg : {relative: number}, mods : KeyModsType) {
        if (arg.relative == 1) {
            GlobalCommandRunner.switchScreen("+");
        }
        else if (arg.relative == -1) {
            GlobalCommandRunner.switchScreen("-");
        }
    }

    onDigitCmd(e : any, arg : {digit: number}, mods : KeyModsType) {
        GlobalCommandRunner.switchScreen(String(arg.digit));
    }

    isConnected() : boolean {
        return this.ws.open.get();
    }

    runUpdate(genUpdate : UpdateMessage, interactive : boolean) {
        mobx.action(() => {
            let oldContext = this.getUIContext();
            this.runUpdate_internal(genUpdate, oldContext, interactive);
            let newContext = this.getUIContext()
            if (oldContext.sessionid != newContext.sessionid
                || oldContext.screenid != newContext.screenid
                || oldContext.windowid != newContext.windowid) {
                this.inputModel.resetInput();
            }
            else if (remotePtrToString(oldContext.remote) != remotePtrToString(newContext.remote)) {
                this.inputModel.resetHistory();
            }
        })();
    }

    runUpdate_internal(genUpdate : UpdateMessage, uiContext : UIContextType, interactive : boolean) {
        if ("ptydata64" in genUpdate) {
            let ptyMsg : PtyDataUpdateType = genUpdate;
            if (isBlank(ptyMsg.remoteid)) {
                // regular update
                this.updatePtyData(ptyMsg);
                return;
            }
            else {
                // remote update
                let activeRemoteId = this.inputModel.getPtyRemoteId();
                if (activeRemoteId != ptyMsg.remoteid || this.inputModel.remoteTermWrap == null) {
                    return;
                }
                let ptyData = base64ToArray(ptyMsg.ptydata64);
                this.inputModel.remoteTermWrap.receiveData(ptyMsg.ptypos, ptyData);
                return;
            }
        }
        let update : ModelUpdateType = genUpdate;
        if ("sessions" in update) {
            if (update.connect) {
                this.sessionList.clear();
            }
            let oldActiveScreen = this.getActiveScreen();
            genMergeData(this.sessionList, update.sessions, (s : Session) => s.sessionId, (sdata : SessionDataType) => sdata.sessionid, (sdata : SessionDataType) => new Session(sdata), (s : Session) => s.sessionIdx.get());
            if (!("activesessionid" in update)) {
                let newActiveScreen = this.getActiveScreen();
                if (oldActiveScreen != newActiveScreen) {
                    if (newActiveScreen == null) {
                        this._activateScreen(this.activeSessionId.get(), null, oldActiveScreen);
                    }
                    else {
                        this._activateScreen(newActiveScreen.sessionId, newActiveScreen.screenId, oldActiveScreen);
                    }
                }
            }
        }
        if ("activesessionid" in update) {
            this._activateSession(update.activesessionid);
        }
        if ("line" in update) {
            if (update.line != null) {
                this.addLineCmd(update.line, update.cmd, interactive);
            }
            else if (update.line == null && update.cmd != null) {
                this.updateCmd(update.cmd);
            }
        }
        else if ("cmd" in update) {
            this.updateCmd(update.cmd);
        }
        if ("windows" in update) {
            for (let i=0; i<update.windows.length; i++) {
                this.updateWindow(update.windows[i], false);
            }
        }
        if ("screenwindows" in update) {
            for (let i=0; i<update.screenwindows.length; i++) {
                this.updateSW(update.screenwindows[i]);
            }
        }
        if ("remotes" in update) {
            if (update.connect) {
                this.remotes.clear();
            }
            this.updateRemotes(update.remotes);
        }
        if ("bookmarksview" in update) {
            this.bookmarksModel.showBookmarksView(update.bookmarks);
        }
        else if ("bookmarks" in update) {
            this.bookmarksModel.mergeBookmarks(update.bookmarks);
        }
        if (interactive && "info" in update) {
            let info : InfoType = update.info;
            this.inputModel.flashInfoMsg(info, info.timeoutms);
        }
        if ("cmdline" in update) {
            this.inputModel.updateCmdLine(update.cmdline);
        }
        if (interactive && "history" in update) {
            if (uiContext.sessionid == update.history.sessionid && uiContext.windowid == update.history.windowid) {
                this.inputModel.setHistoryInfo(update.history);
            }
        }
        if ("connect" in update) {
            this.sessionListLoaded.set(true);
            this.remotesLoaded.set(true);
        }
        // console.log("run-update>", Date.now(), interactive, update);
    }

    updateRemotes(remotes : RemoteType[]) : void {
        genMergeSimpleData(this.remotes, remotes, (r) => r.remoteid, null);
    }

    getActiveSession() : Session {
        return this.getSessionById(this.activeSessionId.get());
    }

    getSessionById(sessionId : string) : Session {
        if (sessionId == null) {
            return null;
        }
        for (let i=0; i<this.sessionList.length; i++) {
            if (this.sessionList[i].sessionId == sessionId) {
                return this.sessionList[i];
            }
        }
        return null;
    }

    deactivateWindows() {
        mobx.action(() => {
            this.windows.clear();
        })();
    }

    getWindowById(sessionId : string, windowId : string) : Window {
        return this.windows.get(sessionId + "/" + windowId);
    }

    updateWindow(win : WindowDataType, load : boolean) {
        mobx.action(() => {
            let winKey = win.sessionid + "/" + win.windowid;
            if (win.remove) {
                this.windows.delete(winKey);
                return;
            }
            let existingWin = this.windows.get(winKey);
            if (existingWin == null) {
                if (!load) {
                    console.log("cannot update window that does not exist", winKey);
                    return;
                }
                let newWindow = new Window(win.sessionid, win.windowid);
                this.windows.set(winKey, newWindow);
                newWindow.updateWindow(win, load);
                return;
            }
            else {
                existingWin.updateWindow(win, load);
                existingWin.loaded.set(true);
            }
        })();
    }

    updateSW(swdata : ScreenWindowType) {
        let sw = this.getSWByIds(swdata.sessionid, swdata.screenid, swdata.windowid);
        if (sw == null) {
            return;
        }
        sw.updateSelf(swdata);
    }

    getScreenById(sessionId : string, screenId : string) : Screen {
        let session = this.getSessionById(sessionId);
        if (session == null) {
            return null;
        }
        return session.getScreenById(screenId);
    }

    getActiveWindow() : Window {
        let screen = this.getActiveScreen();
        if (screen == null) {
            return null;
        }
        let activeWindowId = screen.activeWindowId.get();
        return this.windows.get(screen.sessionId + "/" + activeWindowId);
    }

    getActiveSW() : ScreenWindow {
        let screen = this.getActiveScreen();
        if (screen == null) {
            return null;
        }
        return screen.getActiveSW();
    }

    getSWByWindowId(windowId : string) : ScreenWindow {
        let screen = this.getActiveScreen();
        if (screen == null) {
            return null;
        }
        return screen.getSW(windowId);
    }

    getSWByIds(sessionId : string, screenId : string, windowId : string) : ScreenWindow {
        let screen = this.getScreenById(sessionId, screenId);
        if (screen == null) {
            return null;
        }
        return screen.getSW(windowId);
    }

    getActiveScreen() : Screen {
        let session = this.getActiveSession();
        if (session == null) {
            return null;
        }
        return session.getActiveScreen();
    }

    addLineCmd(line : LineType, cmd : CmdDataType, interactive : boolean) {
        let win = this.getWindowById(line.sessionid, line.windowid);
        if (win == null) {
            return;
        }
        win.addLineCmd(line, cmd, interactive);
    }

    updateCmd(cmd : CmdDataType) {
        this.windows.forEach((win : Window) => {
            win.updateCmd(cmd);
        });
    }

    isInfoUpdate(update : UpdateMessage) : boolean {
        if (update == null || "ptydata64" in update) {
            return false;
        }
        return (update.info != null || update.history != null);
    }

    submitCommandPacket(cmdPk : FeCmdPacketType, interactive : boolean) {
        if (this.debugCmds > 0) {
            console.log("[cmd]", cmdPacketString(cmdPk));
            if (this.debugCmds > 1) {
                console.trace();
            }
        }
        let url = sprintf(GlobalModel.getBaseHostPort() + "/api/run-command");
        let fetchHeaders = this.getFetchHeaders();
        fetch(url, {method: "post", body: JSON.stringify(cmdPk), headers: fetchHeaders}).then((resp) => handleJsonFetchResponse(url, resp)).then((data) => {
            mobx.action(() => {
                let update = data.data;
                if (update != null) {
                    this.runUpdate(update, interactive);
                }
                if (interactive && !this.isInfoUpdate(update)) {
                    GlobalModel.inputModel.clearInfoMsg(true);
                }
            })();
        }).catch((err) => {
            this.errorHandler("calling run-command", err, true);
        });
    }

    submitCommand(metaCmd : string, metaSubCmd : string, args : string[], kwargs : Record<string, string>, interactive : boolean) : void {
        let pk : FeCmdPacketType = {
            type: "fecmd",
            metacmd: metaCmd,
            metasubcmd: metaSubCmd,
            args: args,
            kwargs: Object.assign({}, kwargs),
            uicontext : this.getUIContext(),
            interactive : interactive,
        };
        // console.log("CMD", pk.metacmd + (pk.metasubcmd != null ? ":" + pk.metasubcmd : ""), pk.args, pk.kwargs, pk.interactive);
        this.submitCommandPacket(pk, interactive);
    }

    submitRawCommand(cmdStr : string, addToHistory : boolean, interactive : boolean) : void {
        let pk : FeCmdPacketType = {
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
        this.submitCommandPacket(pk, interactive)
    }

    _activateSession(sessionId : string) {
        mobx.action(() => {
            this.activeMainView.set("session");
        })();
        let oldActiveSession = this.getActiveSession();
        if (oldActiveSession != null && oldActiveSession.sessionId == sessionId) {
            return;
        }
        let newSession = this.getSessionById(sessionId);
        if (newSession == null) {
            return;
        }
        this._activateScreen(sessionId, newSession.activeScreenId.get());
    }

    _activateScreen(sessionId : string, screenId : string, oldActiveScreen? : Screen) {
        mobx.action(() => {
            this.activeMainView.set("session");
        })();
        if (!oldActiveScreen) {
            oldActiveScreen = this.getActiveScreen();
        }
        if (oldActiveScreen && oldActiveScreen.sessionId == sessionId && oldActiveScreen.screenId == screenId) {
            return;
        }
        mobx.action(() => {
            this.deactivateWindows();
            let curSessionId = this.activeSessionId.get();
            if (curSessionId != sessionId) {
                this.activeSessionId.set(sessionId);
            }
            this.getActiveSession().activeScreenId.set(screenId);
        })();
        let curScreen = this.getActiveScreen();
        if (curScreen == null) {
            this.ws.watchScreen(sessionId, null);
            return;
        }
        this.ws.watchScreen(curScreen.sessionId, curScreen.screenId);
    }

    _loadWindowAsync(newWin : Window) {
        this.windows.set(newWin.sessionId + "/" + newWin.windowId, newWin);
        let usp = new URLSearchParams({sessionid: newWin.sessionId, windowid: newWin.windowId});
        let url = new URL(GlobalModel.getBaseHostPort() + "/api/get-window?" + usp.toString());
        let fetchHeaders = GlobalModel.getFetchHeaders();
        fetch(url, {headers: fetchHeaders}).then((resp) => handleJsonFetchResponse(url, resp)).then((data) => {
            if (data.data == null) {
                console.log("null window returned from get-window");
                return;
            }
            this.updateWindow(data.data, true);
            return;
        }).catch((err) => {
            this.errorHandler(sprintf("getting window=%s", newWin.windowId), err, false);
        });
    }

    loadWindow(sessionId : string, windowId : string) : Window {
        let newWin = new Window(sessionId, windowId);
        setTimeout(() => this._loadWindowAsync(newWin), 0);
        return newWin;
    }

    getRemote(remoteId : string) : RemoteType {
        for (let i=0; i<this.remotes.length; i++) {
            if (this.remotes[i].remoteid == remoteId) {
                return this.remotes[i];
            }
        }
        return null;
    }

    getRemoteByName(name : string) : RemoteType {
        for (let i=0; i<this.remotes.length; i++) {
            if (this.remotes[i].remotecanonicalname == name || this.remotes[i].remotealias == name) {
                return this.remotes[i];
            }
        }
        return null;
    }

    getCmd(line : LineType) : Cmd {
        let session = this.getSessionById(line.sessionid);
        if (session == null) {
            return null;
        }
        let window = this.getWindowById(line.sessionid, line.windowid);
        if (window == null) {
            return null;
        }
        return window.getCmd(line.cmdid);
    }

    getCmdByIds(sessionid : string, cmdid : string) : Cmd {
        for (let win of this.windows.values()) {
            if (win.sessionId != sessionid) {
                continue;
            }
            let cmd = win.getCmd(cmdid);
            if (cmd != null) {
                return cmd;
            }
        }
        return null;
    }

    getActiveLinesByCmdId(sessionid : string, cmdid : string) : SWLinePtr[] {
        let rtn : SWLinePtr[] = [];
        let session = this.getSessionById(sessionid);
        if (session == null) {
            return [];
        }
        for (let win of this.windows.values()) {
            if (win.sessionId != sessionid) {
                continue;
            }
            if (!win.loaded.get()) {
                continue;
            }
            let cmd = win.getCmd(cmdid);
            if (cmd == null) {
                continue;
            }
            let winLine : LineType = null;
            for (let i=0; i<win.lines.length; i++) {
                if (win.lines[i].cmdid == cmdid) {
                    winLine = win.lines[i];
                    break;
                }
            }
            if (winLine != null) {
                let sws = session.getSWs(win.windowId);
                for (let sw of sws) {
                    rtn.push({line : winLine, win: win, sw: sw});
                }
            }
        }
        return rtn;
    }

    updatePtyData(ptyMsg : PtyDataUpdateType) : void {
        let activeLinePtrs = this.getActiveLinesByCmdId(ptyMsg.sessionid, ptyMsg.cmdid);
        for (let lineptr of activeLinePtrs) {
            lineptr.sw.updatePtyData(ptyMsg);
        }
    }

    errorHandler(str : string, err : any, interactive : boolean) {
        console.log("[error]", str, err);
        if (interactive) {
            let errMsg = "error running command";
            if (err != null && err.message) {
                errMsg = err.message;
            }
            this.inputModel.flashInfoMsg({infoerror: errMsg}, null);
        }
    }

    sendInputPacket(inputPacket : any) {
        this.ws.pushMessage(inputPacket);
    }

    resolveUserIdToName(userid : string) : string {
        return "@[unknown]"
    }

    resolveRemoteIdToRef(remoteId : string) {
        let remote = this.getRemote(remoteId)
        if (remote == null) {
            return "[unknown]";
        }
        if (!isBlank(remote.remotealias)) {
            return remote.remotealias;
        }
        return remote.remotecanonicalname;
    }
}

class CommandRunner {
    constructor() {
    }

    loadHistory(show : boolean, htype : string) {
        let kwargs = {"nohist": "1"};
        if (!show) {
            kwargs["noshow"] = "1";
        }
        if (htype != null && htype != "window") {
            kwargs["type"] = htype;
        }
        GlobalModel.submitCommand("history", null, null, kwargs, true);
    }

    switchSession(session : string) {
        GlobalModel.submitCommand("session", null, [session], {"nohist": "1"}, false);
    }

    switchScreen(screen : string) {
        GlobalModel.submitCommand("screen", null, [screen], {"nohist": "1"}, false);
    }

    createNewSession() {
        GlobalModel.submitCommand("session", "open", null, {"nohist": "1"}, false);
    }

    createNewScreen() {
        GlobalModel.submitCommand("screen", "open", null, {"nohist": "1"}, false);
    }

    closeScreen(screen : string) {
        GlobalModel.submitCommand("screen", "close", [screen], {"nohist": "1"}, false);
    }

    resizeWindow(windowId : string, rows : number, cols : number) {
        GlobalModel.submitCommand("sw", "resize", null, {"nohist": "1", "window": windowId, "cols": String(cols), "rows": String(rows)}, false);
    }

    showRemote(remoteid : string) {
        GlobalModel.submitCommand("remote", "show", null, {"nohist": "1", "remote": remoteid}, true);
    }

    showAllRemotes() {
        GlobalModel.submitCommand("remote", "showall", null, {"nohist": "1"}, true);
    }

    connectRemote(remoteid : string) {
        GlobalModel.submitCommand("remote", "connect", null, {"nohist": "1", "remote": remoteid}, true);
    }

    disconnectRemote(remoteid : string) {
        GlobalModel.submitCommand("remote", "disconnect", null, {"nohist": "1", "remote": remoteid}, true);
    }

    installRemote(remoteid : string) {
        GlobalModel.submitCommand("remote", "install", null, {"nohist": "1", "remote": remoteid}, true);
    }

    installCancelRemote(remoteid : string) {
        GlobalModel.submitCommand("remote", "installcancel", null, {"nohist": "1", "remote": remoteid}, true);
    }

    createRemote(cname : string, kwargsArg : Record<string, string>) {
        let kwargs = Object.assign({}, kwargsArg);
        kwargs["nohist"] = "1";
        GlobalModel.submitCommand("remote", "new", [cname], kwargs, true);
    }

    openCreateRemote() : void {
        GlobalModel.submitCommand("remote", "new", null, {"nohist": "1", "visual": "1"}, true);
    }

    editRemote(remoteid : string, kwargsArg : Record<string, string>) : void {
        let kwargs = Object.assign({}, kwargsArg);
        kwargs["nohist"] = "1";
        kwargs["remote"] = remoteid;
        GlobalModel.submitCommand("remote", "set", null, kwargs, true);
    }

    openEditRemote(remoteid : string) : void {
        GlobalModel.submitCommand("remote", "set", null, {"remote": remoteid, "nohist": "1", "visual": "1"}, true);
    }

    archiveRemote(remoteid : string) {
        GlobalModel.submitCommand("remote", "archive", null, {"remote": remoteid, "nohist": "1"}, true);
    }

    swSelectLine(lineArg : string, focusVal? : string) {
        let kwargs : Record<string, string> = {
            "nohist": "1",
            "line": lineArg,
        };
        if (focusVal != null) {
            kwargs["focus"] = focusVal;
        }
        GlobalModel.submitCommand("sw", "set", null, kwargs, true);
    }

    setTermUsedRows(termContext : RendererContext, height : number) {
        let kwargs : Record<string, string> = {};
        kwargs["session"] = termContext.sessionId;
        kwargs["screen"] = termContext.screenId;
        kwargs["window"] = termContext.windowId;
        kwargs["hohist"] = "1";
        let posargs = [String(termContext.lineNum), String(height)];
        GlobalModel.submitCommand("line", "setheight", posargs, kwargs, false);
    }

    swSetAnchor(sessionId : string, screenId : string, windowId : string, anchorVal : string) : void {
        let kwargs = {
            "nohist": "1",
            "anchor": anchorVal,
            "session": sessionId,
            "screen": screenId,
            "window": windowId,
        };
        GlobalModel.submitCommand("sw", "set", null, kwargs, true);
    }

    swSetFocus(focusVal : string) : void {
        GlobalModel.submitCommand("sw", "set", null, {"focus": focusVal, "nohist": "1"}, true);
    }

    lineStar(lineId : string, starVal : number) {
        GlobalModel.submitCommand("line", "star", [lineId, String(starVal)], {"nohist": "1"}, true);
    }

    lineBookmark(lineId : string) {
        GlobalModel.submitCommand("line", "bookmark", [lineId], {"nohist": "1"}, true);
    }

    linePin(lineId : string, val : boolean) {
        GlobalModel.submitCommand("line", "pin", [lineId, (val ? "1" : "0")], {"nohist": "1"}, true);
    }

    bookmarksView() {
        GlobalModel.submitCommand("bookmarks", "show", null, {"nohist": "1"}, true);
    }

    editBookmark(bookmarkId : string, desc : string, cmdstr : string) {
        let kwargs = {
            "nohist": "1",
            "desc": desc,
            "cmdstr": cmdstr,
        };
        GlobalModel.submitCommand("bookmark", "set", [bookmarkId], kwargs, true);
    }

    deleteBookmark(bookmarkId : string) : void {
        GlobalModel.submitCommand("bookmark", "delete", [bookmarkId], {"nohist": "1"}, true);
    }

    openSharedSession() : void {
        GlobalModel.submitCommand("session", "openshared", null, {"nohist": "1"}, true);
    }
};

function cmdPacketString(pk : FeCmdPacketType) : string {
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

function _getPtyDataFromUrl(url : string) : Promise<PtyDataType> {
    let ptyOffset = 0;
    let fetchHeaders = GlobalModel.getFetchHeaders();
    return fetch(url, {headers: fetchHeaders}).then((resp) => {
        if (!resp.ok) {
            throw new Error(sprintf("Bad fetch response for /api/ptyout: %d %s", resp.status, resp.statusText));
        }
        let ptyOffsetStr = resp.headers.get("X-PtyDataOffset");
        if (ptyOffsetStr != null && !isNaN(parseInt(ptyOffsetStr))) {
            ptyOffset = parseInt(ptyOffsetStr);
        }
        return resp.arrayBuffer();
    }).then((buf) => {
        return {pos: ptyOffset, data: new Uint8Array(buf)};
    });
}

function getPtyData(sessionId : string, cmdId : string) {
    let url = sprintf(GlobalModel.getBaseHostPort() + "/api/ptyout?sessionid=%s&cmdid=%s", sessionId, cmdId);
    return _getPtyDataFromUrl(url);
}

function getRemotePtyData(remoteId : string) {
    let url = sprintf(GlobalModel.getBaseHostPort() + "/api/remote-pty?remoteid=%s", remoteId);
    return _getPtyDataFromUrl(url);
}

let GlobalModel : Model = null;
let GlobalCommandRunner : CommandRunner = null;
if ((window as any).GlobalModel == null) {
    (window as any).GlobalModel = new Model();
    (window as any).GlobalCommandRunner = new CommandRunner();
}
GlobalModel = (window as any).GlobalModel;
GlobalCommandRunner = (window as any).GlobalCommandRunner;

export {Model, Session, Window, GlobalModel, GlobalCommandRunner, Cmd, Screen, ScreenWindow, riToRPtr, windowWidthToCols, windowHeightToRows, termWidthFromCols, termHeightFromRows, getPtyData, getRemotePtyData};


