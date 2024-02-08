// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { TermWrap } from "../plugins/terminal/term";
import { LineType, RendererContext, RendererModel, FocusTypeStrs, WindowSize } from "../types/types";
import { LineContainerStrs } from "../types/types";
import { Cmd } from "./cmd";

type LineContainerModel = {
    loadTerminalRenderer: (elem: Element, line: LineType, cmd: Cmd, width: number) => void;
    registerRenderer: (lineId: string, renderer: RendererModel) => void;
    unloadRenderer: (lineId: string) => void;
    getIsFocused: (lineNum: number) => boolean;
    getTermWrap: (lineId: string) => TermWrap;
    getRenderer: (lineId: string) => RendererModel;
    getFocusType: () => FocusTypeStrs;
    getSelectedLine: () => number;
    getCmd: (line: LineType) => Cmd;
    setLineFocus: (lineNum: number, focus: boolean) => void;
    getUsedRows: (context: RendererContext, line: LineType, cmd: Cmd, width: number) => number;
    getContentHeight: (context: RendererContext) => number;
    setContentHeight: (context: RendererContext, height: number) => void;
    getMaxContentSize(): WindowSize;
    getIdealContentSize(): WindowSize;
    isSidebarOpen(): boolean;
    isLineIdInSidebar(lineId: string): boolean;
    getContainerType(): LineContainerStrs;
};

export type { LineContainerModel };
