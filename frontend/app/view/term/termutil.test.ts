// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type * as TermTypes from "@xterm/xterm";
import { describe, expect, it } from "vitest";
import { bufferContentLength, bufferLinesToText } from "./termutil";

function makeBuffer(rows: string[], cursorRow: number, baseY = 0): TermTypes.IBuffer {
    return {
        length: rows.length,
        baseY,
        cursorY: cursorRow - baseY,
        getLine: (i: number) =>
            i < 0 || i >= rows.length ? undefined : { isWrapped: false, translateToString: () => rows[i] },
    } as unknown as TermTypes.IBuffer;
}

function linesFromBottom(buffer: TermTypes.IBuffer, start: number, end: number): string[] {
    const total = bufferContentLength(buffer);
    return bufferLinesToText(buffer, total - Math.min(total, end), total - start);
}

describe("bufferContentLength", () => {
    it("stops at the cursor row on a screen that is not full yet", () => {
        const rows = ["PS> echo one", "one", "PS> echo two", "two", "PS> ", ...Array(25).fill("")];
        const buffer = makeBuffer(rows, 4);
        expect(bufferContentLength(buffer)).toBe(5);
        expect(linesFromBottom(buffer, 0, 20)).toEqual(["PS> echo one", "one", "PS> echo two", "two", "PS> "]);
        expect(linesFromBottom(buffer, 0, 2)).toEqual(["two", "PS> "]);
        expect(linesFromBottom(buffer, 1, 3)).toEqual(["PS> echo two", "two"]);
    });

    it("keeps output drawn below the cursor", () => {
        const rows = ["top", "", "", "status line", "", ""];
        expect(bufferContentLength(makeBuffer(rows, 0))).toBe(4);
    });

    it("counts scrollback rows above the viewport", () => {
        const rows = ["old 1", "old 2", "old 3", "new 1", "new 2", "$ "];
        const buffer = makeBuffer(rows, 5, 3);
        expect(bufferContentLength(buffer)).toBe(6);
        expect(linesFromBottom(buffer, 0, 3)).toEqual(["new 1", "new 2", "$ "]);
    });
});
