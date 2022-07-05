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

type LineType = {
    sessionid : string,
    windowid : string,
    lineid : number,
    ts : number,
    userid : string,
    linetype : string,
    text : string,
    cmdid : string,
    cmdtext : string,
    isnew : boolean,
};

function getLineId(line : LineType) : string {
    return sprintf("%s-%s-%s", line.sessionid, line.windowid, line.lineid);
}

type RemoteType = {
    remotetype : string,
    remoteid : string,
    remotename : string,
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

type WindowDataType = {
    sessionid : string,
    windowid : string,
    name : string,
    curremote : string,
    lines : mobx.IObservableArray<LineType>,
    linesLoading : mobx.IObservableValue<boolean>,
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

type CmdDataType = {
};

class Session {
    sessionId : string;
    name : string;
    windows : WindowDataType[];
    activeWindowId : mobx.IObservableValue<string> = mobx.observable.box(null);
    termMap : Record<string, TermWrap> = {};
    termMapById : Record<string, TermWrap> = {};
    history : HistoryItem[] = [];
    loading : mobx.IObservableValue<boolean> = mobx.observable.box(false);
    remotes : RemoteInstanceType[] = [];
    globalRemotes : RemoteType[];

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

    getWindowById(windowid : string) : WindowDataType {
        for (let i=0; i<this.windows.length; i++) {
            if (this.windows[i].windowid == windowid) {
                return this.windows[i];
            }
        }
        return null;
    }

    getCurWindow() : WindowDataType {
        return this.getWindowById(this.activeWindowId.get());
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
        let url = new URL(sprintf("http://localhost:8080/api/get-window-lines?") + usp.toString());
        fetch(url).then((resp) => handleJsonFetchResponse(url, resp)).then((data) => {
            mobx.action(() => {
                window.lines.replace(data.data || []);
                window.linesLoading.set(false);
            })();
            return;
        }).catch((err) => {
            console.log(sprintf("error getting window=%s lines", windowid), err)
        });
    }

    setActiveWindow(windowid : string) {
        this.activeWindowId.set(windowid);
        this.loadWindowLines(windowid);
    }

    submitCommand(windowid : string, commandStr : string) {
        let url = sprintf("http://localhost:8080/api/run-command");
        let data = {type: "fecmd", sessionid: this.sessionId, windowid: windowid, cmdstr: commandStr, userid: GlobalUser, remotestate: null};
        let curWindow = this.getCurWindow();
        if (curWindow == null) {
            throw new Error(sprintf("invalid current window=%s", this.activeWindowId));
        }
        let rstate = this.getWindowCurRemoteData(this.activeWindowId.get());
        if (rstate == null) {
            throw new Error(sprintf("no remotestate found for windowid:%s (remote=%s), cannot submit command", windowid, curWindow.curremote));
        }
        data.remotestate = rstate;
        fetch(url, {method: "post", body: JSON.stringify(data)}).then((resp) => handleJsonFetchResponse(url, resp)).then((data) => {
            mobx.action(() => {
                if (data.data != null && data.data.line != null) {
                    this.addLine(data.data.line);
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
        let termKey = makeTermKey(line.sessionid, line.cmdid, line.windowid, line.lineid);
        let termWrap = this.termMap[termKey];
        if (termWrap != null) {
            return termWrap;
        }
        termWrap = new TermWrap(line.sessionid, line.cmdid);
        console.log("create term", termWrap);
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

    getActiveWindow() : WindowDataType {
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

var DefaultSession : Session = new Session();

function initSession() {
    if (DefaultSession.loading.get()) {
        return;
    }
    let remotesLoaded = false;
    let sessionLoaded = false;
    DefaultSession.loading.set(true);
    fetch("http://localhost:8080/api/get-remotes").then((resp) => handleJsonFetchResponse(url, resp)).then((data) => {
        mobx.action(() => {
            DefaultSession.globalRemotes = data.data
            remotesLoaded = true;
            if (remotesLoaded && sessionLoaded) {
                DefaultSession.loading.set(false);
            }
        })();
    }).catch((err) => {
        console.log("error calling get-remotes", err)
    });
    
    let usp = new URLSearchParams({name: "default"});
    let url = new URL(sprintf("http://localhost:8080/api/get-session?") + usp.toString());
    fetch(url).then((resp) => handleJsonFetchResponse(url, resp)).then((data) => {
        mobx.action(() => {
            let sdata = data.data;
            DefaultSession.sessionId = sdata.sessionid;
            DefaultSession.name = sdata.name;
            DefaultSession.windows = sdata.windows || [];
            for (let i=0; i<DefaultSession.windows.length; i++) {
                DefaultSession.windows[i].lines = mobx.observable.array([]);
                DefaultSession.windows[i].linesLoading = mobx.observable.box(false);
            }
            DefaultSession.remotes = sdata.remotes || [];
            DefaultSession.setActiveWindow(sdata.windows[0].windowid);
            sessionLoaded = true;
            if (remotesLoaded && sessionLoaded) {
                DefaultSession.loading.set(false);
            }
        })();
    }).catch((err) => {
        console.log("error calling get-session", err)
    });
}

function getDefaultSession() : Session {
    return DefaultSession;
}

(window as any).getDefaultSession = getDefaultSession;

export {Session, getDefaultSession, getLineId, initSession};
export type {LineType, WindowDataType};
