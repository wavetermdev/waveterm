// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as mobx from "mobx";
import { sprintf } from "sprintf-js";
import { debounce } from "throttle-debounce";
import { base64ToArray, boundInt, isModKeyPress, isBlank } from "@/util/util";
import { TermWrap } from "@/plugins/terminal/term";
import { windowWidthToCols, windowHeightToRows, termWidthFromCols, termHeightFromRows } from "@/util/textmeasure";
import { getRendererContext } from "@/app/line/lineutil";
import { MagicLayout } from "@/app/magiclayout";
import * as appconst from "@/app/appconst";
import { checkKeyPressed, adaptFromReactOrNativeKeyEvent } from "@/util/keyutil";
import { Model } from "./model";
import { GlobalCommandRunner } from "./global";
import { Cmd } from "./cmd";
import { ScreenLines } from "./screenlines";
import { getTermPtyData } from "@/util/modelutil";

class Screen {
    globalModel: Model;
    sessionId: string;
    screenId: string;
    screenIdx: OV<number>;
    opts: OV<ScreenOptsType>;
    viewOpts: OV<ScreenViewOptsType>;
    name: OV<string>;
    archived: OV<boolean>;
    curRemote: OV<RemotePtrType>;
    nextLineNum: OV<number>;
    lastScreenSize: WindowSize;
    lastCols: number;
    lastRows: number;
    selectedLine: OV<number>;
    focusType: OV<FocusTypeStrs>;
    anchor: OV<{ anchorLine: number; anchorOffset: number }>;
    termLineNumFocus: OV<number>;
    setAnchor_debounced: (anchorLine: number, anchorOffset: number) => void;
    terminals: Record<string, TermWrap> = {}; // lineid => TermWrap
    renderers: Record<string, RendererModel> = {}; // lineid => RendererModel
    shareMode: OV<string>;
    webShareOpts: OV<WebShareOpts>;
    filterRunning: OV<boolean>;
    statusIndicator: OV<appconst.StatusIndicatorLevel>;
    numRunningCmds: OV<number>;

    constructor(sdata: ScreenDataType, globalModel: Model) {
        this.globalModel = globalModel;
        this.sessionId = sdata.sessionid;
        this.screenId = sdata.screenid;
        this.name = mobx.observable.box(sdata.name, { name: "screen-name" });
        this.nextLineNum = mobx.observable.box(sdata.nextlinenum, { name: "screen-nextlinenum" });
        this.screenIdx = mobx.observable.box(sdata.screenidx, {
            name: "screen-screenidx",
        });
        this.opts = mobx.observable.box(sdata.screenopts, { name: "screen-opts" });
        this.viewOpts = mobx.observable.box(sdata.screenviewopts, { name: "viewOpts" });
        this.archived = mobx.observable.box(!!sdata.archived, {
            name: "screen-archived",
        });
        this.focusType = mobx.observable.box(sdata.focustype, {
            name: "focusType",
        });
        this.selectedLine = mobx.observable.box(sdata.selectedline == 0 ? null : sdata.selectedline, {
            name: "selectedLine",
        });
        this.setAnchor_debounced = debounce(1000, this.setAnchor.bind(this));
        this.anchor = mobx.observable.box(
            { anchorLine: sdata.selectedline, anchorOffset: 0 },
            { name: "screen-anchor" }
        );
        this.termLineNumFocus = mobx.observable.box(0, {
            name: "termLineNumFocus",
        });
        this.curRemote = mobx.observable.box(sdata.curremote, {
            name: "screen-curRemote",
        });
        this.shareMode = mobx.observable.box(sdata.sharemode, {
            name: "screen-shareMode",
        });
        this.webShareOpts = mobx.observable.box(sdata.webshareopts, {
            name: "screen-webShareOpts",
        });
        this.filterRunning = mobx.observable.box(false, {
            name: "screen-filter-running",
        });
        this.statusIndicator = mobx.observable.box(appconst.StatusIndicatorLevel.None, {
            name: "screen-status-indicator",
        });
        this.numRunningCmds = mobx.observable.box(0, {
            name: "screen-num-running-cmds",
        });
    }

    dispose() {}

    isWebShared(): boolean {
        return this.shareMode.get() == "web" && this.webShareOpts.get() != null;
    }

    isSidebarOpen(): boolean {
        let viewOpts = this.viewOpts.get();
        if (viewOpts == null) {
            return false;
        }
        return viewOpts.sidebar?.open;
    }

