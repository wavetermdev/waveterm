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
    {sessionid: GSessionId, windowid: GWindowId, lineid: 1, userid: "sawka", ts: 1654631122000, linetype: "text", text: "hello"},
    {sessionid: GSessionId, windowid: GWindowId, lineid: 2, userid: "sawka", ts: 1654631125000, linetype: "text", text: "again"},
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

type WindowType = {
    sessionid : string;
    windowid : string;
    name : string;
    lines : LineType[];
};

class Session {
    sessionId : string;
    name : string;
    windows : WindowType[];
    activeWindowId : string;
    termMap : Record<string, TermWrap> = {};
    termMapById : Record<string, TermWrap> = {};

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

    getTermWrapByLine(line : LineType) : TermWrap {
        let termKey = makeTermKey(line.sessionid, line.cmdid, line.windowid, line.lineid);
        let termWrap = this.termMap[termKey];
        if (termWrap != null) {
            return termWrap;
        }
        termWrap = new TermWrap(line.sessionid, line.cmdid);
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

function getDefaultSession() : Session {
    let windowLines = GlobalLines.get();
    let session = new Session();
    session.sessionId = GSessionId;
    session.name = "default";
    session.activeWindowId = GWindowId;
    session.windows = [
        {sessionid: GSessionId, windowid: GWindowId, name: "default", lines: windowLines},
    ];
    return session;
}

window.getDefaultSession = getDefaultSession;

export {Session, getDefaultSession};
export type {LineType, WindowType};
