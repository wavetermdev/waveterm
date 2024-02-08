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
import { OV, OArr, OMap } from "../types/types";
import { Cmd } from "./cmd";

dayjs.extend(customParseFormat);
dayjs.extend(localizedFormat);

const RemotePtyRows = 8; // also in main.tsx
const RemotePtyCols = 80;
const ProdServerEndpoint = "http://127.0.0.1:1619";
const ProdServerWsEndpoint = "ws://127.0.0.1:1623";
const DevServerEndpoint = "http://127.0.0.1:8090";
const DevServerWsEndpoint = "ws://127.0.0.1:8091";
const DefaultTermFontSize = 12;
const MinFontSize = 8;
const MaxFontSize = 24;
const InputChunkSize = 500;
const RemoteColors = ["red", "green", "yellow", "blue", "magenta", "cyan", "white", "orange"];
const TabColors = ["red", "orange", "yellow", "green", "mint", "cyan", "blue", "violet", "pink", "white"];
const TabIcons = [
    "sparkle",
    "fire",
    "ghost",
    "cloud",
    "compass",
    "crown",
    "droplet",
    "graduation-cap",
    "heart",
    "file",
];

// @ts-ignore
const VERSION = __WAVETERM_VERSION__;
// @ts-ignore
const BUILD = __WAVETERM_BUILD__;

class ScreenLines {
    screenId: string;
    loaded: OV<boolean> = mobx.observable.box(false, { name: "slines-loaded" });
    loadError: OV<string> = mobx.observable.box(null);
    lines: OArr<LineType> = mobx.observable.array([], {
        name: "slines-lines",
        deep: false,
    });
    cmds: Record<string, Cmd> = {}; // lineid => Cmd

    constructor(screenId: string) {
        this.screenId = screenId;
    }

    getNonArchivedLines(): LineType[] {
        let rtn: LineType[] = [];
        for (const line of this.lines) {
            if (line.archived) {
                continue;
            }
            rtn.push(line);
        }
        return rtn;
    }

    updateData(slines: ScreenLinesType, load: boolean) {
        mobx.action(() => {
            if (load) {
                this.loaded.set(true);
            }
            genMergeSimpleData(
                this.lines,
                slines.lines,
                (l: LineType) => String(l.lineid),
                (l: LineType) => sprintf("%013d:%s", l.ts, l.lineid)
            );
            let cmds = slines.cmds || [];
            for (const cmd of cmds) {
                this.cmds[cmd.lineid] = new Cmd(cmd);
            }
        })();
    }

    setLoadError(errStr: string) {
        mobx.action(() => {
            this.loaded.set(true);
            this.loadError.set(errStr);
        })();
    }

    dispose() {}

    getCmd(lineId: string): Cmd {
        return this.cmds[lineId];
    }

    /**
     * Get all running cmds in the screen.
     * @param returnFirst If true, return the first running cmd found.
     * @returns An array of running cmds, or the first running cmd if returnFirst is true.
     */
    getRunningCmdLines(returnFirst?: boolean): LineType[] {
        let rtn: LineType[] = [];
        for (const line of this.lines) {
            const cmd = this.getCmd(line.lineid);
            if (cmd == null) {
                continue;
            }
            const status = cmd.getStatus();
            if (cmdStatusIsRunning(status)) {
                if (returnFirst) {
                    return [line];
                }
                rtn.push(line);
            }
        }
        return rtn;
    }

    /**
     * Check if there are any running cmds in the screen.
     * @returns True if there are any running cmds.
     */
    hasRunningCmdLines(): boolean {
        return this.getRunningCmdLines(true).length > 0;
    }

    updateCmd(cmd: CmdDataType): void {
        if (cmd.remove) {
            throw new Error("cannot remove cmd with updateCmd call [" + cmd.lineid + "]");
        }
        let origCmd = this.cmds[cmd.lineid];
        if (origCmd != null) {
            origCmd.setCmd(cmd);
        }
    }

    mergeCmd(cmd: CmdDataType): void {
        if (cmd.remove) {
            delete this.cmds[cmd.lineid];
            return;
        }
        let origCmd = this.cmds[cmd.lineid];
        if (origCmd == null) {
            this.cmds[cmd.lineid] = new Cmd(cmd);
            return;
        }
        origCmd.setCmd(cmd);
    }

    addLineCmd(line: LineType, cmd: CmdDataType, interactive: boolean) {
        if (!this.loaded.get()) {
            return;
        }
        mobx.action(() => {
            if (cmd != null) {
                this.mergeCmd(cmd);
            }
            if (line != null) {
                let lines = this.lines;
                if (line.remove) {
                    for (let i = 0; i < lines.length; i++) {
                        if (lines[i].lineid == line.lineid) {
                            this.lines.splice(i, 1);
                            break;
                        }
                    }
                    return;
                }
                let lineIdx = 0;
                for (lineIdx = 0; lineIdx < lines.length; lineIdx++) {
                    let lineId = lines[lineIdx].lineid;
                    let curTs = lines[lineIdx].ts;
                    if (lineId == line.lineid) {
                        this.lines[lineIdx] = line;
                        return;
                    }
                    if (curTs > line.ts || (curTs == line.ts && lineId > line.lineid)) {
                        break;
                    }
                }
                if (lineIdx == lines.length) {
                    this.lines.push(line);
                    return;
                }
                this.lines.splice(lineIdx, 0, line);
            }
        })();
    }
}

export { ScreenLines };
