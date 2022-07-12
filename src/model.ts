import * as mobx from "mobx";
import {sprintf} from "sprintf-js";
import {boundMethod} from "autobind-decorator";
import {handleJsonFetchResponse} from "./util";
import {TermWrap} from "./term";
import {v4 as uuidv4} from "uuid";
import type {SessionDataType, WindowDataType, LineType, RemoteType, HistoryItem, RemoteInstanceType, CmdDataType, FeCmdPacketType, TermOptsType, RemoteStateType} from "./types";
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
};

function getApi() : ElectronApi {
    return (window as any).api;
}

class Cmd {
    sessionId : string;
    windowId : string;
    remoteId : string;
    cmdId : string;
    data : OV<CmdDataType>;

    termWrap : TermWrap;
    ptyPos : number = 0;
    atRowMax : boolean = false;
    usedRowsUpdated : () => void = null;
    watching : boolean = false;
    isFocused : OV<boolean> = mobx.observable.box(false, {name: "focus"});
    usedRows : OV<number>;
    connectedElem : Element;

    constructor(cmd : CmdDataType, windowId : string) {
        this.sessionId = cmd.sessionid;
        this.windowId = windowId;
        this.cmdId = cmd.cmdid;
        this.remoteId = cmd.remoteid;
        this.data = mobx.observable.box(cmd, {deep: false});
        if (cmd.termopts.flexrows) {
            this.atRowMax = false;
            this.usedRows = mobx.observable.box(2, {name: "usedRows"});
        }
        else {
            this.atRowMax = true;
            this.usedRows = mobx.observable.box(cmd.termopts.rows, {name: "usedRows"});
        }
    }

    disconnectElem() {
        this.connectedElem = null;
    }

    connectElem(elem : Element) {
        if (this.connectedElem != null) {
            console.log("WARNING element already connected to cmd", this.cmdId, this.connectedElem);
        }
        this.connectedElem = elem;
        if (this.termWrap == null) {
            this.termWrap = new TermWrap(this.getTermOpts());
            this.reloadTerminal(0);
        }
        this.termWrap.connectToElem(elem, {
            setFocus: this.setFocus.bind(this),
            handleKey: this.handleKey.bind(this),
        });
    }

