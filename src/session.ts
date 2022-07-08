import * as mobx from "mobx";
import {sprintf} from "sprintf-js";
import {boundMethod} from "autobind-decorator";
import {handleJsonFetchResponse} from "./util";
import {TermWrap} from "./term";
import {v4 as uuidv4} from "uuid";

var GlobalUser = "sawka";

function makeTermKey(sessionId : string, cmdId : string, windowId : string, lineid : number) : string {
    return sprintf("%s/%s/%s/%s", sessionId, cmdId, windowId, lineid);
}

type SessionType = {
    sessionid : string,
    name : string,
};

type LineType = {
    sessionid : string,
    windowid : string,
    lineid : number,
    ts : number,
    userid : string,
    linetype : string,
    text : string,
    cmdid : string,
    isnew : boolean,
};

function getLineId(line : LineType) : string {
    return sprintf("%s-%s-%s", line.sessionid, line.windowid, line.lineid);
}

type RemoteType = {
    remotetype : string,
    remoteid : string,
    remotename : string,
    remotevars : Record<string, string>,
    status : string,
    defaultstate : RemoteStateType,
};

type RemoteStateType = {
    cwd : string,
};

type RemoteInstanceType = {
    riid : string,
    name : string,
    sessionid : string,
    windowid : string,
    remoteid : string,
    sessionscope : boolean,
    state : RemoteStateType,
}

type WindowType = {
    sessionid : string,
    windowid : string,
    name : string,
    curremote : string,
    lines : mobx.IObservableArray<LineType>,
    linesLoading : mobx.IObservableValue<boolean>,
    version : number,
};

type WindowDataType = {
    sessionid : string,
    windowid : string,
    name : string,
    curremote : string,
    lines : LineType[],
    version : number,
};

type HistoryItem = {
    cmdtext : string,
};

type SessionDataType = {
    sessionid : string,
    name : string,
    windows : WindowDataType[],
    cmds : CmdDataType[],
};

type CmdRemoteStateType = {
    remoteid : string
    remotename : string,
    cwd : string,
};

type FeCmdPacketType = {
    type : string,
    sessionid : string,
    windowid : string,
    userid : string,
    cmdstr : string,
    remotestate : CmdRemoteStateType,
}

type TermOptsType = {
    rows : number,
    cols : number,
    flexrows : boolean,
};

type CmdStartPacketType = {
    type : string,
    respid : string,
    ts : number,
    ck : string,
    pid : number,
    mshellpid : number,
};

type CmdDonePacketType = {
    type : string,
    ts : number,
    ck : string,
    exitcode : number,
    durationms : number,
};

type CmdDataType = {
    sessionid : string,
    cmdid : string,
    remoteid : string,
    cmdstr : string,
    remotestate : RemoteStateType,
    termopts : TermOptsType,
    status : string,
    startpk : CmdStartPacketType,
    donepk : CmdDonePacketType,
    runout : any[],
};

class Session {
    sessionId : string;
    name : string;
    windows : WindowType[];
    activeWindowId : mobx.IObservableValue<string> = mobx.observable.box(null);
    termMap : Record<string, TermWrap> = {};
    termMapById : Record<string, TermWrap> = {};
    history : HistoryItem[] = [];
    loading : mobx.IObservableValue<boolean> = mobx.observable.box(true);
    remotes : RemoteInstanceType[] = [];
    globalRemotes : RemoteType[];
    cmds : CmdDataType[];

    constructor() {
    }

    getWindowCurRemoteData(windowid : string) : RemoteInstanceType {
        let win = this.getWindowById(windowid);
        if (win == null) {
            return null;
        }
        let rname = win.curremote;
        let sessionScope = false;
        if (rname.startsWith("^")) {
            rname = rname.substr(1);
            sessionScope = true;
        }
        for (let i=0; i<this.remotes.length; i++) {
            let rdata = this.remotes[i];
            if (sessionScope && rdata.sessionscope && rdata.name == rname) {
                return rdata;
            }
            if (!sessionScope && !rdata.sessionscope && rdata.name == rname && rdata.windowid == windowid) {
                return rdata;
            }
        }
        for (let i=0; i<this.globalRemotes.length; i++) {
            let gr = this.globalRemotes[i];
            if (gr.remotename == rname) {
                return {riid: "", sessionid: this.sessionId, windowid: windowid, remoteid: gr.remoteid,
                        name: rname, state: gr.defaultstate, sessionscope: sessionScope};
            }
        }
        return null;
    }

    getWindowById(windowid : string) : WindowType {
        for (let i=0; i<this.windows.length; i++) {
            if (this.windows[i].windowid == windowid) {
                return this.windows[i];
            }
        }
        return null;
    }

