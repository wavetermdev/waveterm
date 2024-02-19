// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as mobx from "mobx";
import { Terminal } from "xterm";
//TODO: replace with `@xterm/addon-web-links` when it's available as stable
import { WebLinksAddon } from "xterm-addon-web-links";
import { sprintf } from "sprintf-js";
import { boundMethod } from "autobind-decorator";
import { windowWidthToCols, windowHeightToRows } from "@/util/textmeasure";
import { boundInt } from "@/util/util";
import { GlobalModel } from "@/models";
import { getTheme } from "@/common/themes/themes";

type DataUpdate = {
    data: Uint8Array;
    pos: number;
};

const MinTermCols = 10;
const MaxTermCols = 1024;

type TermWrapOpts = {
    termContext: TermContextUnion;
    usedRows?: number;
    termOpts: TermOptsType;
    winSize: WindowSize;
    keyHandler?: (event: any, termWrap: TermWrap) => void;
    focusHandler?: (focus: boolean) => void;
    dataHandler?: (data: string, termWrap: TermWrap) => void;
    isRunning: boolean;
    customKeyHandler?: (event: any, termWrap: TermWrap) => boolean;
    fontSize: number;
    fontFamily: string;
    ptyDataSource: (termContext: TermContextUnion) => Promise<PtyDataType>;
    onUpdateContentHeight: (termContext: RendererContext, height: number) => void;
};

// cmd-instance
class TermWrap {
    terminal: any;
    termContext: TermContextUnion;
    atRowMax: boolean;
    usedRows: mobx.IObservableValue<number>;
    flexRows: boolean;
    connectedElem: Element;
    ptyPos: number = 0;
    reloading: boolean = false;
    dataUpdates: DataUpdate[] = [];
    loadError: mobx.IObservableValue<boolean> = mobx.observable.box(false, { name: "term-loaderror" });
    winSize: WindowSize;
    numParseErrors: number = 0;
    termSize: TermWinSize;
    focusHandler: (focus: boolean) => void;
    isRunning: boolean;
    fontSize: number;
    fontFamily: string;
    onUpdateContentHeight: (termContext: RendererContext, height: number) => void;
    ptyDataSource: (termContext: TermContextUnion) => Promise<PtyDataType>;
    initializing: boolean;
    dataHandler?: (data: string, termWrap: TermWrap) => void;

    constructor(elem: Element, opts: TermWrapOpts) {
        opts = opts ?? ({} as any);
        this.termContext = opts.termContext;
        this.connectedElem = elem;
        this.flexRows = opts.termOpts.flexrows ?? false;
        this.winSize = opts.winSize;
        this.focusHandler = opts.focusHandler;
        this.isRunning = opts.isRunning;
        this.fontSize = opts.fontSize;
        this.fontFamily = opts.fontFamily;
        this.ptyDataSource = opts.ptyDataSource;
        this.onUpdateContentHeight = opts.onUpdateContentHeight;
        this.initializing = true;
        if (this.flexRows) {
            this.atRowMax = false;
            this.usedRows = mobx.observable.box(opts.usedRows ?? (opts.isRunning ? 1 : 0), { name: "term-usedrows" });
        } else {
            this.atRowMax = true;
            this.usedRows = mobx.observable.box(opts.termOpts.rows, { name: "term-usedrows" });
        }
        if (opts.winSize == null) {
            this.termSize = { rows: opts.termOpts.rows, cols: opts.termOpts.cols };
        } else {
            let cols = windowWidthToCols(opts.winSize.width, opts.fontSize);
            this.termSize = { rows: opts.termOpts.rows, cols: cols };
        }
        const { terminal } = getTheme();
        this.terminal = new Terminal({
            rows: this.termSize.rows,
            cols: this.termSize.cols,
            fontSize: opts.fontSize,
            fontFamily: opts.fontFamily,
            theme: { foreground: terminal.foreground, background: terminal.background },
        });
        this.terminal.loadAddon(
            new WebLinksAddon((e, uri) => {
                e.preventDefault();
                switch (GlobalModel.platform) {
                    case "darwin":
                        if (e.metaKey) {
                            GlobalModel.openExternalLink(uri);
                        }
                        break;
                    default:
                        if (e.ctrlKey) {
                            GlobalModel.openExternalLink(uri);
                        }
                        break;
                }
            })
        );
        this.terminal._core._inputHandler._parser.setErrorHandler((state) => {
            this.numParseErrors++;
            return state;
        });
        this.terminal.open(elem);
        if (opts.keyHandler != null) {
            this.terminal.onKey((e) => opts.keyHandler(e, this));
        }
        if (opts.dataHandler != null) {
            this.dataHandler = opts.dataHandler;
            this.terminal.onData((e) => opts.dataHandler(e, this));
        }
        this.terminal.textarea.addEventListener("focus", () => {
            if (this.focusHandler != null) {
                this.focusHandler(true);
            }
        });
        this.terminal.textarea.addEventListener("blur", (e: any) => {
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
        setTimeout(() => this.reload(0), 10);
    }

    getUsedRows(): number {
        return this.usedRows.get();
    }

    @boundMethod
    elemScrollHandler(e: any) {
        // this stops a weird behavior in the terminal
        // xterm.js renders a textarea that handles focus.  when it focuses and a space is typed the browser
        //   will scroll to make it visible (even though our terminal element has overflow hidden)
        // this will undo that scroll.
        if (this.atRowMax || e.target.scrollTop == 0) {
            return;
        }
        e.target.scrollTop = 0;
    }

    getContextRemoteId(): string {
        if ("remoteId" in this.termContext) {
            return this.termContext.remoteId;
        }
        return null;
    }

    getRendererContext(): RendererContext {
        if ("remoteId" in this.termContext) {
            return null;
        }
        return this.termContext;
    }

    getFontHeight(): number {
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
        setTimeout(() => this.terminal._core.viewport.syncScrollArea(true), 0);
    }

    disconnectElem() {
        this.connectedElem = null;
    }

    getTermUsedRows(): number {
        let term = this.terminal;
        if (term == null) {
            return 0;
        }
        let termBuf = term._core.buffer;
        let termNumLines = termBuf.lines.length;
        let termYPos = termBuf.y;
        if (termNumLines > term.rows) {
            // TODO: there is a weird case here.  for commands that output more than term.rows rows of output
            //   they get an "extra" blank line at the bottom because the cursor is positioned on the next line!
            //   hard problem to solve because the line is already written to the buffer.  we only want to "fix"
            //   this when the command is no longer running.
            return term.rows;
        }
        let usedRows = this.isRunning ? 1 : 0;
        if (this.isRunning && termYPos >= usedRows) {
            usedRows = termYPos + 1;
        }
        for (let i = term.rows - 1; i >= usedRows; i--) {
            let line = termBuf.translateBufferLineToString(i, true);
            if (line != null && line.trim() != "") {
                usedRows = i + 1;
                break;
            }
        }
        return usedRows;
    }

    updateUsedRows(forceFull: boolean, reason: string) {
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
            if (this.onUpdateContentHeight != null) {
                this.onUpdateContentHeight(termContext, tur);
            }
        })();
    }

