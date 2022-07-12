import * as mobx from "mobx";
import {Terminal} from 'xterm';
import {sprintf} from "sprintf-js";
import {boundMethod} from "autobind-decorator";
import {v4 as uuidv4} from "uuid";
import {GlobalModel} from "./model";
import type {TermOptsType} from "./types";

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

type TermEventHandler = {
    setFocus : (focus : boolean) => void,
    handleKey : (event : any) => void,
};

class TermWrap {
    terminal : any;
    usedRows : number;
    flexRows : boolean;
    
    tailReqId : string;
    cmdStatus : string;
    remoteId : string;

    constructor(termOpts : TermOptsType) {
        this.terminal = new Terminal({rows: termOpts.rows, cols: termOpts.cols, theme: {foreground: "#d3d7cf"}});
        this.flexRows = termOpts.flexrows;
        this.usedRows = 2;
    }

    getTermUsedRows() : number {
        let term = this.terminal;
        let termBuf = term._core.buffer;
        let termNumLines = termBuf.lines.length;
        let termYPos = termBuf.y;
        if (termNumLines >= term.rows) {
            return term.rows;
        }
        let usedRows = 2;
        if (termYPos >= usedRows) {
            usedRows = termYPos + 1;
        }
        for (let i=usedRows; i<term.rows; i++) {
            let line = termBuf.translateBufferLineToString(i, true);
            if (line != null && line.trim() != "") {
                usedRows = i+1;
            }
        }
        return usedRows;
    }

    connectToElem(elem : Element, eventHandler : TermEventHandler) {
        this.terminal.open(elem);
        if (eventHandler != null) {
            this.terminal.textarea.addEventListener("focus", () => {
                eventHandler.setFocus(true);
            });
            this.terminal.textarea.addEventListener("blur", () => {
                eventHandler.setFocus(false);
            });
            this.terminal.onKey(eventHandler.handleKey);
        }
    }
}

export {TermWrap};
