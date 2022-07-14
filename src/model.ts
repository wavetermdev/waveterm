import * as mobx from "mobx";
import {sprintf} from "sprintf-js";
import {boundMethod} from "autobind-decorator";
import {handleJsonFetchResponse, base64ToArray} from "./util";
import {TermWrap} from "./term";
import {v4 as uuidv4} from "uuid";
import type {SessionDataType, WindowDataType, LineType, RemoteType, HistoryItem, RemoteInstanceType, CmdDataType, FeCmdPacketType, TermOptsType, RemoteStateType, ScreenDataType, ScreenWindowType, ScreenOptsType, LayoutType, PtyDataUpdateType} from "./types";
import {WSControl} from "./ws";

var GlobalUser = "sawka";

type OV<V> = mobx.IObservableValue<V>;
type OArr<V> = mobx.IObservableArray<V>;

function isBlank(s : string) {
    return (s == null || s == "");
}

type ElectronApi = {
    getId : () => string,
    onCmdT : (callback : () => void) => void,
    onSwitchScreen : (callback : (event : any, arg : {relative? : number, absolute? : number}) => void) => void,
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

    connectElem(elem : Element, screenId : string, windowId : string) {
        let termWrap = this.getTermWrap(screenId, windowId);
        if (termWrap != null) {
            console.log("term-wrap already exists for", screenId, windowId);
            return;
        }
        termWrap = new TermWrap(elem, this.sessionId, this.cmdId, 0, this.getTermOpts(), this.handleKey.bind(this));
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
    opts : OV<ScreenOptsType>;
    name : OV<string>;
    activeWindowId : OV<string>;
    windows : OArr<ScreenWindow>;

    constructor(sdata : ScreenDataType) {
        this.sessionId = sdata.sessionid;
        this.screenId = sdata.screenid;
        this.name = mobx.observable.box(sdata.name);
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

    getActiveWindow() : Window {
        let session = GlobalModel.getSessionById(this.sessionId);
        if (session == null) {
            return null;
        }
        return session.getWindowById(this.activeWindowId.get());
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

    deactivate() {
        for (let i=0; i<this.windows.length; i++) {
            let sw = this.windows[i];
            sw.reset();
            let win = sw.getWindow();
            if (win != null) {
                win.deactivate();
            }
        }
    }

    loadWindows(force : boolean) {
        let loadedMap : Record<string, boolean> = {};
        let activeWindowId = this.activeWindowId.get();
        if (activeWindowId != null) {
            GlobalModel.loadWindow(this.sessionId, activeWindowId, false);
            loadedMap[activeWindowId] = true;
        }
        for (let i=0; i<this.windows.length; i++) {
            let win = this.windows[i];
            if (loadedMap[win.windowId]) {
                continue;
            }
            loadedMap[win.windowId] = true;
            GlobalModel.loadWindow(this.sessionId, win.windowId, false);
        }
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
    curRemote : OV<string>;
    loaded : OV<boolean> = mobx.observable.box(false);
    lines : OArr<LineType> = mobx.observable.array([], {deep: false});
    linesLoaded : OV<boolean> = mobx.observable.box(false);
    history : any[] = [];
    cmds : Record<string, Cmd> = {};
    remoteInstances : OArr<RemoteInstanceType> = mobx.observable.array([]);

    constructor(wdata : WindowDataType) {
        this.sessionId = wdata.sessionid;
        this.windowId = wdata.windowid;
        this.curRemote = mobx.observable.box(wdata.curremote);
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

    updateWindow(win : WindowDataType, isActive : boolean) {
        mobx.action(() => {
            if (!isBlank(win.curremote)) {
                this.curRemote.set(win.curremote);
            }
            if (!isActive) {
                return;
            }
            this.linesLoaded.set(true);
            this.lines.replace(win.lines || []);
            this.history = win.history || [];
            let cmds = win.cmds || [];
            for (let i=0; i<cmds.length; i++) {
                this.cmds[cmds[i].cmdid] = new Cmd(cmds[i]);
            }
        })();
    }

    deactivate() {
        mobx.action(() => {
            this.linesLoaded.set(false);
            this.lines.replace([]);
            this.history = [];
            this.cmds = {};
        })();
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
        if (!this.linesLoaded.get()) {
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
    screens : OArr<Screen>;
    windows : OArr<Window>;
    notifyNum : OV<number> = mobx.observable.box(0);
    remoteInstances : OArr<RemoteInstanceType> = mobx.observable.array([]);

    constructor(sdata : SessionDataType) {
        this.sessionId = sdata.sessionid;
        this.name = mobx.observable.box(sdata.name);
        let winData = sdata.windows || [];
        let wins : Window[] = [];
        for (let i=0; i<winData.length; i++) {
            let win = new Window(winData[i]);
            wins.push(win);
        }
        this.windows = mobx.observable.array(wins, {deep: false});
        let screenData = sdata.screens || [];
        let screens : Screen[] = [];
        for (let i=0; i<screenData.length; i++) {
            let screen = new Screen(screenData[i]);
            screens.push(screen);
        }
        this.screens = mobx.observable.array(screens, {deep: false});
        this.activeScreenId = mobx.observable.box(ces(sdata.activescreenid));
    }

    updateWindow(win : WindowDataType, isActive : boolean) {
        mobx.action(() => {
            for (let i=0; i<this.windows.length; i++) {
                let foundWin = this.windows[i];
                if (foundWin.windowId != win.windowid) {
                    continue;
                }
                if (win.remove) {
                    this.windows.splice(i, 1);
                    return;
                }
                foundWin.updateWindow(win, isActive);
                return;
            }
            let newWindow = new Window(win);
            newWindow.updateWindow(win, isActive);
            this.windows.push(newWindow);
        })();
    }

    getWindowById(windowId : string) : Window {
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

    addLineCmd(line : LineType, cmd : CmdDataType, interactive : boolean) {
        let win = this.getWindowById(line.windowid);
        if (win != null) {
            win.addLineCmd(line, cmd, interactive);
        }
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
    
    constructor() {
        this.clientId = getApi().getId();
        this.loadRemotes();
        this.loadSessionList();
        this.ws = new WSControl(this.clientId, this.onWSMessage.bind(this))
        this.ws.reconnect();
        getApi().onCmdT(this.onCmdT.bind(this));
        getApi().onSwitchScreen(this.onSwitchScreen.bind(this));
    }

    onCmdT() {
        console.log("got cmd-t");
    }

    onSwitchScreen(e : any, arg : {relative? : number, absolute? : number}) {
        console.log("switch screen", arg);
    }

    isConnected() : boolean {
        return this.ws.open.get();
    }

    onWSMessage(message : any) {
        if ("ptydata64" in message) {
            let ptyMsg : PtyDataUpdateType = message;
            let activeScreen = this.getActiveScreen();
            if (!activeScreen || activeScreen.sessionId != ptyMsg.sessionid) {
                return;
            }
            activeScreen.updatePtyData(ptyMsg);
            return;
        }
        console.log("ws-message", message);
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

    getWindowById(sessionId : string, windowId : string) : Window {
        let session = this.getSessionById(sessionId);
        if (session == null) {
            return null;
        }
        return session.getWindowById(windowId);
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
        return screen.getActiveWindow();
    }

    getActiveScreen() : Screen {
        let session = this.getActiveSession();
        if (session == null) {
            return null;
        }
        return session.getActiveScreen();
    }

    addLineCmd(line : LineType, cmd : CmdDataType, interactive : boolean) {
        let session = this.getSessionById(line.sessionid);
        if (session != null) {
            session.addLineCmd(line, cmd, interactive);
        }
    }

    submitCommand(cmdStr : string) {
        console.log("submit-command>", cmdStr);
        let win = this.getActiveWindow();
        if (win == null) {
            this.errorHandler("cannot submit command, no active window", null)
            return;
        }
        let data : FeCmdPacketType = {type: "fecmd", sessionid: win.sessionId, windowid: win.windowId, cmdstr: cmdStr, userid: GlobalUser, remotestate: null};
        let rstate = win.getCurRemoteInstance();
        if (rstate == null) {
            this.errorHandler("cannot submit command, no remote state found", null);
            return;
        }
        data.remotestate = {remoteid: rstate.remoteid, remotename: rstate.name, ...rstate.state};
        let url = sprintf("http://localhost:8080/api/run-command");
        fetch(url, {method: "post", body: JSON.stringify(data)}).then((resp) => handleJsonFetchResponse(url, resp)).then((data) => {
            mobx.action(() => {
                if (data.data != null && data.data.line != null) {
                    this.addLineCmd(data.data.line, data.data.cmd, true);
                }
            })();
        }).catch((err) => {
            this.errorHandler("calling run-command", err);
        });
    }

    updateWindow(win : WindowDataType) {
        let session = this.getSessionById(win.sessionid);
        if (session == null) {
            return;
        }
        let isActive = (win.sessionid == this.activeSessionId.get());
        session.updateWindow(win, isActive);
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

    activateScreen(sessionId : string, screenId : string) {
        let oldActiveScreen = this.getActiveScreen();
        if (oldActiveScreen && oldActiveScreen.sessionId == sessionId && oldActiveScreen.screenId == screenId) {
            return;
        }
        mobx.action(() => {
            if (oldActiveScreen != null) {
                oldActiveScreen.deactivate();
            }
            this.activeSessionId.set(sessionId);
            this.getActiveSession().activeScreenId.set(screenId);
        })();
        let curScreen = this.getActiveScreen();
        if (curScreen == null) {
            return;
        }
        this.ws.pushMessage({type: "watchscreen", sessionid: curScreen.sessionId, screenid: curScreen.screenId});
        curScreen.loadWindows(false);
    }

    createNewScreen(session : Session, name : string, activate : boolean) {
        let params : Record<string, string> = {sessionid: session.sessionId};
        if (name != null) {
            params.name = name;
        }
        if (activate) {
            params.activate = "1";
        }
        let usp = new URLSearchParams(params);
        let url = new URL("http://localhost:8080/api/create-screen?" + usp.toString());
        fetch(url).then((resp) => handleJsonFetchResponse(url, resp)).then((data) => {
            console.log("created screen", data.data);
        }).catch((err) => {
            this.errorHandler(sprintf("creating screen session=%s", session.sessionId), err);
        });
    }

    loadWindow(sessionId : string, windowId : string, force : boolean) {
        let usp = new URLSearchParams({sessionid: sessionId, windowid: windowId});
        let url = new URL(sprintf("http://localhost:8080/api/get-window?") + usp.toString());
        fetch(url).then((resp) => handleJsonFetchResponse(url, resp)).then((data) => {
            if (data.data == null) {
                console.log("null window returned from get-window");
                return;
            }
            this.updateWindow(data.data);
            return;
        }).catch((err) => {
            this.errorHandler(sprintf("getting window=%s", windowId), err);
        });
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
        let window = session.getWindowById(line.windowid);
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

let GlobalModel : Model = null;
if ((window as any).GlobalModal == null) {
    (window as any).GlobalModel = new Model();
}
GlobalModel = (window as any).GlobalModel;

export {Model, Session, Window, GlobalModel, Cmd, Screen, ScreenWindow};


