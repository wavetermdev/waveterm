import * as mobx from "mobx";
import {Terminal} from 'xterm';
import {sprintf} from "sprintf-js";
import {boundMethod} from "autobind-decorator";
import {GlobalWS} from "./ws";
import {v4 as uuidv4} from "uuid";

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
    termId : string;
    sessionId : string;
    cmdId : string;
    ptyPos : number = 0;
    runPos : number = 0;
    runData : string = "";
    renderVersion : mobx.IObservableValue<number> = mobx.observable.box(1, {name: "renderVersion"});
    isFocused : mobx.IObservableValue<boolean> = mobx.observable.box(false, {name: "focus"});
    flexRows : boolean = true;
    maxRows : number = 25;
    atRowMax : boolean = false;
    initialized : boolean = false;
    changeSizeCallback : (TermWrap) => void = null;
    usedRows : number = null;

    constructor(sessionId : string, cmdId : string) {
        this.termId = uuidv4();
        this.sessionId = sessionId;
        this.cmdId = cmdId;
        this.terminal = new Terminal({rows: 25, cols: 80, theme: {foreground: "#d3d7cf"}});
        this.usedRows = mobx.observable.box(2, {name: "usedRows"});
    }

    destroy() {
        
    }

    @boundMethod
    onKeyHandler(event : any) {
        let inputPacket = {
            type: "input",
            sessionid: this.sessionId,
            cmdid: this.cmdId,
            inputdata: event.key,
        };
        GlobalWS.pushMessage(inputPacket);
    }

    startPtyTail() {
        let getCmdPacket = {
            type: "getcmd",
            reqid: this.termId,
            sessionid: this.sessionId,
            cmdid: this.cmdId,
            ptypos: this.ptyPos,
            tail: true,
        };
        GlobalWS.registerAndSendGetCmd(getCmdPacket, (dataPacket) => {
            this.updatePtyData(this.ptyPos, dataPacket.ptydata, dataPacket.ptydatalen);
        });
    }

    // datalen is passed because data could be utf-8 and data.length is not the actual *byte* length
    updatePtyData(pos : number, data : string, datalen : number) {
        if (pos != this.ptyPos) {
            throw new Error(sprintf("invalid pty-update, data-pos[%d] does not match term-pos[%d]", pos, this.ptyPos));
        }
        this.ptyPos += datalen;
        this.terminal.write(data, () => {
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
        let termBuf = term._core.buffer;
        let termNumLines = termBuf.lines.length;
        let termYPos = termBuf.y;
        let usedRows = 2;
        if (termNumLines > term.rows) {
            this.usedRows = term.rows;
            this.atRowMax = true;
            return;
        }
        if (termYPos >= usedRows) {
            usedRows = termYPos + 1;
        }
        for (let i=usedRows; i<term.rows; i++) {
            let line = termBuf.translateBufferLineToString(i, true);
            if (line != null && line.trim() != "") {
                usedRows = i+1;
            }
        }
        this.usedRows = usedRows;
        return;
    }

    setSize(rows : number, cols : number, flexRows : boolean) {
        this.flexRows = true;
        this.maxRows = rows;
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

    connectToElem(elem : Element) {
        this.terminal.open(elem);
        this.terminal.textarea.addEventListener("focus", () => {
            this.setFocus(true);
        });
        this.terminal.textarea.addEventListener("blur", () => {
            this.setFocus(false);
        });
        this.terminal.onKey(this.onKeyHandler);
    }
}

export {TermWrap};
