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

type DataUpdate = {
    data : Uint8Array,
    pos : number,
}

type WindowSize = {
    height : number,
    width: number,
};

const DefaultCellWidth = 8;
const DefaultCellHeight = 16;

// cmd-instance
class TermWrap {
    terminal : any;
    sessionId : string;
    cmdId : string;
    atRowMax : boolean;
    usedRows : mobx.IObservableValue<number>;
    isFocused : mobx.IObservableValue<boolean> = mobx.observable.box(false, {name: "focus"});
    flexRows : boolean;
    connectedElem : Element;
    ptyPos : number = 0;
    reloading : boolean = false;
    dataUpdates : DataUpdate[] = [];
    loadError : mobx.IObservableValue<boolean> = mobx.observable.box(false);
    winSize : WindowSize;

    constructor(elem : Element, sessionId : string, cmdId : string, usedRows : number, termOpts : TermOptsType, winSize : WindowSize, keyHandler : (event : any) => void) {
        this.sessionId = sessionId;
        this.cmdId = cmdId;
        this.connectedElem = elem;
        this.flexRows = termOpts.flexrows ?? false;
        this.winSize = winSize;
        if (this.flexRows) {
            this.atRowMax = false;
            this.usedRows = mobx.observable.box(usedRows ?? 2);
        }
        else {
            this.atRowMax = true;
            this.usedRows = mobx.observable.box(termOpts.rows);
        }
        let cols = termOpts.cols;
        let maxCols = Math.trunc((winSize.width - 25) / DefaultCellWidth);
        if (maxCols > cols) {
            cols = maxCols;
        }
        this.terminal = new Terminal({rows: termOpts.rows, cols: maxCols, fontSize: 14, theme: {foreground: "#d3d7cf"}});
        this.terminal.open(elem);
        if (keyHandler != null) {
            this.terminal.onKey(keyHandler);
        }
        this.terminal.textarea.addEventListener("focus", () => {
            this.setFocus(true);
        });
        this.terminal.textarea.addEventListener("blur", () => {
            this.setFocus(false);
        });
        this.reloadTerminal(0);
    }

    getFontHeight() : number {
        return this.terminal._core.viewport._currentRowHeight;
    }

    dispose() {
        if (this.terminal != null) {
            this.terminal.dispose();
            this.terminal = null;
        }
    }

    disconnectElem() {
        this.connectedElem = null;
    }

    setFocus(focus : boolean) {
        mobx.action(() => {
            this.isFocused.set(focus);
        })();
    }

    getTermUsedRows() : number {
        let term = this.terminal;
        if (term == null) {
            return 0;
        }
        let termBuf = term._core.buffer;
        let termNumLines = termBuf.lines.length;
        let termYPos = termBuf.y;
        if (termNumLines > term.rows) {
            return term.rows;
        }
        let usedRows = 2;
        if (termYPos >= usedRows) {
            usedRows = termYPos + 1;
        }
        for (let i=term.rows-1; i>=usedRows; i--) {
            let line = termBuf.translateBufferLineToString(i, true);
            if (line != null && line.trim() != "") {
                usedRows = i+1;
                break;
            }
        }
        return usedRows;
    }

    updateUsedRows() {
        if (this.terminal == null) {
            return;
        }
        if (this.atRowMax) {
            return;
        }
        let tur = this.getTermUsedRows();
        if (tur >= this.terminal.rows) {
            this.atRowMax = true;
        }
        if (tur <= this.usedRows.get()) {
            return;
        }
        mobx.action(() => {
            let oldUsedRows = this.usedRows.get();
            this.usedRows.set(tur);
            GlobalModel.setTUR(this.sessionId, this.cmdId, this.winSize.width, tur);
            if (this.connectedElem) {
                let resizeEvent = new CustomEvent("termresize", {
                    bubbles: true,
                    detail: {
                        cmdId: this.cmdId,
                        oldUsedRows: oldUsedRows,
                        newUsedRows: tur,
                    },
                });
                // console.log("resize-event", resizeEvent);
                this.connectedElem.dispatchEvent(resizeEvent);
            }
        })();
    }

    reloadTerminal(delayMs : number) {
        if (this.terminal == null) {
            return;
        }
        this.reloading = true;
        this.terminal.clear();
        let url = sprintf("http://localhost:8080/api/ptyout?sessionid=%s&cmdid=%s", this.sessionId, this.cmdId);
        fetch(url).then((resp) => {
            if (!resp.ok) {
                mobx.action(() => { this.loadError.set(true); })();
                this.dataUpdates = [];
                throw new Error(sprintf("Bad fetch response for /api/ptyout: %d %s", resp.status, resp.statusText));
            }
            return resp.arrayBuffer()
        }).then((buf) => {
            setTimeout(() => {
                this.reloading = false;
                this.ptyPos = 0;
                this.updatePtyData(0, new Uint8Array(buf));
                for (let i=0; i<this.dataUpdates.length; i++) {
                    this.updatePtyData(this.dataUpdates[i].pos, this.dataUpdates[i].data);
                }
                this.dataUpdates = [];
            }, delayMs);
        });
    }

    updatePtyData(pos : number, data : Uint8Array) {
        if (this.loadError.get()) {
            return;
        }
        if (this.reloading) {
            this.dataUpdates.push({data: data, pos: pos});
            return;
        }
        console.log("pty-update", this.cmdId, this.ptyPos, data.length);
        if (pos > this.ptyPos) {
            throw new Error(sprintf("invalid pty-update, data-pos[%d] does not match term-pos[%d] cmdid[%s]", pos, this.ptyPos, this.cmdId));
        }
        if (pos < this.ptyPos) {
            let diff = this.ptyPos - pos;
            if (diff >= data.length) {
                // already contains all the data
                return;
            }
            data = data.slice(diff);
            pos += diff;
        }
        this.ptyPos += data.length;
        this.terminal.write(data, () => {
            this.updateUsedRows();
        });
    }
}

export {TermWrap};
