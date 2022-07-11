import * as mobx from "mobx";
import {sprintf} from "sprintf-js";
import {boundMethod} from "autobind-decorator";
import {handleJsonFetchResponse} from "./util";
import {TermWrap} from "./term";
import {v4 as uuidv4} from "uuid";
import type {SessionDataType, WindowDataType, LineType, RemoteType, HistoryItem, RemoteInstanceType, CmdDataType, FeCmdPacketType} from "./types";
import {WSControl} from "./ws";

type OV<V> = mobx.IObservableValue<V>;
type OArr<V> = mobx.IObservableArray<V>;

class Cmd {
    cmdId : string;
    data : OV<CmdDataType>;

    terminal : any;
    ptyPos : number = 0;
    atRowMax : boolean = false;
    usedRowsUpdated : () => void = null;
    watching : boolean = false;

    constructor(cmd : CmdDataType) {
        this.cmdId = cmd.cmdid;
        this.data = mobx.observable.box(cmd, {deep: false});
    }

    setCmd(cmd : CmdDataType) {
        mobx.action(() => {
            this.data.set(cmd);
        });
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
};

class Window {
    windowId : string;
    name : OV<string>;
    curRemote : OV<string>;
    loaded : OV<boolean> = mobx.observable.box(false);
    lines : OArr<LineType> = mobx.observable.array([]);
    linesLoaded : OV<boolean> = mobx.observable.box(false);
    history : any[] = [];

    constructor(wdata : WindowDataType) {
        this.windowId = wdata.windowid;
        this.name = mobx.observable.box(wdata.name);
        this.curRemote = mobx.observable.box(wdata.curremote);
    }
    
    getNumHistoryItems() : number {
        return 0;
    }

    getHistoryItem() : any {
        return null
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

    getActiveWindow() : Window {
        let cwin = this.curWindowId.get();
        if (cwin == null) {
            return null;
        }
        for (let i=0; i<this.windows.length; i++) {
            if (this.windows[i].windowId == cwin) {
                return this.windows[i];
            }
        }
        return null;
    }
}

class Model {
    clientId : string;
    curSessionId : OV<string> = mobx.observable.box(null);
    sessionListLoaded : OV<boolean> = mobx.observable.box(false);
    sessionList : OArr<Session> = mobx.observable.array([], {name: "SessionList"});
    cmds : Record<string, Cmd> = {};
    ws : WSControl;
    
    constructor() {
        this.clientId = uuidv4();
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
        let sid = this.curSessionId.get();
        if (sid == null) {
            return null;
        }
        for (let i=0; i<this.sessionList.length; i++) {
            if (this.sessionList[i].sessionId == sid) {
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

    getCmd(cmdId : string) : Cmd {
        return this.cmds[cmdId];
    }

    submitCommand(windowId : string, cmdStr : string) {
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
            })();
        }).catch((err) => {
            console.log("error getting session list");
        });
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

export {Model, Window, GlobalModel, Cmd};


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