    isLineIdInSidebar(lineId: string): boolean {
        let viewOpts = this.viewOpts.get();
        if (viewOpts == null) {
            return false;
        }
        if (!viewOpts.sidebar?.open) {
            return false;
        }
        return viewOpts?.sidebar?.sidebarlineid == lineId;
    }

    getContainerType(): LineContainerStrs {
        return appconst.LineContainer_Main;
    }

    getShareName(): string {
        if (!this.isWebShared()) {
            return null;
        }
        let opts = this.webShareOpts.get();
        if (opts == null) {
            return null;
        }
        return opts.sharename;
    }

    getWebShareUrl(): string {
        let viewKey: string = null;
        if (this.webShareOpts.get() != null) {
            viewKey = this.webShareOpts.get().viewkey;
        }
        if (viewKey == null) {
            return null;
        }
        if (this.globalModel.isDev) {
            return sprintf(
                "http://devtest.getprompt.com:9001/static/index-dev.html?screenid=%s&viewkey=%s",
                this.screenId,
                viewKey
            );
        }
        return sprintf("https://share.getprompt.dev/share/%s?viewkey=%s", this.screenId, viewKey);
    }

    mergeData(data: ScreenDataType) {
        if (data.sessionid != this.sessionId || data.screenid != this.screenId) {
            throw new Error("invalid screen update, ids don't match");
        }
        mobx.action(() => {
            this.screenIdx.set(data.screenidx);
            this.opts.set(data.screenopts);
            this.viewOpts.set(data.screenviewopts);
            this.name.set(data.name);
            this.nextLineNum.set(data.nextlinenum);
            this.archived.set(!!data.archived);
            let oldSelectedLine = this.selectedLine.get();
            let oldFocusType = this.focusType.get();
            this.selectedLine.set(data.selectedline);
            this.curRemote.set(data.curremote);
            this.focusType.set(data.focustype);
            this.refocusLine(data, oldFocusType, oldSelectedLine);
            this.shareMode.set(data.sharemode);
            this.webShareOpts.set(data.webshareopts);
            // do not update anchorLine/anchorOffset (only stored)
        })();
    }

    getContentHeight(context: RendererContext): number {
        return this.globalModel.getContentHeight(context);
    }

    setContentHeight(context: RendererContext, height: number): void {
        this.globalModel.setContentHeight(context, height);
    }

    getCmd(line: LineType): Cmd {
        return this.globalModel.getCmd(line);
    }

    getCmdById(lineId: string): Cmd {
        return this.globalModel.getCmdByScreenLine(this.screenId, lineId);
    }

    getAnchorStr(): string {
        let anchor = this.anchor.get();
        if (anchor.anchorLine == null || anchor.anchorLine == 0) {
            return "0";
        }
        return sprintf("%d:%d", anchor.anchorLine, anchor.anchorOffset);
    }

    getTabColor(): string {
        let tabColor = "default";
        let screenOpts = this.opts.get();
        if (screenOpts != null && !isBlank(screenOpts.tabcolor)) {
            tabColor = screenOpts.tabcolor;
        }
        return tabColor;
    }

    getTabIcon(): string {
        let tabIcon = "default";
        let screenOpts = this.opts.get();
        if (screenOpts != null && !isBlank(screenOpts.tabicon)) {
            tabIcon = screenOpts.tabicon;
        }
        return tabIcon;
    }

    getCurRemoteInstance(): RemoteInstanceType {
        let session = this.globalModel.getSessionById(this.sessionId);
        let rptr = this.curRemote.get();
        if (rptr == null) {
            return null;
        }
        return session.getRemoteInstance(this.screenId, rptr);
    }

    setAnchorFields(anchorLine: number, anchorOffset: number, reason: string): void {
        mobx.action(() => {
            this.anchor.set({ anchorLine: anchorLine, anchorOffset: anchorOffset });
        })();
    }

    refocusLine(sdata: ScreenDataType, oldFocusType: string, oldSelectedLine: number): void {
        let isCmdFocus = sdata.focustype == "cmd";
        if (!isCmdFocus) {
            return;
        }
        let curLineFocus = this.globalModel.getFocusedLine();
        let sline: LineType = null;
        if (sdata.selectedline != 0) {
            sline = this.getLineByNum(sdata.selectedline);
        }
        if (
            curLineFocus.cmdInputFocus ||
            (curLineFocus.linenum != null && curLineFocus.linenum != sdata.selectedline)
        ) {
            (document.activeElement as HTMLElement).blur();
        }
        if (sline != null) {
            let renderer = this.getRenderer(sline.lineid);
            if (renderer != null) {
                renderer.giveFocus();
            }
            let termWrap = this.getTermWrap(sline.lineid);
            if (termWrap != null) {
                termWrap.giveFocus();
            }
        }
    }

