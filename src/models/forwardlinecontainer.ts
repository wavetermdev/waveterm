// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { TermWrap } from "@/plugins/terminal/term";
import { windowWidthToCols, windowHeightToRows } from "@/util/textmeasure";
import { MagicLayout } from "@/app/magiclayout";
import { Model } from "./model";
import { GlobalCommandRunner } from "./global";
import { Cmd } from "./cmd";
import { Screen } from "./screen";
import * as lineutil from "@/app/line/lineutil";

class ForwardLineContainer {
    globalModel: Model;
    winSize: WindowSize;
    screen: Screen;
    containerType: LineContainerStrs;
    lineId: string;

    constructor(screen: Screen, winSize: WindowSize, containerType: LineContainerStrs, lineId: string) {
        this.globalModel = Model.getInstance();
        this.screen = screen;
        this.winSize = winSize;
        this.containerType = containerType;
        this.lineId = lineId;
    }

    screenSizeCallback(winSize: WindowSize): void {
        this.winSize = winSize;
        let termWrap = this.getTermWrap(this.lineId);
        if (termWrap != null) {
            let fontSize = this.globalModel.getTermFontSize();
            let cols = windowWidthToCols(winSize.width, fontSize);
            let rows = windowHeightToRows(Model.getInstance().lineHeightEnv, this.winSize.height);
            termWrap.resizeCols(cols);
            GlobalCommandRunner.resizeScreen(this.screen.screenId, rows, cols, { include: [this.lineId] });
        }
    }

    getContainerType(): LineContainerStrs {
        return this.containerType;
    }

    getCmd(line: LineType): Cmd {
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

    setContentHeight(context: RendererContext, height: number): void {
        return;
    }

    getMaxContentSize(): WindowSize {
        let rtn = { width: this.winSize.width, height: this.winSize.height };
        rtn.width = rtn.width - MagicLayout.ScreenMaxContentWidthBuffer;
        return rtn;
    }

    getIdealContentSize(): WindowSize {
        return this.winSize;
    }

    loadTerminalRenderer(elem: Element, line: LineType, cmd: Cmd, width: number): void {
        this.screen.loadTerminalRenderer(elem, line, cmd, width);
    }

    registerRenderer(lineId: string, renderer: RendererModel): void {
        this.screen.registerRenderer(lineId, renderer);
    }

    unloadRenderer(lineId: string): void {
        this.screen.unloadRenderer(lineId);
    }

    getContentHeight(context: RendererContext): number {
        return this.screen.getContentHeight(context);
    }

    getUsedRows(context: RendererContext, line: LineType, cmd: Cmd, width: number): number {
        return this.screen.getUsedRows(context, line, cmd, width);
    }

    getIsFocused(lineNum: number): boolean {
        return this.screen.getIsFocused(lineNum);
    }

    getRenderer(lineId: string): RendererModel {
        return this.screen.getRenderer(lineId);
    }

    getTermWrap(lineId: string): TermWrap {
        return this.screen.getTermWrap(lineId);
    }

    getFocusType(): FocusTypeStrs {
        return this.screen.getFocusType();
    }

    getSelectedLine(): number {
        return this.screen.getSelectedLine();
    }
}

export { ForwardLineContainer };
