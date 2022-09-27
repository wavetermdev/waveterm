import * as mobx from "mobx";
import {sprintf} from "sprintf-js";
import {boundMethod} from "autobind-decorator";
import {debounce} from "throttle-debounce";
import {handleJsonFetchResponse, base64ToArray, genMergeData, genMergeSimpleData} from "./util";
import {TermWrap} from "./term";
import {v4 as uuidv4} from "uuid";
import type {SessionDataType, WindowDataType, LineType, RemoteType, HistoryItem, RemoteInstanceType, RemotePtrType, CmdDataType, FeCmdPacketType, TermOptsType, RemoteStateType, ScreenDataType, ScreenWindowType, ScreenOptsType, LayoutType, PtyDataUpdateType, ModelUpdateType, UpdateMessage, InfoType, CmdLineUpdateType, UIContextType, HistoryInfoType, HistoryQueryOpts, FeInputPacketType, TermWinSize, RemoteInputPacketType} from "./types";
import {WSControl} from "./ws";

var GlobalUser = "sawka";
const DefaultCellWidth = 8;
const DefaultCellHeight = 16;
const RemotePtyRows = 8; // also in main.tsx
const RemotePtyCols = 80;

function widthToCols(width : number) : number {
    let cols = Math.trunc((width - 25) / DefaultCellWidth) - 1;
    if (cols < 0) {
        return 0;
    }
    return cols;
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
    onTCmd : (callback : (mods : KeyModsType) => void) => void,
    onICmd : (callback : (mods : KeyModsType) => void) => void,
    onHCmd : (callback : (mods : KeyModsType) => void) => void,
    onMetaArrowUp : (callback : () => void) => void,
    onMetaArrowDown : (callback : () => void) => void,
    onBracketCmd : (callback : (event : any, arg : {relative : number}, mods : KeyModsType) => void) => void,
    onDigitCmd : (callback : (event : any, arg : {digit : number}, mods : KeyModsType) => void) => void,
    contextScreen : (screenOpts : {screenId : string}, position : {x : number, y : number}) => void,
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
        this.data = mobx.observable.box(cmd, {deep: false});
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

    getStatus() : string {
        return this.data.get().status;
    }

    getTermOpts() : TermOptsType {
        return this.data.get().termopts;
    }

    getCmdStr() : string {
        return this.data.get().cmdstr;
    }

    getRemoteState() : RemoteStateType {
        return this.data.get().remotestate;
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
        return data.status == "running" || data.status == "detached";
    }

    handleKey(event : any) {
        if (!this.isRunning()) {
            return;
        }
        let inputPacket : FeInputPacketType = {
            type: "feinput",
            ck: this.sessionId + "/" + this.cmdId,
            remote: this.remote,
            inputdata64: btoa(event.key),
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

    constructor(sdata : ScreenDataType) {
        this.sessionId = sdata.sessionid;
        this.screenId = sdata.screenid;
        this.name = mobx.observable.box(sdata.name);
        this.screenIdx = mobx.observable.box(sdata.screenidx);
        this.opts = mobx.observable.box(sdata.screenopts);
        this.activeWindowId = mobx.observable.box(ces(sdata.activewindowid));
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
            // TODO merge windows
        })();
    }

    updatePtyData(ptyMsg : PtyDataUpdateType) {
        for (let i=0; i<this.windows.length; i++) {
            let sw = this.windows[i];
            sw.updatePtyData(ptyMsg);
        }
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
    shouldFollow : OV<boolean> = mobx.observable.box(true);
    lastCols : number;

    // cmdid => TermWrap
    terms : Record<string, TermWrap> = {};

    constructor(swdata : ScreenWindowType) {
        this.sessionId = swdata.sessionid;
        this.screenId = swdata.screenid;
        this.windowId = swdata.windowid;
        this.name = mobx.observable.box(swdata.name);
        this.layout = mobx.observable.box(swdata.layout);
    }

    updatePtyData(ptyMsg : PtyDataUpdateType) {
        let cmdId = ptyMsg.cmdid;
        let term = this.terms[cmdId];
        if (term == null) {
            return;
        }
        let data = base64ToArray(ptyMsg.ptydata64);
        term.updatePtyData(ptyMsg.ptypos, data);
    }

    isActive() : boolean {
        let activeScreen = GlobalModel.getActiveScreen();
        if (activeScreen == null) {
            return false;
        }
        return (this.sessionId == activeScreen.sessionId) && (this.screenId == activeScreen.screenId);
    }

    colsCallback(cols : number) : void {
        if (!this.isActive() || cols == 0) {
            return;
        }
        if (cols == this.lastCols) {
            return;
        }
        this.lastCols = cols;
        for (let cmdid in this.terms) {
            this.terms[cmdid].resizeCols(cols);
        }
        GlobalCommandRunner.resizeWindow(this.windowId, cols);
    }

    getTermWrap(cmdId : string) : TermWrap {
        return this.terms[cmdId];
    }

    connectElem(elem : Element, cmd : Cmd, width : number) {
        let cmdId = cmd.cmdId;
        let termWrap = this.getTermWrap(cmdId);
        if (termWrap != null) {
            console.log("term-wrap already exists for", this.screenId, this.windowId, cmdId);
            return;
        }
        let cols = widthToCols(width);
        let usedRows = GlobalModel.getTUR(this.sessionId, cmdId, cols);
        termWrap = new TermWrap(elem, {sessionId: this.sessionId, cmdId: cmdId}, usedRows, cmd.getTermOpts(), {height: 0, width: width}, cmd.handleKey.bind(cmd));
        this.terms[cmdId] = termWrap;
        return;
    }

    disconnectElem(cmdId : string) {
        let termWrap = this.terms[cmdId];
        if (termWrap != null) {
            termWrap.dispose();
            delete this.terms[cmdId];
        }
    }

    getUsedRows(cmd : Cmd, width : number) : number {
        let termOpts = cmd.getTermOpts();
        if (!termOpts.flexrows) {
            return termOpts.rows;
        }
        let termWrap = this.getTermWrap(cmd.cmdId);
        if (termWrap == null) {
            let cols = widthToCols(width);
            let usedRows = GlobalModel.getTUR(this.sessionId, cmd.cmdId, cols);
            if (usedRows != null) {
                return usedRows;
            }
            return 2;
        }
        return termWrap.usedRows.get();
    }

    getIsFocused(cmdId : string) : boolean {
        let termWrap = this.getTermWrap(cmdId);
        if (termWrap == null) {
            return false;
        }
        return termWrap.isFocused.get();
    }

    reset() {
        mobx.action(() => {
            this.shouldFollow.set(true);
        })();
    }

    getWindow() : Window {
        return GlobalModel.getWindowById(this.sessionId, this.windowId);
    }
}

class Window {
    sessionId : string;
    windowId : string;
    curRemote : OV<RemotePtrType> = mobx.observable.box(null);
    loaded : OV<boolean> = mobx.observable.box(false);
    loadError : OV<string> = mobx.observable.box(null);
    lines : OArr<LineType> = mobx.observable.array([], {deep: false});
    cmds : Record<string, Cmd> = {};

    constructor(sessionId : string, windowId : string) {
        this.sessionId = sessionId;
        this.windowId = windowId;
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
            if (status == "running" || status == "detached") {
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

    constructor(sdata : SessionDataType) {
        this.sessionId = sdata.sessionid;
        this.name = mobx.observable.box(sdata.name);
        this.sessionIdx = mobx.observable.box(sdata.sessionidx);
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
                    remoteownerid: rptr.ownerid, remoteid: rptr.remoteid, name: rptr.name,
                    state: remote.defaultstate};
        }
        return null;
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
    showNoInputMsg : OV<boolean> = mobx.observable.box(false);
    showNoInputTimeoutId : any = null;

    constructor() {
        this.filteredHistoryItems = mobx.computed(() => {
            return this._getFilteredHistoryItems();
        });
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
            let curLine = this.getCurLine();
            if (curLine.length < cmdLine.insertpos) {
                return;
            }
            let pos = cmdLine.insertpos;
            curLine = curLine.substr(0, pos) + cmdLine.insertchars + curLine.substr(pos);
            this.setCurLine(curLine);
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

    setCurLine(val : string) : void {
        let hidx = this.historyIndex.get();
        mobx.action(() => {
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
            this.resetHistory();
            this.dropModHistory(false);
            this.infoMsg.set(null);
            this.syncTermWrap();
            this._clearInfoTimeout();
        })();
    }

    termKeyHandler(remoteId : string, event : any) : void {
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
        let curTermRemoteId = (this.remoteTermWrap == null ? null : this.remoteTermWrap.termContext.remoteId);
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
                this.remoteTermWrap = new TermWrap(elem, {remoteId: remoteId}, RemotePtyRows, termOpts, null, (e) => { this.termKeyHandler(remoteId, e)});
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
    windowid? : string,
    cmdid? : string,
};

class Model {
    clientId : string;
    activeSessionId : OV<string> = mobx.observable.box(null);
    sessionListLoaded : OV<boolean> = mobx.observable.box(false);
    sessionList : OArr<Session> = mobx.observable.array([], {name: "SessionList", deep: false});
    ws : WSControl;
    remotes : OArr<RemoteType> = mobx.observable.array([], {deep: false});
    remotesLoaded : OV<boolean> = mobx.observable.box(false);
    windows : OMap<string, Window> = mobx.observable.map({}, {deep: false});  // key = "sessionid/windowid"
    inputModel : InputModel;
    termUsedRowsCache : Record<string, number> = {};
    remotesModalOpen : OV<boolean> = mobx.observable.box(false);
    addRemoteModalOpen : OV<boolean> = mobx.observable.box(false);
    
    constructor() {
        this.clientId = getApi().getId();
        this.ws = new WSControl(this.clientId, (message : any) => this.runUpdate(message, false));
        this.ws.reconnect();
        this.inputModel = new InputModel();
        getApi().onTCmd(this.onTCmd.bind(this));
        getApi().onICmd(this.onICmd.bind(this));
        getApi().onHCmd(this.onHCmd.bind(this));
        getApi().onMetaArrowUp(this.onMetaArrowUp.bind(this));
        getApi().onMetaArrowDown(this.onMetaArrowDown.bind(this));
        getApi().onBracketCmd(this.onBracketCmd.bind(this));
        getApi().onDigitCmd(this.onDigitCmd.bind(this));
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

    setTUR(sessionId : string, cmdId : string, size : TermWinSize, usedRows : number) : void {
        let key = sessionId + "/" + cmdId + "/" + size.cols;
        this.termUsedRowsCache[key] = usedRows;
    }
    
    contextScreen(e : any, screenId : string) {
        console.log("model", screenId);
        getApi().contextScreen({screenId: screenId}, {x: e.x, y: e.y});
    }

    getUIContext() : UIContextType {
        let rtn : UIContextType = {
            sessionid : null,
            screenid : null,
            windowid : null,
            remote : null,
            termopts : {},
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
                    rtn.termopts.cols = sw.lastCols;
                }
            }
        }
        return rtn;
    }

    onTCmd(e : any, mods : KeyModsType) {
        console.log("got cmd-t", mods);
        GlobalCommandRunner.createNewScreen();
    }

    onICmd(e : any, mods : KeyModsType) {
        this.inputModel.giveFocus();
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
            return null;
        }
        return {
            cmdInputFocus: false,
            lineid: lineElem.dataset.lineid,
            windowid: lineElem.dataset.windowid,
            cmdid: lineElem.dataset.cmdid,
        };
    }

    cmdStatusUpdate(sessionId : string, cmdId : string, origStatus : string, newStatus : string) {
        // TODO force recompute usedrows in terminal when status changes to done
        console.log("cmd status", sessionId, cmdId, origStatus, "=>", newStatus);
        let sw = this.getActiveSW();
        if (sw == null || sw.sessionId != sessionId) {
            return;
        }
        let term = sw.terms[cmdId];
        if (term == null) {
            return;
        }
        setTimeout(() => term.updateUsedRows(true), 500);
    }

    onMetaArrowUp() : void {
        let focus = this.getFocusedLine();
        if (focus == null) {
            return;
        }
        let sw : ScreenWindow = null;
        if (focus.cmdInputFocus) {
            sw = this.getActiveSW();
        }
        else {
            sw = this.getSWByWindowId(focus.windowid);
        }
        if (sw == null) {
            return;
        }
        let win = sw.getWindow();
        if (win == null) {
            return;
        }
        let runningLines = win.getRunningCmdLines();
        if (runningLines.length == 0) {
            return;
        }
        let switchLine : LineType = null;
        if (focus.cmdInputFocus) {
            switchLine = runningLines[runningLines.length-1];
        }
        else {
            let foundIdx = -1;
            for (let i=0; i<runningLines.length; i++) {
                if (runningLines[i].lineid == focus.lineid) {
                    foundIdx = i;
                    break;
                }
            }
            if (foundIdx > 0) {
                switchLine = runningLines[foundIdx-1];
            }
        }
        if (switchLine == null || switchLine.cmdid == null) {
            return;
        }
        let termWrap = sw.getTermWrap(switchLine.cmdid);
        if (termWrap == null || termWrap.terminal == null) {
            return;
        }
        termWrap.terminal.focus();
        console.log("arrow-up", this.getFocusedLine(), "=>", switchLine);
    }

    onMetaArrowDown() : void {
        let focus = this.getFocusedLine();
        if (focus == null || focus.cmdInputFocus) {
            return;
        }
        let sw = this.getSWByWindowId(focus.windowid);
        if (sw == null) {
            return;
        }
        let win = sw.getWindow();
        if (win == null) {
            return;
        }
        let runningLines = win.getRunningCmdLines();
        if (runningLines.length == 0) {
            this.inputModel.giveFocus();
            return;
        }
        let foundIdx = -1;
        for (let i=0; i<runningLines.length; i++) {
            if (runningLines[i].lineid == focus.lineid) {
                foundIdx = i;
                break;
            }
        }
        if (foundIdx == -1 || foundIdx == runningLines.length - 1) {
            this.inputModel.giveFocus();
            return;
        }
        let switchLine = runningLines[foundIdx+1];
        let termWrap = sw.getTermWrap(switchLine.cmdid);
        if (termWrap == null || termWrap.terminal == null) {
            return;
        }
        termWrap.terminal.focus();
        let lineElem = document.getElementById("line-" + getLineId(switchLine));
        if (lineElem != null) {
            lineElem.scrollIntoView({block: "nearest"});
        }
        console.log("arrow-down", this.getFocusedLine());
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
                let activeScreen = this.getActiveScreen();
                if (!activeScreen || activeScreen.sessionId != ptyMsg.sessionid) {
                    return;
                }
                activeScreen.updatePtyData(ptyMsg);
                return;
            }
            else {
                // remote update
                let activeRemoteId = this.inputModel.getPtyRemoteId();
                if (activeRemoteId != ptyMsg.remoteid || this.inputModel.remoteTermWrap == null) {
                    return;
                }
                let ptyData = base64ToArray(ptyMsg.ptydata64);
                this.inputModel.remoteTermWrap.updatePtyData(ptyMsg.ptypos, ptyData);
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
        if ("window" in update) {
            this.updateWindow(update.window, false);
        }
        if ("remotes" in update) {
            if (update.connect) {
                this.remotes.clear();
            }
            this.updateRemotes(update.remotes);
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
        let url = sprintf("http://localhost:8080/api/run-command");
        fetch(url, {method: "post", body: JSON.stringify(cmdPk)}).then((resp) => handleJsonFetchResponse(url, resp)).then((data) => {
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
        this.submitCommandPacket(pk, interactive);
    }

    submitRawCommand(cmdStr : string, addToHistory : boolean, interactive : boolean) : void {
        let pk : FeCmdPacketType = {
            type: "fecmd",
            metacmd: "eval",
            args: [cmdStr],
            kwargs: null,
            uicontext : this.getUIContext(),
            interactive : interactive,
        };
        if (!addToHistory) {
            pk.kwargs["nohist"] = "1";
        }
        this.submitCommandPacket(pk, interactive)
    }

    _activateSession(sessionId : string) {
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

    loadWindow(sessionId : string, windowId : string) : Window {
        let newWin = new Window(sessionId, windowId);
        this.windows.set(sessionId + "/" + windowId, newWin);
        let usp = new URLSearchParams({sessionid: sessionId, windowid: windowId});
        let url = new URL(sprintf("http://localhost:8080/api/get-window?") + usp.toString());
        fetch(url).then((resp) => handleJsonFetchResponse(url, resp)).then((data) => {
            if (data.data == null) {
                console.log("null window returned from get-window");
                return;
            }
            this.updateWindow(data.data, true);
            return;
        }).catch((err) => {
            this.errorHandler(sprintf("getting window=%s", windowId), err, false);
        });
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

    resizeWindow(windowId : string, cols : number) {
        GlobalModel.submitCommand("window", "resize", null, {"nohist": "1", "window": windowId, "cols": String(cols)}, false);
    }

    showRemote(remoteid : string) {
        GlobalModel.submitCommand("remote", "show", null, {"nohist": "1", "remote": remoteid}, true);
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
};

let GlobalModel : Model = null;
let GlobalCommandRunner : CommandRunner = null;
if ((window as any).GlobalModal == null) {
    (window as any).GlobalModel = new Model();
    (window as any).GlobalCommandRunner = new CommandRunner();
}
GlobalModel = (window as any).GlobalModel;
GlobalCommandRunner = (window as any).GlobalCommandRunner;

export {Model, Session, Window, GlobalModel, GlobalCommandRunner, Cmd, Screen, ScreenWindow, riToRPtr, widthToCols};


