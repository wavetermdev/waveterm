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
import { Model } from "./model";
import { getTermPtyData } from "../util/modelutil";

class MainSidebarModel {
    globalModel: Model = null;
    tempWidth: OV<number> = mobx.observable.box(null, {
        name: "MainSidebarModel-tempWidth",
    });
    tempCollapsed: OV<boolean> = mobx.observable.box(null, {
        name: "MainSidebarModel-tempCollapsed",
    });
    isDragging: OV<boolean> = mobx.observable.box(false, {
        name: "MainSidebarModel-isDragging",
    });

    constructor(globalModel: Model) {
        this.globalModel = globalModel;
    }

    setTempWidthAndTempCollapsed(newWidth: number, newCollapsed: boolean): void {
        const width = Math.max(MagicLayout.MainSidebarMinWidth, Math.min(newWidth, MagicLayout.MainSidebarMaxWidth));

        mobx.action(() => {
            this.tempWidth.set(width);
            this.tempCollapsed.set(newCollapsed);
        })();
    }

    /**
     * Gets the intended width for the sidebar. If the sidebar is being dragged, returns the tempWidth. If the sidebar is collapsed, returns the default width.
     * @param ignoreCollapse If true, returns the persisted width even if the sidebar is collapsed.
     * @returns The intended width for the sidebar or the default width if the sidebar is collapsed. Can be overridden using ignoreCollapse.
     */
    getWidth(ignoreCollapse: boolean = false): number {
        const clientData = this.globalModel.clientData.get();
        let width = clientData?.clientopts?.mainsidebar?.width ?? MagicLayout.MainSidebarDefaultWidth;
        if (this.isDragging.get()) {
            if (this.tempWidth.get() == null && width == null) {
                return MagicLayout.MainSidebarDefaultWidth;
            }
            if (this.tempWidth.get() == null) {
                return width;
            }
            return this.tempWidth.get();
        }
        // Set by CLI and collapsed
        if (this.getCollapsed()) {
            if (ignoreCollapse) {
                return width;
            } else {
                return MagicLayout.MainSidebarMinWidth;
            }
        } else {
            if (width <= MagicLayout.MainSidebarMinWidth) {
                width = MagicLayout.MainSidebarDefaultWidth;
            }
            const snapPoint = MagicLayout.MainSidebarMinWidth + MagicLayout.MainSidebarSnapThreshold;
            if (width < snapPoint || width > MagicLayout.MainSidebarMaxWidth) {
                width = MagicLayout.MainSidebarDefaultWidth;
            }
        }
        return width;
    }

    getCollapsed(): boolean {
        const clientData = this.globalModel.clientData.get();
        const collapsed = clientData?.clientopts?.mainsidebar?.collapsed;
        if (this.isDragging.get()) {
            if (this.tempCollapsed.get() == null && collapsed == null) {
                return false;
            }
            if (this.tempCollapsed.get() == null) {
                return collapsed;
            }
            return this.tempCollapsed.get();
        }
        return collapsed;
    }
}

export { MainSidebarModel };
