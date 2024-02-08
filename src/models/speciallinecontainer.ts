// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { TermWrap } from "../plugins/terminal/term";
import { LineType, RendererContext, RendererModel, FocusTypeStrs, WindowSize, LineContainerStrs } from "../types/types";
import { windowWidthToCols } from "../util/textmeasure";
import { getRendererContext } from "../app/line/lineutil";
import { getTermPtyData } from "../util/modelutil";
import { Cmd } from "./cmd";
import { Model } from "./model";

type CmdFinder = {
    getCmdById(cmdId: string): Cmd;
};

class SpecialLineContainer {
    globalModel: Model;
    wsize: WindowSize;
    allowInput: boolean;
    terminal: TermWrap;
    renderer: RendererModel;
    cmd: Cmd;
    cmdFinder: CmdFinder;
    containerType: LineContainerStrs;

    constructor(cmdFinder: CmdFinder, wsize: WindowSize, allowInput: boolean, containerType: LineContainerStrs) {
        this.globalModel = Model.getInstance();
        this.cmdFinder = cmdFinder;
        this.wsize = wsize;
        this.allowInput = allowInput;
    }

    getCmd(line: LineType): Cmd {
        if (this.cmd == null) {
            this.cmd = this.cmdFinder.getCmdById(line.lineid);
        }
        return this.cmd;
    }

    getContainerType(): LineContainerStrs {
        return this.containerType;
    }

    isSidebarOpen(): boolean {
        return false;
    }

    isLineIdInSidebar(lineId: string): boolean {
        return false;
    }

    setLineFocus(lineNum: number, focus: boolean): void {
        return;
    }

    setContentHeight(context: RendererContext, height: number): void {
        return;
    }

    getMaxContentSize(): WindowSize {
        return this.wsize;
    }

    getIdealContentSize(): WindowSize {
        return this.wsize;
    }

    loadTerminalRenderer(elem: Element, line: LineType, cmd: Cmd, width: number): void {
        this.unloadRenderer(null);
        let lineId = cmd.lineId;
        let termWrap = this.getTermWrap(lineId);
        if (termWrap != null) {
            console.log("term-wrap already exists for", line.screenid, lineId);
            return;
        }
        let usedRows = this.globalModel.getContentHeight(getRendererContext(line));
        if (line.contentheight != null && line.contentheight != -1) {
            usedRows = line.contentheight;
        }
        let termContext = {
            screenId: line.screenid,
            lineId: line.lineid,
            lineNum: line.linenum,
        };
        termWrap = new TermWrap(elem, {
            termContext: termContext,
            usedRows: usedRows,
            termOpts: cmd.getTermOpts(),
            winSize: { height: 0, width: width },
            dataHandler: null,
            focusHandler: null,
            isRunning: cmd.isRunning(),
            customKeyHandler: null,
            fontSize: this.globalModel.termFontSize.get(),
            ptyDataSource: getTermPtyData,
            onUpdateContentHeight: null,
        });
        this.terminal = termWrap;
    }

    registerRenderer(lineId: string, renderer: RendererModel): void {
        this.renderer = renderer;
    }

    unloadRenderer(lineId: string): void {
        if (this.renderer != null) {
            this.renderer.dispose();
            this.renderer = null;
        }
        if (this.terminal != null) {
            this.terminal.dispose();
            this.terminal = null;
        }
    }

    getContentHeight(context: RendererContext): number {
        return this.globalModel.getContentHeight(context);
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
            let cols = windowWidthToCols(width, this.globalModel.termFontSize.get());
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
        return false;
    }

    getRenderer(lineId: string): RendererModel {
        return this.renderer;
    }

    getTermWrap(lineId: string): TermWrap {
        return this.terminal;
    }

    getFocusType(): FocusTypeStrs {
        return "input";
    }

    getSelectedLine(): number {
        return null;
    }
}

export { SpecialLineContainer };
