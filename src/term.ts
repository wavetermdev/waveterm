import * as mobx from "mobx";
import {Terminal} from 'xterm';
import {sprintf} from "sprintf-js";
import {boundMethod} from "autobind-decorator";
import {v4 as uuidv4} from "uuid";
import {GlobalModel, GlobalCommandRunner, termHeightFromRows, windowWidthToCols, windowHeightToRows} from "./model";
import {boundInt} from "./util";
import type {TermOptsType, TermWinSize, RendererContext, WindowSize} from "./types";

type DataUpdate = {
    data : Uint8Array,
    pos : number,
}

const MinTermCols = 10;
const MaxTermCols = 1024;

type RemoteTermContext = {remoteId : string};

type TermContext = RendererContext | RemoteTermContext;

type TermWrapOpts = {
    termContext : TermContext,
    usedRows? : number,
    termOpts : TermOptsType,
    winSize : WindowSize,
    keyHandler? : (event : any, termWrap : TermWrap) => void,
    focusHandler? : (focus : boolean) => void,
    dataHandler? : (data : string, termWrap : TermWrap) => void,
    isRunning : boolean,
    customKeyHandler? : (event : any, termWrap : TermWrap) => boolean,
};

// cmd-instance
class TermWrap {
    terminal : any;
    termContext : TermContext;
    atRowMax : boolean;
    usedRows : mobx.IObservableValue<number>;
    flexRows : boolean;
    connectedElem : Element;
    ptyPos : number = 0;
    reloading : boolean = false;
    dataUpdates : DataUpdate[] = [];
    loadError : mobx.IObservableValue<boolean> = mobx.observable.box(false, {name: "term-loaderror"});
    winSize : WindowSize;
    numParseErrors : number = 0;
    termSize : TermWinSize;
    focusHandler : (focus : boolean) => void;
    isRunning : boolean;

    constructor(elem : Element, opts : TermWrapOpts) {
        opts = opts ?? ({} as any);
        this.termContext = opts.termContext;
        this.connectedElem = elem;
        this.flexRows = opts.termOpts.flexrows ?? false;
        this.winSize = opts.winSize;
        this.focusHandler = opts.focusHandler;
        this.isRunning = opts.isRunning;
        if (this.flexRows) {
            this.atRowMax = false;
            this.usedRows = mobx.observable.box(opts.usedRows ?? (opts.isRunning ? 1 : 0), {name: "term-usedrows"});
        }
        else {
            this.atRowMax = true;
            this.usedRows = mobx.observable.box(opts.termOpts.rows, {name: "term-usedrows"});
        }
        if (opts.winSize == null) {
            this.termSize = {rows: opts.termOpts.rows, cols: opts.termOpts.cols};
        }
        else {
            let cols = windowWidthToCols(opts.winSize.width);
            this.termSize = {rows: opts.termOpts.rows, cols: cols};
        }
        let theme = {
            foreground: "#d3d7cf",
        };
        this.terminal = new Terminal({rows: this.termSize.rows, cols: this.termSize.cols, fontSize: 12, fontFamily: "JetBrains Mono", theme: theme});
        this.terminal._core._inputHandler._parser.setErrorHandler((state) => {
            this.numParseErrors++;
            return state;
        });
        this.terminal.open(elem);
        if (opts.keyHandler != null) {
            this.terminal.onKey((e) => opts.keyHandler(e, this));
        }
        if (opts.dataHandler != null) {
            this.terminal.onData((e) => opts.dataHandler(e, this));
        }
        this.terminal.textarea.addEventListener("focus", () => {
            if (this.focusHandler != null) {
                this.focusHandler(true);
            }
        });
        this.terminal.textarea.addEventListener("blur", (e : any) => {
            if (document.activeElement == this.terminal.textarea) {
                return;
            }
            if (this.focusHandler != null) {
                this.focusHandler(false);
            }
        });
        elem.addEventListener("scroll", this.elemScrollHandler);
        if (opts.customKeyHandler != null) {
            this.terminal.attachCustomKeyEventHandler((e) => opts.customKeyHandler(e, this));
        }
        this.reload(0);
    }

    getUsedRows() : number {
        return this.usedRows.get();
    }

    @boundMethod
    elemScrollHandler(e : any) {
        // this stops a weird behavior in the terminal
        // xterm.js renders a textarea that handles focus.  when it focuses and a space is typed the browser
        //   will scroll to make it visible (even though our terminal element has overflow hidden)
        // this will undo that scroll.
        console.log("scroll", this.atRowMax, e.target.scrollTop);
        if (this.atRowMax || e.target.scrollTop == 0) {
            return;
        }
        e.target.scrollTop = 0;
    }

    getContextRemoteId() : string {
        if ("remoteId" in this.termContext) {
            return this.termContext.remoteId;
        }
        return null;
    }

