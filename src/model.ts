import * as mobx from "mobx";
import {sprintf} from "sprintf-js";
import {boundMethod} from "autobind-decorator";
import {handleJsonFetchResponse, base64ToArray, genMergeData, genMergeSimpleData} from "./util";
import {TermWrap} from "./term";
import {v4 as uuidv4} from "uuid";
import type {SessionDataType, WindowDataType, LineType, RemoteType, HistoryItem, RemoteInstanceType, CmdDataType, FeCmdPacketType, TermOptsType, RemoteStateType, ScreenDataType, ScreenWindowType, ScreenOptsType, LayoutType, PtyDataUpdateType, SessionUpdateType, WindowUpdateType, UpdateMessage, LineCmdUpdateType, InfoType, CmdLineUpdateType} from "./types";
import {WSControl} from "./ws";

var GlobalUser = "sawka";

type OV<V> = mobx.IObservableValue<V>;
type OArr<V> = mobx.IObservableArray<V>;
type OMap<K,V> = mobx.ObservableMap<K,V>;

function isBlank(s : string) {
    return (s == null || s == "");
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
    remoteId : string;
    cmdId : string;
    data : OV<CmdDataType>;
    watching : boolean = false;

    constructor(cmd : CmdDataType) {
        this.sessionId = cmd.sessionid;
        this.cmdId = cmd.cmdid;
        this.remoteId = cmd.remoteid;
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
        console.log("onkey", event);
        if (!this.isRunning()) {
            return;
        }
        let data = this.data.get();
        let inputPacket = {
            type: "input",
            ck: this.sessionId + "/" + this.cmdId,
            inputdata: btoa(event.key),
            remoteid: this.remoteId,
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
        let usedRows = GlobalModel.getTUR(this.sessionId, cmdId, width);
        termWrap = new TermWrap(elem, this.sessionId, cmdId, usedRows, cmd.getTermOpts(), {height: 0, width: width}, cmd.handleKey.bind(cmd));
        this.terms[cmdId] = termWrap;
        return;
    }

    disconnectElem(cmdId : string) {
        let termWrap = this.terms[cmdId];
        if (cmdId != null) {
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
            let usedRows = GlobalModel.getTUR(this.sessionId, cmd.cmdId, width);
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
    curRemote : OV<string> = mobx.observable.box(null);
    loaded : OV<boolean> = mobx.observable.box(false);
    loadError : OV<string> = mobx.observable.box(null);
    lines : OArr<LineType> = mobx.observable.array([], {deep: false});
    cmds : Record<string, Cmd> = {};
    remoteInstances : OArr<RemoteInstanceType> = mobx.observable.array([]);

    constructor(sessionId : string, windowId : string) {
        this.sessionId = sessionId;
        this.windowId = windowId;
    }

    updateWindow(win : WindowDataType, load : boolean) {
        mobx.action(() => {
            if (!isBlank(win.curremote)) {
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
            genMergeSimpleData(this.remoteInstances, win.remotes, (r) => r.riid, null);
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
        let rname = this.curRemote.get();
        if (rname == null) {
            return null;
        }
        let sessionScope = false;
        if (rname.startsWith("^")) {
            rname = rname.substr(1);
            sessionScope = true;
        }
        if (sessionScope) {
            let session = GlobalModel.getSessionById(this.sessionId);
            let rdata = session.getRemoteInstance(rname);
            return rdata;
        }
        return this.getRemoteInstance(rname);
    }

    getRemoteInstance(rname : string) : RemoteInstanceType {
        for (let i=0; i<this.remoteInstances.length; i++) {
            let rdata = this.remoteInstances[i];
            if (rdata.name == rname) {
                return rdata;
            }
        }
        let remote = GlobalModel.getRemoteByName(rname);
        if (remote != null) {
            return {riid: "", sessionid: this.sessionId, windowid: this.windowId, remoteid: remote.remoteid,
                    name: rname, state: remote.defaultstate, sessionscope: false};
        }
        return null;
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

    getRelativeScreenId(rel : number) : string {
        if (!rel) {
            return this.activeScreenId.get();
        }
        if (this.screens.length == 0) {
            return null;
        }
        if (this.screens.length == 1) {
            return this.screens[0].screenId;
        }
        let foundIdx = 0;
        for (let i=0; i<this.screens.length; i++) {
            if (this.screens[i].screenId == this.activeScreenId.get()) {
                foundIdx = i;
                break;
            }
        }
        let relIdx = (foundIdx + rel) % this.screens.length;
        if (relIdx < 0) {
            relIdx += this.screens.length;
        }
        return this.screens[relIdx].screenId;
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

    getRemoteInstance(rname : string) : RemoteInstanceType {
        for (let i=0; i<this.remoteInstances.length; i++) {
            let rdata = this.remoteInstances[i];
            if (rdata.name == rname) {
                return rdata;
            }
        }
        let remote = GlobalModel.getRemoteByName(rname);
        if (remote != null) {
            return {riid: "", sessionid: this.sessionId, windowid: null, remoteid: remote.remoteid,
                    name: rname, state: remote.defaultstate, sessionscope: true};
        }
        return null;
    }
}

class InputModel {
    historyLoading : mobx.IObservableValue<boolean> = mobx.observable.box(false);
    historySessionId : string = null;
    historyItems : mobx.IObservableValue<HistoryItem[]> = mobx.observable.box(null, {name: "history-items", deep: false});
    historyIndex : mobx.IObservableValue<number> = mobx.observable.box(0, {name: "history-index"});  // 1-indexed (because 0 is current)
    modHistory : mobx.IObservableArray<string> = mobx.observable.array([""], {name: "mod-history"});
    setHIdx : number = 0;

    updateCmdLine(cmdLine : CmdLineUpdateType) {
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

    setCurLine(val : string) {
        let hidx = this.historyIndex.get();
        mobx.action(() => {
            if (this.modHistory.length <= hidx) {
                this.modHistory.length = hidx + 1;
            }
            this.modHistory[hidx] = val;
        })();
    }

    loadHistory() {
        if (this.historyLoading.get()) {
            return;
        }
        let sessionId = GlobalModel.activeSessionId.get();
        if (sessionId == null) {
            this.setHIdx = 0;
            return;
        }
        mobx.action(() => {
            this.historySessionId = sessionId;
            this.historyItems.set(null);
            this.historyLoading.set(true);
        })();
        let usp = new URLSearchParams({sessionid: sessionId});
        let url = new URL("http://localhost:8080/api/get-history?" + usp.toString());
        fetch(url).then((resp) => handleJsonFetchResponse(url, resp)).then((data) => {
            mobx.action(() => {
                if (!this.historyLoading.get()) {
                    return;
                }
                if (sessionId != GlobalModel.activeSessionId.get()) {
                    this.resetHistory();
                    return;
                }
                if (data.data && data.data.history) {
                    let hitems : HistoryItem[] = data.data.history || [];
                    this.historySessionId = sessionId;
                    this.historyItems.set(hitems);
                    this.historyLoading.set(false);
                    let hlen = hitems.length;
                    let setHIdx = this.setHIdx;
                    if (setHIdx > hlen) {
                        setHIdx = hlen;
                    }
                    this.historyIndex.set(setHIdx);
                    this.setHIdx = 0;
                }
            })();
        }).catch((err) => {
            GlobalModel.errorHandler("getting history items", err, false);
            mobx.action(() => {
                this.historyLoading.set(false);
                this.historyIndex.set(0);
            })();
        });
    }

    clearCurLine() {
        mobx.action(() => {
            this.resetHistory();
            this.modHistory.replace([""]);
        })();
    }

    getCurLine() : string {
        let model = GlobalModel;
        let hidx = this.historyIndex.get();
        if (hidx < this.modHistory.length && this.modHistory[hidx] != null) {
            return this.modHistory[hidx];
        }
        let hitems = this.historyItems.get();
        if (hidx == 0 || hitems == null || hidx > hitems.length) {
            return "";
        }
        let hitem = hitems[hidx-1];
        if (hitem == null) {
            return "";
        }
        return hitem.cmdstr;
    }

    resetHistory() : void {
        mobx.action(() => {
            this.historyLoading.set(false);
            this.historyItems.set(null);
            this.historyIndex.set(0);
            if (this.modHistory.length > 1) {
                this.modHistory.splice(1, this.modHistory.length-1);
            }
            this.setHIdx = 0;
        })();
    }

    prevHistoryItem() : void {
        let loading = this.historyLoading.get();
        let hitems = this.historyItems.get();
        if (loading || hitems == null) {
            this.setHIdx += 1;
            if (!loading) {
                this.loadHistory();
            }
            return;
        }
        let hidx = this.historyIndex.get();
        hidx += 1;
        if (hidx > hitems.length) {
            hidx = hitems.length;
        }
        mobx.action(() => {
            this.historyIndex.set(hidx);
        })();
        return;
    }

    nextHistoryItem() : void {
        let hidx = this.historyIndex.get();
        if (hidx == 0) {
            return;
        }
        hidx -= 1;
        if (hidx < 0) {
            hidx = 0;
        }
        mobx.action(() => {
            this.historyIndex.set(hidx);
        })();
        return;
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
    infoShow : OV<boolean> = mobx.observable.box(false);
    infoMsg : OV<InfoType> = mobx.observable.box(null);
    infoTimeoutId : any = null;
    inputModel : InputModel;
    termUsedRowsCache : Record<string, number> = {};
    remotesModalOpen : OV<boolean> = mobx.observable.box(false);
    
    constructor() {
        this.clientId = getApi().getId();
        this.loadRemotes();
        this.loadSessionList();
        this.ws = new WSControl(this.clientId, (message : any) => this.runUpdate(message, false));
        this.ws.reconnect();
        this.inputModel = new InputModel();
        getApi().onTCmd(this.onTCmd.bind(this));
        getApi().onICmd(this.onICmd.bind(this));
        getApi().onMetaArrowUp(this.onMetaArrowUp.bind(this));
        getApi().onMetaArrowDown(this.onMetaArrowDown.bind(this));
        getApi().onBracketCmd(this.onBracketCmd.bind(this));
        getApi().onDigitCmd(this.onDigitCmd.bind(this));
    }

    getTUR(sessionId : string, cmdId : string, width : number) : number {
        let key = sessionId + "/" + cmdId + "/" + width;
        return this.termUsedRowsCache[key];
    }

    setTUR(sessionId : string, cmdId : string, width : number, usedRows : number) : void {
        let key = sessionId + "/" + cmdId + "/" + width;
        this.termUsedRowsCache[key] = usedRows;
    }

    contextScreen(e : any, screenId : string) {
        console.log("model", screenId);
        getApi().contextScreen({screenId: screenId}, {x: e.x, y: e.y});
    }

    flashInfoMsg(info : InfoType, timeoutMs : number) {
        if (this.infoTimeoutId != null) {
            clearTimeout(this.infoTimeoutId);
            this.infoTimeoutId = null;
        }
        mobx.action(() => {
            this.infoMsg.set(info);
            this.infoShow.set(info != null);
        })();
        if (info != null && timeoutMs) {
            this.infoTimeoutId = setTimeout(() => {
                this.clearInfoMsg(false);
            }, timeoutMs);
        }
    }

    clearInfoMsg(setNull : boolean) {
        this.infoTimeoutId = null;
        mobx.action(() => {
            this.infoShow.set(false);
            if (setNull) {
                this.infoMsg.set(null);
            }
        })();
    }

    toggleInfoMsg() {
        this.infoTimeoutId = null;
        mobx.action(() => {
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

    onTCmd(mods : KeyModsType) {
        console.log("got cmd-t", mods);
        GlobalInput.createNewScreen();
    }

    focusCmdInput() : void {
        let elem = document.getElementById("main-cmd-input");
        if (elem != null) {
            elem.focus();
        }
    }

    onICmd(mods : KeyModsType) {
        this.focusCmdInput();
    }

    getFocusedLine() : LineFocusType {
        let elem = document.getElementById("main-cmd-input");
        if (document.activeElement == elem) {
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
        console.log("cmd status", sessionId, cmdId, origStatus, "=>", newStatus);
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
        let lineElem = document.getElementById("line-" + getLineId(switchLine));
        if (lineElem != null) {
            lineElem.scrollIntoView({block: "nearest"});
        }
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
            this.focusCmdInput();
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
            this.focusCmdInput();
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
        console.log("switch screen (bracket)", arg, mods);
        let activeSession = this.getActiveSession();
        if (activeSession == null) {
            return;
        }
        let newScreenId = activeSession.getRelativeScreenId(arg.relative);
        if (newScreenId == null) {
            return;
        }
        GlobalInput.switchScreen(newScreenId);
    }

    onDigitCmd(e : any, arg : {digit: number}, mods : KeyModsType) {
        console.log("switch screen (digit)", arg, mods);
        GlobalInput.switchScreen(String(arg.digit));
    }

    isConnected() : boolean {
        return this.ws.open.get();
    }

    runUpdate(update : UpdateMessage, interactive : boolean) {
        if ("ptydata64" in update) {
            let ptyMsg : PtyDataUpdateType = update;
            let activeScreen = this.getActiveScreen();
            if (!activeScreen || activeScreen.sessionId != ptyMsg.sessionid) {
                return;
            }
            activeScreen.updatePtyData(ptyMsg);
        }
        if ("sessions" in update) {
            let sessionUpdateMsg : SessionUpdateType = update;
            mobx.action(() => {
                let oldActiveScreen = this.getActiveScreen();
                genMergeData(this.sessionList, sessionUpdateMsg.sessions, (s : Session) => s.sessionId, (sdata : SessionDataType) => sdata.sessionid, (sdata : SessionDataType) => new Session(sdata), (s : Session) => s.sessionIdx.get());
                if (update.activesessionid) {
                    this.activateSession(update.activesessionid);
                }
                else {
                    let newActiveScreen = this.getActiveScreen();
                    if (oldActiveScreen != newActiveScreen) {
                        if (newActiveScreen == null) {
                            this.activateScreen(this.activeSessionId.get(), null, oldActiveScreen);
                        }
                        else {
                            this.activateScreen(newActiveScreen.sessionId, newActiveScreen.screenId, oldActiveScreen);
                        }
                    }
                }
            })();
        }
        if ("line" in update) {
            let lineMsg : LineCmdUpdateType = update;
            if (lineMsg.line != null) {
                this.addLineCmd(lineMsg.line, lineMsg.cmd, interactive);
            }
            else if (lineMsg.line == null && lineMsg.cmd != null) {
                this.updateCmd(lineMsg.cmd);
            }
        }
        if ("window" in update) {
            let winMsg : WindowUpdateType = update;
            this.updateWindow(winMsg.window, false);
        }
        if ("info" in update) {
            let info : InfoType = update.info;
            this.flashInfoMsg(info, info.timeoutms);
        }
        if ("cmdline" in update) {
            let cmdline : CmdLineUpdateType = update.cmdline;
            this.inputModel.updateCmdLine(cmdline);
        }
        // console.log("run-update>", Date.now(), interactive, update);
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

    getClientKwargs() : Record<string, string> {
        let session = this.getActiveSession();
        let win = this.getActiveWindow();
        let screen = this.getActiveScreen();
        let rtn : Record<string, string> = {};
        if (session != null) {
            rtn.session = session.sessionId;
        }
        if (screen != null) {
            rtn.screen = screen.screenId;
        }
        if (win != null) {
            rtn.window = win.windowId;
            rtn.remote = win.curRemote.get();
        }
        return rtn;
    }

    submitCommandPacket(cmdPk : FeCmdPacketType) {
        let url = sprintf("http://localhost:8080/api/run-command");
        fetch(url, {method: "post", body: JSON.stringify(cmdPk)}).then((resp) => handleJsonFetchResponse(url, resp)).then((data) => {
            mobx.action(() => {
                let update = data.data;
                if (update != null) {
                    this.runUpdate(update, true);
                }
            })();
        }).catch((err) => {
            this.errorHandler("calling run-command", err, true);
        });
    }

    submitCommand(metaCmd : string, metaSubCmd : string, args : string[], kwargs : Record<string, string>) {
        let pk : FeCmdPacketType = {
            type: "fecmd",
            metacmd: metaCmd,
            metasubcmd: metaSubCmd,
            args: args,
            kwargs: Object.assign({}, this.getClientKwargs(), kwargs),
        };
        this.submitCommandPacket(pk);
    }

    submitRawCommand(cmdStr : string, addToHistory : boolean) {
        let pk : FeCmdPacketType = {
            type: "fecmd",
            metacmd: "eval",
            args: [cmdStr],
            kwargs: this.getClientKwargs(),
        };
        if (!addToHistory) {
            pk.kwargs["nohist"] = "1";
        }
        this.submitCommandPacket(pk)
    }

    loadSessionList() {
        let url = new URL("http://localhost:8080/api/get-all-sessions");
        fetch(url).then((resp) => handleJsonFetchResponse(url, resp)).then((data) => {
            mobx.action(() => {
                let sdatalist : SessionDataType[] = data.data || [];
                let slist : Session[] = [];
                let activeSessionId = null;
                let activeScreenId = null;
                for (let i=0; i<sdatalist.length; i++) {
                    let sdata = sdatalist[i];
                    let s = new Session(sdata);
                    if (s.name.get() == "default") {
                        activeSessionId = s.sessionId;
                        activeScreenId = s.activeScreenId.get();
                    }
                    slist.push(s);
                }
                this.sessionList.replace(slist);
                this.sessionListLoaded.set(true)
                if (activeScreenId != null) {
                    this.activateScreen(activeSessionId, activeScreenId);
                }
            })();
        }).catch((err) => {
            this.errorHandler("getting session list", err, false);
        });
    }

    activateSession(sessionId : string) {
        let oldActiveSession = this.getActiveSession();
        if (oldActiveSession.sessionId == sessionId) {
            return;
        }
        let newSession = this.getSessionById(sessionId);
        if (newSession == null) {
            return;
        }
        this.activateScreen(sessionId, newSession.activeScreenId.get());
    }

    activateScreen(sessionId : string, screenId : string, oldActiveScreen? : Screen) {
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
                this.inputModel.resetHistory();
            }
            this.getActiveSession().activeScreenId.set(screenId);
        })();
        let curScreen = this.getActiveScreen();
        if (curScreen == null) {
            this.ws.pushMessage({type: "watchscreen", sessionid: sessionId});
            return;
        }
        this.ws.pushMessage({type: "watchscreen", sessionid: curScreen.sessionId, screenid: curScreen.screenId});
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

    loadRemotes() {
        let url = new URL("http://localhost:8080/api/get-remotes");
        fetch(url).then((resp) => handleJsonFetchResponse(url, resp)).then((data) => {
            mobx.action(() => {
                this.remotes.replace(data.data || [])
                this.remotesLoaded.set(true);
            })();
        }).catch((err) => {
            this.errorHandler("calling get-remotes", err, false)
        });
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
            this.flashInfoMsg({infoerror: errMsg}, null);
        }
    }

    sendInputPacket(inputPacket : any) {
        this.ws.pushMessage(inputPacket);
    }
}

class InputClass {
    constructor() {
    }

    switchSession(session : string) {
        GlobalModel.submitCommand("session", null, [session], {"nohist": "1"});
    }

    switchScreen(screen : string) {
        GlobalModel.submitCommand("screen", null, [screen], {"nohist": "1"});
    }

    createNewSession() {
        GlobalModel.submitCommand("session", "open", null, {"nohist": "1"});
    }

    createNewScreen() {
        GlobalModel.submitCommand("screen", "open", null, {"nohist": "1"});
    }

    closeScreen(screen : string) {
        GlobalModel.submitCommand("screen", "close", [screen], {"nohist": "1"});
    }
};

let GlobalModel : Model = null;
let GlobalInput : InputClass = null;
if ((window as any).GlobalModal == null) {
    (window as any).GlobalModel = new Model();
    (window as any).GlobalInput = new InputClass();
}
GlobalModel = (window as any).GlobalModel;
GlobalInput = (window as any).GlobalInput;

export {Model, Session, Window, GlobalModel, GlobalInput, Cmd, Screen, ScreenWindow};