    getCurWindow() : WindowType {
        return this.getWindowById(this.activeWindowId.get());
    }

    setWindowInSession(win : WindowDataType) {
        mobx.action(() => {
            for (let i=0; i<this.windows.length; i++) {
                if (this.windows[i].windowid == win.windowid) {
                    let curWindow = this.windows[i];
                    curWindow.name = win.name
                    curWindow.curremote = win.curremote;
                    curWindow.lines.replace(win.lines || []);
                    curWindow.linesLoading.set(false);
                    curWindow.version = win.version;
                    return;
                }
            }
            this.windows.push(winDataToWindow(win));
        })();
    }

    loadWindowLines(windowid : string) {
        let window = this.getWindowById(windowid);
        if (window == null) {
            console.log(sprintf("cannot load lines on window=%s, window not found", windowid));
            return;
        }
        if (window.linesLoading.get()) {
            return;
        }
        window.linesLoading.set(true);
        
        let usp = new URLSearchParams({sessionid: this.sessionId, windowid: windowid});
        let url = new URL(sprintf("http://localhost:8080/api/get-window?") + usp.toString());
        fetch(url).then((resp) => handleJsonFetchResponse(url, resp)).then((data) => {
            if (data.data == null) {
                console.log("null window returned from get-window");
                return;
            }
            this.setWindowInSession(data.data);
            return;
        }).catch((err) => {
            console.log(sprintf("error getting window=%s lines", windowid), err)
        });
    }

    getCmd(cmdId : string) : CmdDataType {
        if (!cmdId) {
            return null;
        }
        for (let i=0; i<this.cmds.length; i++) {
            if (this.cmds[i].cmdid == cmdId) {
                return this.cmds[i];
            }
        }
        return null;
    }

    getRemote(remoteId : string) : RemoteType {
        if (!remoteId) {
            return null;
        }
        for (let i=0; i<this.globalRemotes.length; i++) {
            if (this.globalRemotes[i].remoteid == remoteId) {
                return this.globalRemotes[i];
            }
        }
        return null;
    }

    setActiveWindow(windowid : string) {
        this.activeWindowId.set(windowid);
        this.loadWindowLines(windowid);
    }

    submitCommand(windowid : string, commandStr : string) {
        let url = sprintf("http://localhost:8080/api/run-command");
        let data : FeCmdPacketType = {type: "fecmd", sessionid: this.sessionId, windowid: windowid, cmdstr: commandStr, userid: GlobalUser, remotestate: null};
        let curWindow = this.getCurWindow();
        if (curWindow == null) {
            throw new Error(sprintf("invalid current window=%s", this.activeWindowId));
        }
        let rstate = this.getWindowCurRemoteData(this.activeWindowId.get());
        if (rstate == null) {
            throw new Error(sprintf("no remotestate found for windowid:%s (remote=%s), cannot submit command", windowid, curWindow.curremote));
        }
        data.remotestate = {remoteid: rstate.remoteid, remotename: rstate.name, ...rstate.state};
        fetch(url, {method: "post", body: JSON.stringify(data)}).then((resp) => handleJsonFetchResponse(url, resp)).then((data) => {
            mobx.action(() => {
                if (data.data != null && data.data.line != null) {
                    let line = data.data.line;
                    line.isnew = true;
                    this.addLine(line);
                }
                if (data.data != null && data.data.cmd != null) {
                    this.cmds.push(data.data.cmd);
                }
            })();
        }).catch((err) => {
            console.log("error calling run-command", err)
        });
    }

    addLine(line : LineType) {
        if (line.sessionid != this.sessionId) {
            return;
        }
        let window = this.getWindowById(line.windowid);
        if (window == null) {
            return;
        }
        mobx.action(() => {
            let lines = window.lines;
            let lineIdx = 0;
            for (lineIdx=0; lineIdx<lines.length; lineIdx++) {
                let lineId = lines[lineIdx].lineid;
                if (lineId == line.lineid) {
                    window.lines[lineIdx] = line;
                    return;
                }
                if (lineId > line.lineid) {
                    break;
                }
            }
            if (lineIdx == lines.length) {
                window.lines.push(line);
                return;
            }
            window.lines.splice(lineIdx, 0, line);
        })();
        return;
    }

    addToHistory(hitem : HistoryItem) {
        this.history.push(hitem);
    }

    getNumHistoryItems() : number {
        return this.history.length;
    }

    getHistoryItem(index : number) : HistoryItem {
        if (index == 0) {
            return null;
        }
        if (index > 0) {
            if (index > this.history.length-1) {
                return null;
            }
            return this.history[index];
        }
        let absIndex = Math.abs(index);
        if (absIndex > this.history.length) {
            return null;
        }
        return this.history[this.history.length-absIndex];
    }