    getRendererContext() : RendererContext {
        if ("remoteId" in this.termContext) {
            return null;
        }
        return this.termContext;
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

    giveFocus() {
        if (this.terminal == null) {
            return;
        }
        this.terminal.focus();
        setTimeout(() => this.terminal._core.viewport.syncScrollArea(true), 0)
    }

    disconnectElem() {
        this.connectedElem = null;
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
        let usedRows = (this.isRunning ? 1 : 0);
        if (this.isRunning && termYPos >= usedRows) {
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

    updateUsedRows(forceFull : boolean, reason : string) {
        if (this.terminal == null) {
            return;
        }
        if (!this.flexRows) {
            return;
        }
        let termContext = this.getRendererContext();
        if ("remoteId" in termContext) {
            return;
        }
        if (forceFull) {
            this.atRowMax = false;
        }
        if (this.atRowMax) {
            return;
        }
        let tur = this.getTermUsedRows();
        if (tur >= this.terminal.rows) {
            this.atRowMax = true;
        }
        mobx.action(() => {
            let oldUsedRows = this.usedRows.get();
            if (!forceFull && tur <= oldUsedRows) {
                return;
            }
            if (tur == oldUsedRows) {
                return;
            }
            this.usedRows.set(tur);
            GlobalModel.setTUR(termContext, this.termSize, tur);
        })();
    }

    resizeCols(cols : number) : void {
        this.resize({rows: this.termSize.rows, cols: cols});
    }

    resize(size : TermWinSize) : void {
        if (this.terminal == null) {
            return;
        }
        let newSize = {rows: size.rows, cols: size.cols};
        newSize.cols = boundInt(newSize.cols, MinTermCols, MaxTermCols);
        if (newSize.rows == this.termSize.rows && newSize.cols == this.termSize.cols) {
            return;
        }
        this.termSize = newSize;
        this.terminal.resize(newSize.cols, newSize.rows);
        this.updateUsedRows(true, "resize");
    }

    resizeWindow(size : WindowSize) : void {
        let cols = windowWidthToCols(size.width);
        let rows = windowHeightToRows(size.height);
        this.resize({rows, cols});
    }

    _getReloadUrl() : string {
        if (this.getContextRemoteId() != null) {
            return sprintf(GlobalModel.getBaseHostPort() + "/api/remote-pty?remoteid=%s", this.getContextRemoteId());
        }
        let termContext = this.getRendererContext();
        return sprintf(GlobalModel.getBaseHostPort() + "/api/ptyout?sessionid=%s&cmdid=%s", termContext.sessionId, termContext.cmdId);
    }

    reload(delayMs : number) {
        if (this.terminal == null) {
            return;
        }
        this.reloading = true;
        this.terminal.reset();
        let url = this._getReloadUrl();
        let ptyOffset = 0;
        let fetchHeaders = GlobalModel.getFetchHeaders();
        fetch(url, {headers: fetchHeaders}).then((resp) => {
            if (!resp.ok) {
                mobx.action(() => { this.loadError.set(true); })();
                this.dataUpdates = [];
                throw new Error(sprintf("Bad fetch response for /api/ptyout: %d %s", resp.status, resp.statusText));
            }
            let ptyOffsetStr = resp.headers.get("X-PtyDataOffset");
            if (ptyOffsetStr != null && !isNaN(parseInt(ptyOffsetStr))) {
                ptyOffset = parseInt(ptyOffsetStr);
            }
            return resp.arrayBuffer();
        }).then((buf) => {
            setTimeout(() => {
                this.reloading = false;
                this.ptyPos = ptyOffset;
                this.receiveData(ptyOffset, new Uint8Array(buf), "reload-main");
                for (let i=0; i<this.dataUpdates.length; i++) {
                    this.receiveData(this.dataUpdates[i].pos, this.dataUpdates[i].data, "reload-update-" + i);
                }
                this.dataUpdates = [];
                this.terminal.write(new Uint8Array(), () => {
                    this.updateUsedRows(true, "reload");
                });
            }, delayMs);
        }).catch((e) => {
            console.log("error reloading terminal", e);
        });
    }

    receiveData(pos : number, data : Uint8Array, reason? : string) {
        // console.log("update-pty-data", pos, data.length, reason);
        if (this.terminal == null) {
            return;
        }
        if (this.loadError.get()) {
            return;
        }
        if (this.reloading) {
            this.dataUpdates.push({data: data, pos: pos});
            return;
        }
        if (pos > this.ptyPos) {
            console.log(sprintf("pty-jump term[%s] %d => %d", JSON.stringify(this.termContext), this.ptyPos, pos));
            this.ptyPos = pos;
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
            this.updateUsedRows(false, "updatePtyData");
        });
    }

    cmdDone() : void {
        this.isRunning = false;
        this.updateUsedRows(true, "cmd-done");
    }
}

export {TermWrap};