    resizeCols(cols: number): void {
        this.resize({ rows: this.termSize.rows, cols: cols });
    }

    resize(size: TermWinSize): void {
        if (this.terminal == null) {
            return;
        }
        let newSize = { rows: size.rows, cols: size.cols };
        newSize.cols = boundInt(newSize.cols, MinTermCols, MaxTermCols);
        if (newSize.rows == this.termSize.rows && newSize.cols == this.termSize.cols) {
            return;
        }
        this.termSize = newSize;
        this.terminal.resize(newSize.cols, newSize.rows);
        this.updateUsedRows(true, "resize");
    }

    resizeWindow(size: WindowSize): void {
        let cols = windowWidthToCols(size.width, this.fontSize);
        let rows = windowHeightToRows(size.height, this.fontSize);
        this.resize({ rows, cols });
    }

    _reloadThenHandler(ptydata: PtyDataType) {
        this.reloading = false;
        this.ptyPos = ptydata.pos;
        this.receiveData(ptydata.pos, ptydata.data, "reload-main");
        for (let i = 0; i < this.dataUpdates.length; i++) {
            this.receiveData(this.dataUpdates[i].pos, this.dataUpdates[i].data, "reload-update-" + i);
        }
        this.dataUpdates = [];
        if (this.terminal != null) {
            this.terminal.write(new Uint8Array(), () => {
                this.updateUsedRows(true, "reload");
            });
        }
    }

    getLineNum(): number {
        let context = this.getRendererContext();
        if (context == null) {
            return 0;
        }
        return context.lineNum;
    }

    hardResetTerminal(): void {
        if (this.terminal == null) {
            return;
        }
        this.terminal.reset();
        this.ptyPos = 0;
        this.updateUsedRows(true, "term-reset");
        this.dataUpdates = [];
        this.numParseErrors = 0;
    }

    reload(delayMs: number) {
        if (this.terminal == null) {
            return;
        }
        // console.log("reload-term", this.getLineNum());
        if (!this.initializing) {
            this.hardResetTerminal();
        }
        this.reloading = true;
        this.initializing = false;
        let rtnp = this.ptyDataSource(this.termContext);
        if (rtnp == null) {
            console.log("no promise returned from ptyDataSource (termwrap)", this.termContext);
            return;
        }
        rtnp.then((ptydata) => {
            setTimeout(() => {
                this._reloadThenHandler(ptydata);
            }, delayMs);
        }).catch((e) => {
            mobx.action(() => {
                this.loadError.set(true);
            })();
            this.dataUpdates = [];
            this.reloading = false;
            console.log("error reloading terminal", this.termContext, e);
        });
    }

    receiveData(pos: number, data: Uint8Array, reason?: string) {
        // console.log("update-pty-data", reason, "line:" + this.getLineNum(), pos, data.length, "=>", pos + data.length);
        if (this.initializing) {
            return;
        }
        if (this.terminal == null) {
            return;
        }
        if (this.loadError.get()) {
            return;
        }
        if (this.reloading) {
            this.dataUpdates.push({ data: data, pos: pos });
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

    cmdDone(): void {
        this.isRunning = false;
        this.updateUsedRows(true, "cmd-done");
    }
}

export { TermWrap };