    getTermWrapByLine(line : LineType) : TermWrap {
        if (!line.cmdid) {
            return null;
        }
        let termKey = makeTermKey(line.sessionid, line.cmdid, line.windowid, line.lineid);
        let termWrap = this.termMap[termKey];
        if (termWrap != null) {
            return termWrap;
        }
        let cmd = this.getCmd(line.cmdid);
        if (!cmd) {
            return null;
        }
        termWrap = new TermWrap(line.sessionid, line.cmdid, cmd.remoteid, cmd.status);
        this.termMap[termKey] = termWrap;
        this.termMapById[termWrap.termId] = termWrap;
        termWrap.initialized = true;
        termWrap.reloadTerminal(true, 0);
        return termWrap;
    }

    getTermById(termId : string) : TermWrap {
        return this.termMapById[termId];
    }

    recvCmdData(termWrap : TermWrap, pk : any) {
        console.log("cmddata", pk);
    }

    getActiveWindow() : WindowType {
        if (this.windows == null || this.windows.length == 0) {
            return null;
        }
        let awid = this.activeWindowId.get();
        for (let i=0; i<this.windows.length; i++) {
            if (this.windows[i].windowid == awid) {
                return this.windows[i];
            }
        }
        return null;
    }
}

var SessionList : mobx.IObservableArray<SessionType> = mobx.observable.array([]);
var CurrentSession : Session = new Session();
var CurrentSessionId : mobx.IObservableValue<string> = mobx.observable.box(null);

function initSession(sessionId : string, force : boolean) {
    if (CurrentSession.loading.get() && !force) {
        return;
    }
    let remotesLoaded = false;
    let sessionLoaded = false;
    CurrentSession.loading.set(true);
    fetch("http://localhost:8080/api/get-remotes").then((resp) => handleJsonFetchResponse(url, resp)).then((data) => {
        mobx.action(() => {
            CurrentSession.globalRemotes = data.data
            remotesLoaded = true;
            if (remotesLoaded && sessionLoaded) {
                CurrentSession.loading.set(false);
            }
        })();
    }).catch((err) => {
        console.log("error calling get-remotes", err)
    });
    
    let usp = new URLSearchParams({sessionid: sessionId});
    let url = new URL(sprintf("http://localhost:8080/api/get-session?") + usp.toString());
    fetch(url).then((resp) => handleJsonFetchResponse(url, resp)).then((data) => {
        mobx.action(() => {
            let sdata = data.data;
            CurrentSession.sessionId = sdata.sessionid;
            CurrentSession.name = sdata.name;
            CurrentSession.windows = [];
            for (let i=0; i<sdata.windows.length; i++) {
                CurrentSession.windows.push(winDataToWindow(sdata.windows[i]))
            }
            CurrentSession.remotes = sdata.remotes || [];
            CurrentSession.cmds = sdata.cmds || [];
            CurrentSession.setActiveWindow(sdata.windows[0].windowid);
            sessionLoaded = true;
            if (remotesLoaded && sessionLoaded) {
                CurrentSession.loading.set(false);
            }
        })();
    }).catch((err) => {
        console.log("error calling get-session", err)
    });
}

function winDataToWindow(win : WindowDataType) : WindowType {
    let w = {
        sessionid: win.sessionid,
        windowid: win.windowid,
        name: win.name,
        curremote: win.curremote,
        lines: mobx.observable.array(win.lines || []),
        linesLoading: mobx.observable.box(false),
        version: win.version,
    };
    return w;
}

function getCurrentSession() : Session {
    return CurrentSession;
}

function newSession() {
    
}

function loadSessionList(init : boolean) {
    let url = new URL("http://localhost:8080/api/get-all-sessions");
    fetch(url).then((resp) => handleJsonFetchResponse(url, resp)).then((data) => {
        mobx.action(() => {
            SessionList.replace(data.data || []);
            if (init) {
                for (let i=0; i<SessionList.length; i++) {
                    if (SessionList[i].name == "default") {
                        setCurrentSessionId(SessionList[i].sessionid);
                    }
                }
            }
        })();
        
    }).catch((err) => {
        console.log("error getting session list");
    });
}

function getAllSessions() : mobx.IObservableArray<SessionType> {
    return SessionList;
}

function setCurrentSessionId(sessionId : string) {
    if (CurrentSessionId.get() == sessionId) {
        return;
    }
    mobx.action(() => {
        CurrentSessionId.set(sessionId);
        initSession(sessionId, true);
    })();
}

function getCurrentSessionId() : string {
    return CurrentSessionId.get();
}

export {Session, getCurrentSession, getLineId, newSession, loadSessionList, getAllSessions, getCurrentSessionId};
export type {LineType, WindowType, CmdDataType, RemoteType, SessionType};
