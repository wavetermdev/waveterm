// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms, globalStore } from "@/app/store/global";
import { makeORef, splitORef } from "@/app/store/wos";
import { RpcResponseHelper, WshClient } from "@/app/store/wshclient";
import { RpcApi } from "@/app/store/wshclientapi";
import { makeFeBlockRouteId } from "@/app/store/wshrouter";
import { TermViewModel } from "@/app/view/term/term-model";
import { bufferLinesToText } from "@/app/view/term/termutil";
import { isBlank } from "@/util/util";
import debug from "debug";

const dlog = debug("wave:vdom");

export class TermWshClient extends WshClient {
    blockId: string;
    model: TermViewModel;

    constructor(blockId: string, model: TermViewModel) {
        super(makeFeBlockRouteId(blockId));
        this.blockId = blockId;
        this.model = model;
    }

    async handle_vdomcreatecontext(rh: RpcResponseHelper, data: VDomCreateContext) {
        const source = rh.getSource();
        if (isBlank(source)) {
            throw new Error("source cannot be blank");
        }
        console.log("vdom-create", source, data);
        const tabId = globalStore.get(atoms.staticTabId);
        if (data.target?.newblock) {
            const oref = await RpcApi.CreateBlockCommand(this, {
                tabid: tabId,
                blockdef: {
                    meta: {
                        view: "vdom",
                        "vdom:route": rh.getSource(),
                    },
                },
                magnified: data.target?.magnified,
                focused: true,
            });
            return oref;
        } else if (data.target?.toolbar?.toolbar) {
            const oldVDomBlockId = globalStore.get(this.model.vdomToolbarBlockId);
            console.log("vdom:toolbar", data.target.toolbar);
            globalStore.set(this.model.vdomToolbarTarget, data.target.toolbar);
            const oref = await RpcApi.CreateSubBlockCommand(this, {
                parentblockid: this.blockId,
                blockdef: {
                    meta: {
                        view: "vdom",
                        "vdom:route": rh.getSource(),
                    },
                },
            });
            const [_, newVDomBlockId] = splitORef(oref);
            if (!isBlank(oldVDomBlockId)) {
                // dispose of the old vdom block
                setTimeout(() => {
                    RpcApi.DeleteSubBlockCommand(this, { blockid: oldVDomBlockId });
                }, 500);
            }
            setTimeout(() => {
                RpcApi.SetMetaCommand(this, {
                    oref: makeORef("block", this.model.blockId),
                    meta: {
                        "term:vdomtoolbarblockid": newVDomBlockId,
                    },
                });
            }, 50);
            return oref;
        } else {
            // in the terminal
            // check if there is a current active vdom block
            const oldVDomBlockId = globalStore.get(this.model.vdomBlockId);
            const oref = await RpcApi.CreateSubBlockCommand(this, {
                parentblockid: this.blockId,
                blockdef: {
                    meta: {
                        view: "vdom",
                        "vdom:route": rh.getSource(),
                    },
                },
            });
            const [_, newVDomBlockId] = splitORef(oref);
            if (!isBlank(oldVDomBlockId)) {
                // dispose of the old vdom block
                setTimeout(() => {
                    RpcApi.DeleteSubBlockCommand(this, { blockid: oldVDomBlockId });
                }, 500);
            }
            setTimeout(() => {
                RpcApi.SetMetaCommand(this, {
                    oref: makeORef("block", this.model.blockId),
                    meta: {
                        "term:mode": "vdom",
                        "term:vdomblockid": newVDomBlockId,
                    },
                });
            }, 50);
            return oref;
        }
    }

    async handle_termgetscrollbacklines(
        rh: RpcResponseHelper,
        data: CommandTermGetScrollbackLinesData
    ): Promise<CommandTermGetScrollbackLinesRtnData> {
        const termWrap = this.model.termRef.current;
        if (!termWrap || !termWrap.terminal) {
            return {
                totallines: 0,
                linestart: data.linestart,
                lines: [],
                lastupdated: 0,
            };
        }

        const buffer = termWrap.terminal.buffer.active;
        const totalLines = buffer.length;

        if (data.lastcommand) {
            if (globalStore.get(termWrap.shellIntegrationStatusAtom) == null) {
                throw new Error("Cannot get last command data without shell integration");
            }

            let startBufferIndex = 0;
            let endBufferIndex = totalLines;
            if (termWrap.promptMarkers.length > 0) {
                // The last marker is the current prompt, so we want the second-to-last for the previous command
                // If there's only one marker, use it (edge case for first command)
                const markerIndex =
                    termWrap.promptMarkers.length > 1
                        ? termWrap.promptMarkers.length - 2
                        : termWrap.promptMarkers.length - 1;
                const commandStartMarker = termWrap.promptMarkers[markerIndex];
                startBufferIndex = commandStartMarker.line;

                // End at the last marker (current prompt) if there are multiple markers
                if (termWrap.promptMarkers.length > 1) {
                    const currentPromptMarker = termWrap.promptMarkers[termWrap.promptMarkers.length - 1];
                    endBufferIndex = currentPromptMarker.line;
                }
            }

            const lines = bufferLinesToText(buffer, startBufferIndex, endBufferIndex);

            // Convert buffer indices to "from bottom" line numbers.
            // "from bottom" 0 = most recent line; higher numbers = older lines.
            // The buffer range [startBufferIndex, endBufferIndex) maps to
            // "from bottom" range [totalLines - endBufferIndex, totalLines - startBufferIndex).
            // The first returned line is at "from bottom" position: totalLines - endBufferIndex.
            let returnLines = lines;
            let returnStartLine = totalLines - endBufferIndex;
            if (lines.length > 1000) {
                // there is a small bug here since this is computing a physical start line
                // after the lines have already been combined (because of potential wrapping)
                // for now this isn't worth fixing, just noted
                returnLines = lines.slice(lines.length - 1000);
                returnStartLine = (totalLines - endBufferIndex) + (lines.length - 1000);
            }

            return {
                totallines: totalLines,
                linestart: returnStartLine,
                lines: returnLines,
                lastupdated: termWrap.lastUpdated,
            };
        }

        const startLine = Math.max(0, data.linestart);
        const endLine = data.lineend === 0 ? totalLines : Math.min(totalLines, data.lineend);

        const startBufferIndex = totalLines - endLine;
        const endBufferIndex = totalLines - startLine;
        const lines = bufferLinesToText(buffer, startBufferIndex, endBufferIndex);

        return {
            totallines: totalLines,
            linestart: startLine,
            lines: lines,
            lastupdated: termWrap.lastUpdated,
        };
    }
}