    setFocusType(ftype: FocusTypeStrs): void {
        mobx.action(() => {
            this.focusType.set(ftype);
        })();
    }

    setAnchor(anchorLine: number, anchorOffset: number): void {
        let setVal = anchorLine == null || anchorLine == 0 ? "0" : sprintf("%d:%d", anchorLine, anchorOffset);
        GlobalCommandRunner.screenSetAnchor(this.sessionId, this.screenId, setVal);
    }

    getAnchor(): { anchorLine: number; anchorOffset: number } {
        let anchor = this.anchor.get();
        if (anchor.anchorLine == null || anchor.anchorLine == 0) {
            return { anchorLine: this.selectedLine.get(), anchorOffset: 0 };
        }
        return anchor;
    }

    getMaxLineNum(): number {
        let win = this.getScreenLines();
        if (win == null) {
            return null;
        }
        let lines = win.lines;
        if (lines == null || lines.length == 0) {
            return null;
        }
        return lines[lines.length - 1].linenum;
    }

    getLineByNum(lineNum: number): LineType {
        if (lineNum == null) {
            return null;
        }
        let win = this.getScreenLines();
        if (win == null) {
            return null;
        }
        let lines = win.lines;
        if (lines == null || lines.length == 0) {
            return null;
        }
        for (const line of lines) {
            if (line.linenum == lineNum) {
                return line;
            }
        }
        return null;
    }

    getLineById(lineId: string): LineType {
        if (lineId == null) {
            return null;
        }
        let win = this.getScreenLines();
        if (win == null) {
            return null;
        }
        let lines = win.lines;
        if (lines == null || lines.length == 0) {
            return null;
        }
        for (const line of lines) {
            if (line.lineid == lineId) {
                return line;
            }
        }
        return null;
    }

    getPresentLineNum(lineNum: number): number {
        let win = this.getScreenLines();
        if (win == null || !win.loaded.get()) {
            return lineNum;
        }
        let lines = win.lines;
        if (lines == null || lines.length == 0) {
            return null;
        }
        if (lineNum == 0) {
            return null;
        }
        for (const line of lines) {
            if (line.linenum == lineNum) {
                return lineNum;
            }
            if (line.linenum > lineNum) {
                return line.linenum;
            }
        }
        return lines[lines.length - 1].linenum;
    }

    setSelectedLine(lineNum: number): void {
        mobx.action(() => {
            let pln = this.getPresentLineNum(lineNum);
            if (pln != this.selectedLine.get()) {
                this.selectedLine.set(pln);
            }
        })();
    }

    checkSelectedLine(): void {
        let pln = this.getPresentLineNum(this.selectedLine.get());
        if (pln != this.selectedLine.get()) {
            this.setSelectedLine(pln);
        }
    }

    updatePtyData(ptyMsg: PtyDataUpdateType) {
        let lineId = ptyMsg.lineid;
        let renderer = this.renderers[lineId];
        if (renderer != null) {
            let data = base64ToArray(ptyMsg.ptydata64);
            renderer.receiveData(ptyMsg.ptypos, data, "from-sw");
        }
        let term = this.terminals[lineId];
        if (term != null) {
            let data = base64ToArray(ptyMsg.ptydata64);
            term.receiveData(ptyMsg.ptypos, data, "from-sw");
        }
    }

    isActive(): boolean {
        let activeScreen = this.globalModel.getActiveScreen();
        if (activeScreen == null) {
            return false;
        }
        return this.sessionId == activeScreen.sessionId && this.screenId == activeScreen.screenId;
    }

    screenSizeCallback(winSize: WindowSize): void {
        if (winSize.height == 0 || winSize.width == 0) {
            return;
        }
        if (
            this.lastScreenSize != null &&
            this.lastScreenSize.height == winSize.height &&
            this.lastScreenSize.width == winSize.width
        ) {
            return;
        }
        this.lastScreenSize = winSize;
        let cols = windowWidthToCols(winSize.width, this.globalModel.termFontSize.get());
        let rows = windowHeightToRows(winSize.height, this.globalModel.termFontSize.get());
        this._termSizeCallback(rows, cols);
    }

