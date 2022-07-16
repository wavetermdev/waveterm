import * as mobx from "mobx";
import {sprintf} from "sprintf-js";
import {boundMethod} from "autobind-decorator";
import {handleJsonFetchResponse, base64ToArray, genMergeData} from "./util";
import {TermWrap} from "./term";
import {v4 as uuidv4} from "uuid";
import type {SessionDataType, WindowDataType, LineType, RemoteType, HistoryItem, RemoteInstanceType, CmdDataType, FeCmdPacketType, TermOptsType, RemoteStateType, ScreenDataType, ScreenWindowType, ScreenOptsType, LayoutType, PtyDataUpdateType, SessionUpdateType, WindowUpdateType, UpdateMessage, LineCmdUpdateType} from "./types";
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
    onBracketCmd : (callback : (event : any, arg : {relative : number}, mods : KeyModsType) => void) => void,
    onDigitCmd : (callback : (event : any, arg : {digit : number}, mods : KeyModsType) => void) => void,
};

function getApi() : ElectronApi {
    return (window as any).api;
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
    instances : Record<string, TermWrap> = {};

    constructor(cmd : CmdDataType) {
        this.sessionId = cmd.sessionid;
        this.cmdId = cmd.cmdid;
        this.remoteId = cmd.remoteid;
        this.data = mobx.observable.box(cmd, {deep: false});
    }

    connectElem(elem : Element, screenId : string, windowId : string, width : number) {
        let termWrap = this.getTermWrap(screenId, windowId);
        if (termWrap != null) {
            console.log("term-wrap already exists for", screenId, windowId);
            return;
        }
        termWrap = new TermWrap(elem, this.sessionId, this.cmdId, 0, this.getTermOpts(), {height: 0, width: width}, this.handleKey.bind(this));
        this.instances[screenId + "/" + windowId] = termWrap;
        return;
    }

    disconnectElem(screenId : string, windowId : string) {
        let key = screenId + "/" + windowId;
        let termWrap = this.instances[key];
        if (termWrap != null) {
            termWrap.dispose();
            delete this.instances[key];
        }
    }

    updatePtyData(ptyMsg : PtyDataUpdateType) {
        for (let key in this.instances) {
            let tw = this.instances[key];
            let data = base64ToArray(ptyMsg.ptydata64);
            tw.updatePtyData(ptyMsg.ptypos, data);
        }
    }

    getTermWrap(screenId : string, windowId : string) : TermWrap {
        return this.instances[screenId + "/" + windowId];
    }

    getUsedRows(screenId : string, windowId : string) : number {
        let termOpts = this.getTermOpts();
        if (!termOpts.flexrows) {
            return termOpts.rows;
        }
        let termWrap = this.getTermWrap(screenId, windowId);
        if (termWrap == null) {
            return 2;
        }
        return termWrap.usedRows.get();
    }

    getIsFocused(screenId : string, windowId : string) : boolean {
        let termWrap = this.getTermWrap(screenId, windowId);
        if (termWrap == null) {
            return false;
        }
        return termWrap.isFocused.get();
    }

    setCmd(cmd : CmdDataType) {
        mobx.action(() => {
            this.data.set(cmd);
        });
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
            let win = sw.getWindow();
            if (win != null) {
                win.updatePtyData(ptyMsg);
            }
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

    constructor(swdata : ScreenWindowType) {
        this.sessionId = swdata.sessionid;
        this.screenId = swdata.screenid;
        this.windowId = swdata.windowid;
        this.name = mobx.observable.box(swdata.name);
        this.layout = mobx.observable.box(swdata.layout);
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
    history : any[] = [];
    cmds : Record<string, Cmd> = {};
    remoteInstances : OArr<RemoteInstanceType> = mobx.observable.array([]);

    constructor(sessionId : string, windowId : string) {
        this.sessionId = sessionId;
        this.windowId = windowId;
    }

    getNumHistoryItems() : number {
        return 0;
    }

    getHistoryItem(hnum : number) : any {
        return null
    }

    updatePtyData(ptyMsg : PtyDataUpdateType) {
        let cmd = this.cmds[ptyMsg.cmdid];
        if (cmd == null) {
            return;
        }
        cmd.updatePtyData(ptyMsg);
    }

    updateWindow(win : WindowDataType, load : boolean) {
        mobx.action(() => {
            if (!isBlank(win.curremote)) {
                this.curRemote.set(win.curremote);
            }
            if (load) {
                this.loaded.set(true);
            }
            this.lines.replace(win.lines || []);
            this.history = win.history || [];
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

    getCurRemoteInstance() : RemoteInstanceType {
        let rname = this.curRemote.get();
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

    addLineCmd(line : LineType, cmd : CmdDataType, interactive : boolean) {
        if (!this.loaded.get()) {
            return;
        }
        mobx.action(() => {
            if (cmd != null) {
                this.cmds[cmd.cmdid] = new Cmd(cmd);
            }
            let lines = this.lines;
            let lineIdx = 0;
            for (lineIdx=0; lineIdx<lines.length; lineIdx++) {
                let lineId = lines[lineIdx].lineid;
                if (lineId == line.lineid) {
                    this.lines[lineIdx] = line;
                    return;
                }
                if (lineId > line.lineid) {
                    break;
                }
            }
            if (lineIdx == lines.length) {
                this.lines.push(line);
                return;
            }
            this.lines.splice(lineIdx, 0, line);
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
    remoteInstances : OArr<RemoteInstanceType> = mobx.observable.array([]);

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

class Model {
    clientId : string;
    activeSessionId : OV<string> = mobx.observable.box(null);
    sessionListLoaded : OV<boolean> = mobx.observable.box(false);
    sessionList : OArr<Session> = mobx.observable.array([], {name: "SessionList", deep: false});
    ws : WSControl;
    remotes : OArr<RemoteType> = mobx.observable.array([], {deep: false});
    remotesLoaded : OV<boolean> = mobx.observable.box(false);
    windows : OMap<string, Window> = mobx.observable.map({}, {deep: false});
    
    constructor() {
        this.clientId = getApi().getId();
        this.loadRemotes();
        this.loadSessionList();
        this.ws = new WSControl(this.clientId, (message : any) => this.runUpdate(message, false));
        this.ws.reconnect();
        getApi().onTCmd(this.onTCmd.bind(this));
        getApi().onICmd(this.onICmd.bind(this));
        getApi().onBracketCmd(this.onBracketCmd.bind(this));
        getApi().onDigitCmd(this.onDigitCmd.bind(this));
    }

    onTCmd(mods : KeyModsType) {
        console.log("got cmd-t", mods);
        GlobalInput.createNewScreen();
    }

    onICmd(mods : KeyModsType) {
        let elem = document.getElementById("main-cmd-input");
        if (elem != null) {
            elem.focus();
        }
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
            return;
        }
        if ("sessions" in update) {
            let sessionUpdateMsg : SessionUpdateType = update;
            mobx.action(() => {
                let oldActiveScreen = this.getActiveScreen();
                genMergeData(this.sessionList, sessionUpdateMsg.sessions, (s : Session) => s.sessionId, (sdata : SessionDataType) => sdata.sessionid, (sdata : SessionDataType) => new Session(sdata), (s : Session) => s.sessionIdx.get());
                let newActiveScreen = this.getActiveScreen();
                if (oldActiveScreen != newActiveScreen) {
                    if (newActiveScreen == null) {
                        this.activateScreen(this.activeSessionId.get(), null, oldActiveScreen);
                    }
                    else {
                        this.activateScreen(newActiveScreen.sessionId, newActiveScreen.screenId, oldActiveScreen);
                    }
                }
            })();
        }
        if ("line" in update) {
            let lineMsg : LineCmdUpdateType = update;
            this.addLineCmd(lineMsg.line, lineMsg.cmd, interactive);
        }
        console.log("run-update>", interactive, update);
    }

    removeSession(sessionId : string) {
        console.log("removeSession not implemented");
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
                    console.log("cannot update window that does not exist");
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
            this.errorHandler("calling run-command", err);
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

    submitRawCommand(cmdStr : string) {
        let pk : FeCmdPacketType = {
            type: "fecmd",
            metacmd: "eval",
            args: [cmdStr],
            kwargs: this.getClientKwargs(),
        };
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
            this.errorHandler("getting session list", err);
        });
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
            this.activeSessionId.set(sessionId);
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
            this.errorHandler(sprintf("getting window=%s", windowId), err);
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
            this.errorHandler("calling get-remotes", err)
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
            if (this.remotes[i].remotename == name) {
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

    errorHandler(str : string, err : any) {
        console.log("[error]", str, err);
    }

    sendInputPacket(inputPacket : any) {
        this.ws.pushMessage(inputPacket);
    }
}

class InputClass {
    constructor() {
    }

    switchScreen(screen : string) {
        GlobalModel.submitCommand("screen", null, [screen], null);
    }

    createNewScreen() {
        GlobalModel.submitCommand("screen", "open", null, null);
    }

    closeScreen(screen : string) {
        GlobalModel.submitCommand("screen", "close", [screen], null);
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


