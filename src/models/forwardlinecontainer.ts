// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { TermWrap } from "../plugins/terminal/term";
import * as types from "../types/types";
import { windowWidthToCols, windowHeightToRows } from "../util/textmeasure";
import { MagicLayout } from "../app/magiclayout";
import { Model } from "./model";
import { CommandRunner } from "./model";
import { Cmd } from "./cmd";
import { Screen } from "./screen";

class ForwardLineContainer {
    globalCommandRunner: CommandRunner;
    globalModel: Model;
    winSize: types.WindowSize;
    screen: Screen;
    containerType: types.LineContainerStrs;
    lineId: string;

    constructor(screen: Screen, winSize: types.WindowSize, containerType: types.LineContainerStrs, lineId: string) {
        this.globalModel = Model.getInstance();
        this.globalCommandRunner = CommandRunner.getInstance();
        this.screen = screen;
        this.winSize = winSize;
        this.containerType = containerType;
        this.lineId = lineId;
    }

    screenSizeCallback(winSize: types.WindowSize): void {
        this.winSize = winSize;
        let termWrap = this.getTermWrap(this.lineId);
        if (termWrap != null) {
            let fontSize = this.globalModel.termFontSize.get();
            let cols = windowWidthToCols(winSize.width, fontSize);
            let rows = windowHeightToRows(winSize.height, fontSize);
            termWrap.resizeCols(cols);
            this.globalCommandRunner.resizeScreen(this.screen.screenId, rows, cols, { include: [this.lineId] });
        }
    }

    getContainerType(): types.LineContainerStrs {
        return this.containerType;
    }

    getCmd(line: types.LineType): Cmd {
        return this.screen.getCmd(line);
    }

    isSidebarOpen(): boolean {
        return false;
    }

    isLineIdInSidebar(lineId: string): boolean {
        return false;
    }

    setLineFocus(lineNum: number, focus: boolean): void {
        this.screen.setLineFocus(lineNum, focus);
    }

    setContentHeight(context: types.RendererContext, height: number): void {
        return;
    }

    getMaxContentSize(): types.WindowSize {
        let rtn = { width: this.winSize.width, height: this.winSize.height };
        rtn.width = rtn.width - MagicLayout.ScreenMaxContentWidthBuffer;
        return rtn;
    }

    getIdealContentSize(): types.WindowSize {
        return this.winSize;
    }

    loadTerminalRenderer(elem: Element, line: types.LineType, cmd: Cmd, width: number): void {
        this.screen.loadTerminalRenderer(elem, line, cmd, width);
    }

    registerRenderer(lineId: string, renderer: types.RendererModel): void {
        this.screen.registerRenderer(lineId, renderer);
    }

    unloadRenderer(lineId: string): void {
        this.screen.unloadRenderer(lineId);
    }

    getContentHeight(context: types.RendererContext): number {
        return this.screen.getContentHeight(context);
    }

    getUsedRows(context: types.RendererContext, line: types.LineType, cmd: Cmd, width: number): number {
        return this.screen.getUsedRows(context, line, cmd, width);
    }

    getIsFocused(lineNum: number): boolean {
        return this.screen.getIsFocused(lineNum);
    }

    getRenderer(lineId: string): types.RendererModel {
        return this.screen.getRenderer(lineId);
    }

    getTermWrap(lineId: string): TermWrap {
        return this.screen.getTermWrap(lineId);
    }

    getFocusType(): types.FocusTypeStrs {
        return this.screen.getFocusType();
    }

    getSelectedLine(): number {
        return this.screen.getSelectedLine();
    }
}

export { ForwardLineContainer };
