// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/global";
import { RpcResponseHelper, WshClient } from "@/app/store/wshclient";
import { makeFeBlockRouteId } from "@/app/store/wshrouter";
import { TermViewModel } from "@/app/view/term/term-model";

export class TermWshClient extends WshClient {
    blockId: string;
    model: TermViewModel;

    constructor(blockId: string, model: TermViewModel) {
        super(makeFeBlockRouteId(blockId));
        this.blockId = blockId;
        this.model = model;
    }

    async handle_termupdateattachedjob(rh: RpcResponseHelper, data: CommandTermUpdateAttachedJobData): Promise<void> {
        console.log("term-update-attached-job", this.blockId, data);
        // TODO: implement frontend logic to handle job attachment updates
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
        const lines: string[] = [];

        if (data.lastcommand) {
            if (globalStore.get(termWrap.shellIntegrationStatusAtom) == null) {
                throw new Error("Cannot get last command data without shell integration");
            }

            let startLine = 0;
            if (termWrap.promptMarkers.length > 0) {
                const lastMarker = termWrap.promptMarkers[termWrap.promptMarkers.length - 1];
                const markerLine = lastMarker.line;
                startLine = totalLines - markerLine;
            }

            const endLine = totalLines;
            for (let i = startLine; i < endLine; i++) {
                const bufferIndex = totalLines - 1 - i;
                const line = buffer.getLine(bufferIndex);
                if (line) {
                    lines.push(line.translateToString(true));
                }
            }

            lines.reverse();

            let returnLines = lines;
            let returnStartLine = startLine;
            if (lines.length > 1000) {
                returnLines = lines.slice(lines.length - 1000);
                returnStartLine = startLine + (lines.length - 1000);
            }

            return {
                totallines: totalLines,
                linestart: returnStartLine,
                lines: returnLines,
                lastupdated: termWrap.lastUpdated,
            };
        }

        const startLine = Math.max(0, data.linestart);
        const endLine = Math.min(totalLines, data.lineend);

        for (let i = startLine; i < endLine; i++) {
            const bufferIndex = totalLines - 1 - i;
            const line = buffer.getLine(bufferIndex);
            if (line) {
                lines.push(line.translateToString(true));
            }
        }

        lines.reverse();

        return {
            totallines: totalLines,
            linestart: startLine,
            lines: lines,
            lastupdated: termWrap.lastUpdated,
        };
    }
}
