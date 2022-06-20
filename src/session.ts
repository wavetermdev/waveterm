import * as mobx from "mobx";
import {sprintf} from "sprintf-js";
import {boundMethod} from "autobind-decorator";
import {handleJsonFetchResponse} from "./util";
import {TermWrap} from "./term";
import {v4 as uuidv4} from "uuid";

var GlobalUser = "sawka";
var GSessionId = "47445c53-cfcf-4943-8339-2c04447f20a1";
var GWindowId = "1";

var GlobalLines = mobx.observable.box([
    {sessionid: GSessionId, windowid: GWindowId, lineid: 1, userid: "sawka", ts: 1424631125000, linetype: "text", text: "hello"},
    {sessionid: GSessionId, windowid: GWindowId, lineid: 2, userid: "sawka", ts: 1654631125000, linetype: "text", text: "again"},
    {sessionid: GSessionId, windowid: GWindowId, lineid: 3, userid: "sawka", ts: 1655403002683, linetype: "text", text: "more..."},
    {sessionid: GSessionId, windowid: GWindowId, lineid: 4, userid: "sawka", ts: 1655513202683, linetype: "cmd", cmdid: "e74a7db7-58f5-47ef-b351-364c7ba2bfbb", cmdtext: "ls"},
]);

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

type WindowType = {
    sessionid : string,
    windowid : string,
    name : string,
    lines : LineType[],
};

type HistoryItem = {
    cmdtext : string,
};

class Session {
    sessionId : string;
    name : string;
    windows : WindowType[];
    activeWindowId : string;
    termMap : Record<string, TermWrap> = {};
    termMapById : Record<string, TermWrap> = {};
    history : HistoryItem[] = [];

    constructor() {
    }

    submitCommand(windowid : string, commandStr : string) {
        let url = sprintf("http://localhost:8080/api/run-command");
        let data = {sessionid: this.sessionId, windowid: windowid, command: commandStr, userid: GlobalUser};
        fetch(url, {method: "post", body: JSON.stringify(data)}).then((resp) => handleJsonFetchResponse(url, resp)).then((data) => {
            mobx.action(() => {
                let lines = GlobalLines.get();
                data.data.line.isnew = true;
                lines.push(data.data.line);
            })();
        }).catch((err) => {
            console.log("error calling run-command", err)
        });
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

    getActiveWindow() : WindowType {
        if (this.windows == null) {
            return null;
        }
        for (let i=0; i<this.windows.length; i++) {
            if (this.windows[i].windowid == this.activeWindowId) {
                return this.windows[i];
            }
        }
        return null;
    }
}

var DefaultSession : Session = null;

function getDefaultSession() : Session {
    if (DefaultSession != null) {
        return DefaultSession;
    }
    let windowLines = GlobalLines.get();
    let session = new Session();
    session.sessionId = GSessionId;
    session.name = "default";
    session.activeWindowId = GWindowId;
    session.windows = [
        {sessionid: GSessionId, windowid: GWindowId, name: "default", lines: windowLines},
    ];
    DefaultSession = session;
    return session;
}

window.getDefaultSession = getDefaultSession;

export {Session, getDefaultSession, getLineId};
export type {LineType, WindowType};
