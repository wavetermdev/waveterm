import * as mobx from "mobx";
import {Terminal} from 'xterm';
import {sprintf} from "sprintf-js";
import {boundMethod} from "autobind-decorator";
import {GlobalWS} from "./ws";

// 
var TermMap : Record<string, TermWrap>;

function getOrCreateTermWrap(sessionId : string, cmdId : string, windowId : string, lineid : number) : TermWrap {
    let termKey = makeTermKey(sessionId, cmdId, windowId, lineid);
    let termWrap = TermMap[termKey];
    if (termWrap != null) {
        return termWrap;
    }
    termWrap = new TermWrap(sessionId, cmdId, windowId, lineid);
    return termWrap;
}

function makeTermKey(sessionId : string, cmdId : string, windowId : string, lineid : number) : string {
    return sprintf("%s/%s/%s/%s", sessionId, cmdId, windowId, lineid);
}

function loadPtyOut(term : Terminal, sessionId : string, cmdId : string, delayMs : number, callback?: (number) => void) {
    term.clear()
    let url = sprintf("http://localhost:8080/api/ptyout?sessionid=%s&cmdid=%s", sessionId, cmdId);
    fetch(url).then((resp) => {
        if (!resp.ok) {
            throw new Error(sprintf("Bad fetch response for /api/ptyout: %d %s", resp.status, resp.statusText));
        }
        return resp.text()
    }).then((resptext) => {
        setTimeout(() => term.write(resptext, () => { callback(resptext.length) }), delayMs);
    });
}

class TermWrap {
    terminal : Terminal;
    sessionId : string;
    cmdId : string;
    windowId : string;
    lineid : number;
    ptyPos : number = 0;
    runPos : number = 0;
    runData : string = "";
    renderVersion : mobx.IObservableValue<number> = mobx.observable.box(1, {name: "renderVersion"});
    isFocused : mobx.IObservableValue<boolean> = mobx.observable.box(false, {name: "focus"});
    flexRows : boolean = true;
    maxRows : number = 25;
    cols : number = 80;
    atRowMax : boolean = false;
    initialized : boolean = false;

    constructor(sessionId : string, cmdId : string, windowId : string, lineid : number) {
        this.sessionId = sessionId;
        this.cmdId = cmdId;
        this.windowId = windowId;
        this.lineid = lineid;
        this.terminal = new Terminal({rows: 2, cols: 80});
        TermMap[cmdId] = this;
    }

    destroy() {
        
    }

    // datalen is passed because data could be utf-8 and data.length is not the actual *byte* length
    updatePtyData(pos : number, data : string, datalen : number) {
        if (pos != this.ptyPos) {
            throw new Error(sprintf("invalid pty-update, data-pos[%d] does not match term-pos[%d]", pos, this.ptyPos));
        }
        this.ptyPos += datalen;
        term.write(data, () => {
            mobx.action(() => {
                this.resizeToContent();
                this.incRenderVersion();
            })();
        });
    }

    resizeToContent() {
        if (this.atRowMax) {
            return;
        }
        let term = this.terminal;
        let termNumLines = term._core.buffer.lines.length;
        let termYPos = term._core.buffer.y;
        let newRows : number = term.rows;
        if (term.rows < this.maxRows && termNumLines > term.rows) {
            newRows = Math.min(this.maxRows, termNumLines);
        } else if (term.rows < this.maxRows && termYPos >= term.rows) {
            newRows = Math.min(this.maxRows, termYPos+1);
        }
        if (newRows == this.maxRows) {
            this.atRowMax = true;
        }
        if (newRows == term.rows) {
            return;
        }
        term.resize(this.cols, newRows);
    }

    setSize(rows : number, cols : number, flexRows : boolean) {
        this.flexRows = true;
        this.maxRows = rows;
        this.cols = cols;
        if (!flexRows) {
            term.resize(rows, cols);
            setTimeout(() => incRenderVersion(), 10);
            return;
        }
        resizeToContent();
    }

    getSize() : {rows : number, cols : number} {
        return {rows: this.terminal.rows, cols: this.terminal.cols};
    }

    @boundMethod
    setFocus(val : boolean) {
        mobx.action(() => this.isFocused.set(val))();
    }

    getRenderVersion() : number {
        return this.renderVersion.get();
    }

    @boundMethod
    incRenderVersion() {
        mobx.action(() => this.renderVersion.set(this.renderVersion.get() + 1))();
    }

    reloadTerminal(delayMs : number) {
        loadPtyOut(this.terminal, this.sessionId, this.cmdId, delayMs, (ptyoutLen) => {
            mobx.action(() => {
                this.incRenderVersion();
                this.ptyPos = ptyoutLen;
            })();
        });
    }

    connectToElem(elem : Element) {
        this.terminal.open(elem);
        this.terminal.textarea.addEventListener("focus", () => {
            this.setFocus(true);
        });
        this.terminal.textarea.addEventListener("blur", () => {
            this.setFocus(false);
        });
    }
}

if (window.TermMap == null) {
    TermMap = {};
    window.TermMap = TermMap;
}

export {TermWrap, TermMap, makeTermKey, getOrCreateTermWrap};