    getMaxContentSize(): WindowSize {
        if (this.lastScreenSize == null) {
            let width = termWidthFromCols(80, this.globalModel.termFontSize.get());
            let height = termHeightFromRows(25, this.globalModel.termFontSize.get());
            return { width, height };
        }
        let winSize = this.lastScreenSize;
        let minSize = MagicLayout.ScreenMinContentSize;
        let maxSize = MagicLayout.ScreenMaxContentSize;
        let width = boundInt(winSize.width - MagicLayout.ScreenMaxContentWidthBuffer, minSize, maxSize);
        let height = boundInt(winSize.height - MagicLayout.ScreenMaxContentHeightBuffer, minSize, maxSize);
        return { width, height };
    }

    getIdealContentSize(): WindowSize {
        if (this.lastScreenSize == null) {
            let width = termWidthFromCols(80, this.globalModel.termFontSize.get());
            let height = termHeightFromRows(25, this.globalModel.termFontSize.get());
            return { width, height };
        }
        let winSize = this.lastScreenSize;
        let width = boundInt(Math.ceil((winSize.width - 50) * 0.7), 100, 5000);
        let height = boundInt(Math.ceil((winSize.height - 100) * 0.5), 100, 5000);
        return { width, height };
    }

    _termSizeCallback(rows: number, cols: number): void {
        if (cols == 0 || rows == 0) {
            return;
        }
        if (rows == this.lastRows && cols == this.lastCols) {
            return;
        }
        this.lastRows = rows;
        this.lastCols = cols;
        let exclude = [];
        for (let lineid in this.terminals) {
            let inSidebar = this.isLineIdInSidebar(lineid);
            if (!inSidebar) {
                this.terminals[lineid].resizeCols(cols);
            } else {
                exclude.push(lineid);
            }
        }
        GlobalCommandRunner.resizeScreen(this.screenId, rows, cols, { exclude });
    }

    getTermWrap(lineId: string): TermWrap {
        return this.terminals[lineId];
    }

    getRenderer(lineId: string): RendererModel {
        return this.renderers[lineId];
    }

    registerRenderer(lineId: string, renderer: RendererModel) {
        this.renderers[lineId] = renderer;
    }

    setLineFocus(lineNum: number, focus: boolean): void {
        mobx.action(() => this.termLineNumFocus.set(focus ? lineNum : 0))();
        if (focus && this.selectedLine.get() != lineNum) {
            GlobalCommandRunner.screenSelectLine(String(lineNum), "cmd");
        } else if (focus && this.focusType.get() == "input") {
            GlobalCommandRunner.screenSetFocus("cmd");
        }
    }

    /**
     * Set the status indicator for the screen.
     * @param indicator The value of the status indicator. One of "none", "error", "success", "output".
     */
    setStatusIndicator(indicator: appconst.StatusIndicatorLevel): void {
        mobx.action(() => {
            this.statusIndicator.set(indicator);
        })();
    }

    /**
     * Set the number of running commands for the screen.
     * @param numRunning The number of running commands.
     */
    setNumRunningCmds(numRunning: number): void {
        mobx.action(() => {
            this.numRunningCmds.set(numRunning);
        })();
    }

    termCustomKeyHandlerInternal(e: any, termWrap: TermWrap): void {
        let waveEvent = adaptFromReactOrNativeKeyEvent(e);
        if (checkKeyPressed(waveEvent, "ArrowUp")) {
            termWrap.terminal.scrollLines(-1);
            return;
        }
        if (checkKeyPressed(waveEvent, "ArrowDown")) {
            termWrap.terminal.scrollLines(1);
            return;
        }
        if (checkKeyPressed(waveEvent, "PageUp")) {
            termWrap.terminal.scrollPages(-1);
            return;
        }
        if (checkKeyPressed(waveEvent, "PageDown")) {
            termWrap.terminal.scrollPages(1);
            return;
        }
    }

    isTermCapturedKey(e: any): boolean {
        let waveEvent = adaptFromReactOrNativeKeyEvent(e);
        if (
            checkKeyPressed(waveEvent, "ArrowUp") ||
            checkKeyPressed(waveEvent, "ArrowDown") ||
            checkKeyPressed(waveEvent, "PageUp") ||
            checkKeyPressed(waveEvent, "PageDown")
        ) {
            return true;
        }
        return false;
    }

