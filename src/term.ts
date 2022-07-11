import * as mobx from "mobx";
import {Terminal} from 'xterm';
import {sprintf} from "sprintf-js";
import {boundMethod} from "autobind-decorator";
import {v4 as uuidv4} from "uuid";
import {GlobalModel} from "./model";

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
    terminal : any;
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
    usedRows : number;
    tailReqId : string;
    cmdStatus : string;
    remoteId : string;

    constructor(sessionId : string, cmdId : string, remoteId : string, status : string) {
        this.termId = uuidv4();
        this.sessionId = sessionId;
        this.cmdId = cmdId;
        this.remoteId = remoteId;
        this.cmdStatus = status;
        this.terminal = new Terminal({rows: 25, cols: 80, theme: {foreground: "#d3d7cf"}});
        this.usedRows = 2;
    }

    destroy() {
    }

    isRunning() : boolean {
        return this.cmdStatus == "running" || this.cmdStatus == "detached";
    }

    @boundMethod
    onKeyHandler(event : any) {
        console.log("onkey", event);
        if (!this.isRunning()) {
            return;
        }
        let inputPacket = {
            type: "input",
            ck: this.sessionId + "/" + this.cmdId,
            inputdata: btoa(event.key),
            remoteid: this.remoteId,
        };
        GlobalModel.sendInputPacket(inputPacket);
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
        if (this.usedRows != usedRows) {
            this.usedRows = usedRows;
            if (this.changeSizeCallback != null) {
                let cb = this.changeSizeCallback;
                setTimeout(() => cb(this), 0);
            }
        }
        return;
    }

    setSize(rows : number, cols : number, flexRows : boolean) {
        this.flexRows = true;
        this.maxRows = rows;
        if (!flexRows) {
            this.terminal.resize(rows, cols);
            setTimeout(() => this.incRenderVersion(), 10);
            return;
        }
        this.resizeToContent();
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

    connectToElem(elem : Element) {
        this.terminal.open(elem);
        if (this.isRunning()) {
            this.terminal.textarea.addEventListener("focus", () => {
                this.setFocus(true);
            });
            this.terminal.textarea.addEventListener("blur", () => {
                this.setFocus(false);
            });
            this.terminal.onKey(this.onKeyHandler);
        }
        else {
            this.terminal.onKey(this.onKeyHandler);
        }
    }
}

export {TermWrap};
