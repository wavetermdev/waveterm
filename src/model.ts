import * as mobx from "mobx";
import {sprintf} from "sprintf-js";
import {boundMethod} from "autobind-decorator";
import {handleJsonFetchResponse} from "./util";
import {TermWrap} from "./term";
import {v4 as uuidv4} from "uuid";
import type {SessionDataType, WindowDataType, LineType, RemoteType, HistoryItem, RemoteInstanceType, CmdDataType, FeCmdPacketType, TermOptsType, RemoteStateType} from "./types";
import {WSControl} from "./ws";

type OV<V> = mobx.IObservableValue<V>;
type OArr<V> = mobx.IObservableArray<V>;

function isBlank(s : string) {
    return (s == null || s == "");
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

    connectToElem(elem : Element) {
        this.termWrap.connectToElem(elem, {
            setFocus: this.setFocus.bind(this),
            handleKey: this.handleKey.bind(this),
        });
    }

    reloadTerminal(startTail : boolean, delayMs : number) {
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
                GlobalModel.termChangeSize(this.sessionId, this.windowId, this.cmdId, oldUsedRows, tur);
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
};

class Session {
    sessionId : string;
    name : OV<string>;
    curWindowId : OV<string>;
    windows : OArr<Window>;
    notifyNum : OV<number> = mobx.observable.box(0);

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
        this.clientId = uuidv4();
        this.loadRemotes();
        this.loadSessionList();
        this.ws = new WSControl(this.clientId, this.onMessage.bind(this))
        this.ws.reconnect();
    }

    isConnected() : boolean {
        return this.ws.open.get();
    }

    onMessage(message : any) {
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

    submitCommand(cmdStr : string) {
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

    termChangeSize(sessionId : string, windowId : string, cmdId : string, oldUsedRows : number, newUsedRows : number) {
        console.log("change-size", sessionId + "/" + windowId + "/" + cmdId, oldUsedRows, "=>", newUsedRows);
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


// GlobalWS.registerAndSendGetCmd(getCmdPacket, (dataPacket) => {
//             let realData = atob(dataPacket.ptydata64);
//             this.updatePtyData(this.ptyPos, realData, dataPacket.ptydatalen);
// });


/*
reloadTerminal(startTail : boolean, delayMs : number) {
        loadPtyOut(this.terminal, this.sessionId, this.cmdId, delayMs, (ptyoutLen) => {
            mobx.action(() => {
                this.incRenderVersion();
                this.ptyPos = ptyoutLen;
            })();
            if (startTail) {
                this.startPtyTail();
            }
        });
}

    setCmdStatus(status : string) {
        if (this.cmdStatus == status) {
            return;
        }
        this.cmdStatus = status;
        if (!this.isRunning() && this.tailReqId) {
            this.stopPtyTail();
        }
    }
}

    isRunning() : boolean {
        return this.cmdStatus == "running" || this.cmdStatus == "detached";
    }
*/

