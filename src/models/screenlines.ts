// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as mobx from "mobx";
import { sprintf } from "sprintf-js";
import { genMergeSimpleData } from "../util/util";
import { LineType, CmdDataType, ScreenLinesType } from "../types/types";
import { cmdStatusIsRunning } from "../app/line/lineutil";
import { OV, OArr } from "../types/types";
import { Cmd } from "./cmd";

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
                for (lineIdx; lineIdx < lines.length; lineIdx++) {
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
