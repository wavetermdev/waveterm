// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type React from "react";
import * as mobx from "mobx";
import { sprintf } from "sprintf-js";
import { v4 as uuidv4 } from "uuid";
import { boundMethod } from "autobind-decorator";
import { debounce } from "throttle-debounce";
import * as mobxReact from "mobx-react";
import {
    handleJsonFetchResponse,
    base64ToString,
    stringToBase64,
    base64ToArray,
    genMergeData,
    genMergeDataMap,
    genMergeSimpleData,
    boundInt,
    isModKeyPress,
} from "../util/util";
import { TermWrap } from "../plugins/terminal/term";
import { PluginModel } from "../plugins/plugins";
import {
    SessionDataType,
    LineType,
    RemoteType,
    HistoryItem,
    RemoteInstanceType,
    RemotePtrType,
    CmdDataType,
    FeCmdPacketType,
    TermOptsType,
    ScreenDataType,
    ScreenOptsType,
    PtyDataUpdateType,
    ModelUpdateType,
    UpdateMessage,
    InfoType,
    UIContextType,
    HistoryInfoType,
    HistoryQueryOpts,
    FeInputPacketType,
    RemoteInputPacketType,
    ContextMenuOpts,
    RendererContext,
    RendererModel,
    PtyDataType,
    BookmarkType,
    ClientDataType,
    HistoryViewDataType,
    AlertMessageType,
    HistorySearchParams,
    FocusTypeStrs,
    ScreenLinesType,
    HistoryTypeStrs,
    RendererPluginType,
    WindowSize,
    WebShareOpts,
    TermContextUnion,
    RemoteEditType,
    RemoteViewType,
    CommandRtnType,
    WebCmd,
    WebRemote,
    OpenAICmdInfoChatMessageType,
    StatusIndicatorLevel,
} from "../types/types";
import * as T from "../types/types";
import { WSControl } from "./ws";
import {
    getMonoFontSize,
    windowWidthToCols,
    windowHeightToRows,
    termWidthFromCols,
    termHeightFromRows,
} from "../util/textmeasure";
import dayjs from "dayjs";
import localizedFormat from "dayjs/plugin/localizedFormat";
import customParseFormat from "dayjs/plugin/customParseFormat";
import { getRendererContext, cmdStatusIsRunning } from "../app/line/lineutil";
import { MagicLayout } from "../app/magiclayout";
import { modalsRegistry } from "../app/common/modals/registry";
import * as appconst from "../app/appconst";
import { checkKeyPressed, adaptFromReactOrNativeKeyEvent, setKeyUtilPlatform } from "../util/keyutil";
import { OV, OArr, OMap, CV } from "../types/types";
import { Session } from "./session";
import { CommandRunner } from "./commandrunner";
import { ScreenLines } from "./screenlines";
import { InputModel } from "./input";
import { PluginsModel } from "./plugins";
import { BookmarksModel } from "./bookmarks";
import { Cmd } from "./cmd";
import { Model } from "./model";

class SpecialLineContainer {
    globalModel: Model;
    wsize: T.WindowSize;
    allowInput: boolean;
    terminal: TermWrap;
    renderer: RendererModel;
    cmd: Cmd;
    cmdFinder: CmdFinder;
    containerType: T.LineContainerStrs;

    constructor(cmdFinder: CmdFinder, wsize: T.WindowSize, allowInput: boolean, containerType: T.LineContainerStrs) {
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

    getContainerType(): T.LineContainerStrs {
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