    termCustomKeyHandler(e: any, termWrap: TermWrap): boolean {
        let waveEvent = adaptFromReactOrNativeKeyEvent(e);
        if (e.type == "keypress" && checkKeyPressed(waveEvent, "Ctrl:Shift:c")) {
            e.stopPropagation();
            e.preventDefault();
            let sel = termWrap.terminal.getSelection();
            navigator.clipboard.writeText(sel);
            return false;
        }
        if (e.type == "keypress" && checkKeyPressed(waveEvent, "Ctrl:Shift:v")) {
            e.stopPropagation();
            e.preventDefault();
            let p = navigator.clipboard.readText();
            p.then((text) => {
                termWrap.dataHandler?.(text, termWrap);
            });
            return false;
        }
        if (termWrap.isRunning) {
            return true;
        }
        let isCaptured = this.isTermCapturedKey(e);
        if (!isCaptured) {
            return true;
        }
        if (e.type != "keydown" || isModKeyPress(e)) {
            return false;
        }
        e.stopPropagation();
        e.preventDefault();
        this.termCustomKeyHandlerInternal(e, termWrap);
        return false;
    }

    loadTerminalRenderer(elem: Element, line: LineType, cmd: Cmd, width: number) {
        let lineId = cmd.lineId;
        let termWrap = this.getTermWrap(lineId);
        if (termWrap != null) {
            console.log("term-wrap already exists for", this.screenId, lineId);
            return;
        }
        let usedRows = this.globalModel.getContentHeight(getRendererContext(line));
        if (line.contentheight != null && line.contentheight != -1) {
            usedRows = line.contentheight;
        }
        let termContext = {
            sessionId: this.sessionId,
            screenId: this.screenId,
            lineId: line.lineid,
            lineNum: line.linenum,
        };
        termWrap = new TermWrap(elem, {
            termContext: termContext,
            usedRows: usedRows,
            termOpts: cmd.getTermOpts(),
            winSize: { height: 0, width: width },
            dataHandler: cmd.handleData.bind(cmd),
            focusHandler: (focus: boolean) => this.setLineFocus(line.linenum, focus),
            isRunning: cmd.isRunning(),
            customKeyHandler: this.termCustomKeyHandler.bind(this),
            fontSize: this.globalModel.getTermFontSize(),
            fontFamily: this.globalModel.getTermFontFamily(),
            ptyDataSource: getTermPtyData,
            onUpdateContentHeight: (termContext: RendererContext, height: number) => {
                this.globalModel.setContentHeight(termContext, height);
            },
        });
        this.terminals[lineId] = termWrap;
        if (this.focusType.get() == "cmd" && this.selectedLine.get() == line.linenum) {
            termWrap.giveFocus();
        }
    }

    unloadRenderer(lineId: string) {
        let rmodel = this.renderers[lineId];
        if (rmodel != null) {
            rmodel.dispose();
            delete this.renderers[lineId];
        }
        let term = this.terminals[lineId];
        if (term != null) {
            term.dispose();
            delete this.terminals[lineId];
        }
    }

    getUsedRows(context: RendererContext, line: LineType, cmd: Cmd, width: number): number {
        if (cmd == null) {
            return 0;
        }
        let termOpts = cmd.getTermOpts();
        if (!termOpts.flexrows) {
            return termOpts.rows;
        }
        let termWrap = this.getTermWrap(cmd.lineId);
        if (termWrap == null) {
            let usedRows = this.globalModel.getContentHeight(context);
            if (usedRows != null) {
                return usedRows;
            }
            if (line.contentheight != null && line.contentheight != -1) {
                return line.contentheight;
            }
            return cmd.isRunning() ? 1 : 0;
        }
        return termWrap.getUsedRows();
    }

    getIsFocused(lineNum: number): boolean {
        return this.termLineNumFocus.get() == lineNum;
    }

    getSelectedLine(): number {
        return this.selectedLine.get();
    }

    getScreenLines(): ScreenLines {
        return this.globalModel.getScreenLinesById(this.screenId);
    }

    getFocusType(): FocusTypeStrs {
        return this.focusType.get();
    }

    giveFocus(): void {
        if (!this.isActive()) {
            return;
        }
        let ftype = this.focusType.get();
        if (ftype == "input") {
            this.globalModel.inputModel.giveFocus();
        } else {
            let sline: LineType = null;
            if (this.selectedLine.get() != 0) {
                sline = this.getLineByNum(this.selectedLine.get());
            }
            if (sline != null) {
                let renderer = this.getRenderer(sline.lineid);
                if (renderer != null) {
                    renderer.giveFocus();
                }
                let termWrap = this.getTermWrap(sline.lineid);
                if (termWrap != null) {
                    termWrap.giveFocus();
                }
            }
        }
    }
}

export { Screen };