    reloadTerminal(delayMs : number) {
        if (this.termWrap == null) {
            return;
        }
        this.termWrap.terminal.clear();
        let url = sprintf("http://localhost:8080/api/ptyout?sessionid=%s&cmdid=%s", this.sessionId, this.cmdId);
        fetch(url).then((resp) => {
            if (!resp.ok) {
                throw new Error(sprintf("Bad fetch response for /api/ptyout: %d %s", resp.status, resp.statusText));
            }
            return resp.arrayBuffer()
        }).then((buf) => {
            setTimeout(() => {
                this.ptyPos = 0;
                this.updatePtyData(0, new Uint8Array(buf), buf.byteLength);
            }, delayMs);
        });
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

    updateUsedRows() {
        if (this.atRowMax) {
            return;
        }
        let tur = this.termWrap.getTermUsedRows();
        if (tur >= this.termWrap.terminal.rows) {
            this.atRowMax = true;
        }
        if (tur > this.usedRows.get()) {
            mobx.action(() => {
                let data = this.data.get();
                let oldUsedRows = this.usedRows.get();
                this.usedRows.set(tur);
                if (this.connectedElem) {
                    let resizeEvent = new CustomEvent("termresize", {
                        bubbles: true,
                        detail: {
                            cmdId: this.cmdId,
                            oldUsedRows: oldUsedRows,
                            newUsedRows: tur,
                        },
                    });
                    this.connectedElem.dispatchEvent(resizeEvent);
                }
            })();
        }
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

    updatePtyData(pos : number, data : string | Uint8Array, datalen : number) {
        if (pos != this.ptyPos) {
            throw new Error(sprintf("invalid pty-update, data-pos[%d] does not match term-pos[%d]", pos, this.ptyPos));
        }
        this.ptyPos += datalen;
        this.termWrap.terminal.write(data, () => {
            this.updateUsedRows();
        });
    }

    setFocus(focus : boolean) {
        mobx.action(() => {
            this.isFocused.set(focus);
        })();
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

class Window {
    sessionId : string;
    windowId : string;
    name : OV<string>;
    curRemote : OV<string>;
    loaded : OV<boolean> = mobx.observable.box(false);
    lines : OArr<LineType> = mobx.observable.array([]);
    linesLoaded : OV<boolean> = mobx.observable.box(false);
    history : any[] = [];
    cmds : Record<string, Cmd> = {};
    shouldFollow : OV<boolean> = mobx.observable.box(true);
    remoteInstances : OArr<RemoteInstanceType> = mobx.observable.array([]);

    constructor(wdata : WindowDataType) {
        this.sessionId = wdata.sessionid;
        this.windowId = wdata.windowid;
        this.name = mobx.observable.box(wdata.name);
        this.curRemote = mobx.observable.box(wdata.curremote);
    }

    getNumHistoryItems() : number {
        return 0;
    }

    getHistoryItem(hnum : number) : any {
        return null
    }

    updateWindow(win : WindowDataType, isActive : boolean) {
        mobx.action(() => {
            if (!isBlank(win.name)) {
                this.name.set(win.name)
            }
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
                this.cmds[cmds[i].cmdid] = new Cmd(cmds[i], this.windowId);
            }
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
                    name: rname, state: remote.defaultstate, sessionscope: false, version: 0};
        }
        return null;
    }

    addLineCmd(line : LineType, cmd : CmdDataType, interactive : boolean) {
        if (!this.linesLoaded.get()) {
            return;
        }
        mobx.action(() => {
            if (cmd != null) {
                this.cmds[cmd.cmdid] = new Cmd(cmd, this.windowId);
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
    curWindowId : OV<string>;
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
        this.windows = mobx.observable.array(wins);
        this.curWindowId = mobx.observable.box((wins.length == 0 ? null : wins[0].windowId));
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

    getActiveWindow() : Window {
        return this.getWindowById(this.curWindowId.get());
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
                    name: rname, state: remote.defaultstate, sessionscope: true, version: 0};
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
    curSessionId : OV<string> = mobx.observable.box(null);
    sessionListLoaded : OV<boolean> = mobx.observable.box(false);
    sessionList : OArr<Session> = mobx.observable.array([], {name: "SessionList"});
    ws : WSControl;
    remotes : OArr<RemoteType> = mobx.observable.array([], {deep: false});
    remotesLoaded : OV<boolean> = mobx.observable.box(false);
    
    constructor() {
        this.clientId = getApi().getId();
        this.loadRemotes();
        this.loadSessionList();
        this.ws = new WSControl(this.clientId, this.onWSMessage.bind(this))
        this.ws.reconnect();
    }

    isConnected() : boolean {
        return this.ws.open.get();
    }

    onWSMessage(message : any) {
        console.log("ws-message", message);
    }

    getActiveSession() : Session {
        return this.getSessionById(this.curSessionId.get());
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

    getActiveWindow() : Window {
        let session = this.getActiveSession();
        if (session == null) {
            return null;
        }
        return session.getActiveWindow();
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
        let isActive = (win.sessionid == this.curSessionId.get());
        session.updateWindow(win, isActive);
    }

    loadSessionList() {
        let url = new URL("http://localhost:8080/api/get-all-sessions");
        fetch(url).then((resp) => handleJsonFetchResponse(url, resp)).then((data) => {
            mobx.action(() => {
                let sdatalist : SessionDataType[] = data.data || [];
                let slist : Session[] = [];
                let defaultSessionId = null;
                for (let i=0; i<sdatalist.length; i++) {
                    let sdata = sdatalist[i];
                    if (sdata.name == "default") {
                        defaultSessionId = sdata.sessionid;
                    }
                    let s = new Session(sdata);
                    slist.push(s);
                }
                this.sessionList.replace(slist);
                this.sessionListLoaded.set(true)
                this.curSessionId.set(defaultSessionId);
                let win = this.getActiveWindow();
                if (win != null) {
                    this.loadWindow(win.sessionId, win.windowId);
                }
            })();
        }).catch((err) => {
            this.errorHandler("getting session list", err);
        });
    }

    loadWindow(sessionId : string, windowId : string) {
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

export {Model, Session, Window, GlobalModel, Cmd};


