import { describe, expect, it } from "vitest";

import {
    appendDroppedPrefixLines,
    extractAppendedSuffixLines,
    computeResizePreserveScrollback,
    DefaultTermScrollback,
    extractDroppedPrefixLines,
    extractAgentTuiHistoryLines,
    getWheelLineDelta,
    MaxTermScrollback,
    mergeOverlappingLines,
    normalizeTermScrollback,
    reconcileAgentTuiSnapshotHistory,
    shouldHandleTerminalWheel,
    shouldPrimeAgentTuiTranscriptCapture,
} from "./termutil";

describe("getWheelLineDelta", () => {
    it("returns 0 for zero and non-finite deltas", () => {
        expect(getWheelLineDelta(0, 0, 16, 40)).toBe(0);
        expect(getWheelLineDelta(Number.NaN, 0, 16, 40)).toBe(0);
        expect(getWheelLineDelta(Number.POSITIVE_INFINITY, 0, 16, 40)).toBe(0);
        expect(getWheelLineDelta(Number.NEGATIVE_INFINITY, 0, 16, 40)).toBe(0);
    });

    it("converts pixel deltas using cell height", () => {
        expect(getWheelLineDelta(32, 0, 16, 40)).toBe(2);
        expect(getWheelLineDelta(-24, 0, 12, 40)).toBe(-2);
    });

    it("keeps line deltas unchanged", () => {
        expect(getWheelLineDelta(3, 1, 16, 40)).toBe(3);
        expect(getWheelLineDelta(-2, 1, 16, 40)).toBe(-2);
    });

    it("converts page deltas using row count", () => {
        expect(getWheelLineDelta(1, 2, 16, 30)).toBe(30);
        expect(getWheelLineDelta(-1, 2, 16, 18)).toBe(-18);
    });

    it("falls back to sane defaults for invalid dimensions", () => {
        expect(getWheelLineDelta(16, 0, 0, 0)).toBe(1);
    });
});

describe("normalizeTermScrollback", () => {
    it("uses a large default for long agent output", () => {
        expect(normalizeTermScrollback(undefined)).toBe(DefaultTermScrollback);
    });

    it("clamps configured values to the supported range", () => {
        expect(normalizeTermScrollback(-10)).toBe(0);
        expect(normalizeTermScrollback("123.9")).toBe(123);
        expect(normalizeTermScrollback(MaxTermScrollback + 1)).toBe(MaxTermScrollback);
    });
});

describe("computeResizePreserveScrollback", () => {
    it("keeps scrollback unchanged when the terminal is not narrowing", () => {
        expect(computeResizePreserveScrollback(2000, 2000, 80, 120, 30)).toBe(2000);
    });

    it("increases scrollback before narrow resize can reflow-trim old rows", () => {
        expect(computeResizePreserveScrollback(2000, 2000, 120, 60, 30)).toBeGreaterThan(2000);
    });

    it("never exceeds the global max", () => {
        expect(computeResizePreserveScrollback(2000, 500000, 200, 20, 30)).toBe(MaxTermScrollback);
    });
});

describe("shouldHandleTerminalWheel", () => {
    it("handles normal-buffer wheel even when terminal apps enable mouse tracking", () => {
        expect(shouldHandleTerminalWheel(false, "normal")).toBe(true);
    });

    it("does not override alternate-buffer wheel; xterm/app handles it", () => {
        expect(shouldHandleTerminalWheel(false, "alternate")).toBe(false);
    });

    it("does not handle already-cancelled wheel events", () => {
        expect(shouldHandleTerminalWheel(true, "normal")).toBe(false);
    });

    it("does not handle unknown buffer types", () => {
        expect(shouldHandleTerminalWheel(false, undefined)).toBe(false);
    });
});

describe("shouldPrimeAgentTuiTranscriptCapture", () => {
    it("does not arm while PowerShell is only editing a codex command", () => {
        expect(
            shouldPrimeAgentTuiTranscriptCapture({
                activeBufferType: "normal",
                mouseTrackingMode: "none",
                shellState: null,
                lastCommand: null,
                dataText: "PS D:\\Project\\260413\\waveterm> codex --yol",
            })
        ).toBe(false);
    });

    it("arms after shell integration reports an agent command is running", () => {
        expect(
            shouldPrimeAgentTuiTranscriptCapture({
                activeBufferType: "normal",
                mouseTrackingMode: "none",
                shellState: "running-command",
                lastCommand: "codex --yolo",
                dataText: "",
            })
        ).toBe(true);
    });

    it("arms on strong Codex UI markers even without shell integration", () => {
        expect(
            shouldPrimeAgentTuiTranscriptCapture({
                activeBufferType: "normal",
                mouseTrackingMode: "none",
                shellState: null,
                lastCommand: null,
                dataText: "\x1b[?2026h\r\n>_ OpenAI Codex\r\n",
            })
        ).toBe(true);
    });
});

describe("mergeOverlappingLines", () => {
    it("appends only the new suffix for growing snapshots", () => {
        expect(mergeOverlappingLines(["鈥?1", "  2"], ["鈥?1", "  2", "  3"])).toEqual(["鈥?1", "  2", "  3"]);
    });

    it("stitches sliding repaint windows without duplicating overlap", () => {
        expect(mergeOverlappingLines(["鈥?1", "  2", "  3"], ["  2", "  3", "  4"])).toEqual([
            "鈥?1",
            "  2",
            "  3",
            "  4",
        ]);
    });

    it("keeps the configured maximum history size", () => {
        expect(mergeOverlappingLines(["1", "2", "3"], ["4", "5"], 4)).toEqual(["2", "3", "4", "5"]);
    });
});

describe("extractDroppedPrefixLines", () => {
    it("returns the lines that slid out of the top of a repaint window", () => {
        expect(extractDroppedPrefixLines(["1", "2", "3"], ["2", "3", "4"])).toEqual(["1"]);
    });

    it("returns an empty list when snapshots do not overlap", () => {
        expect(extractDroppedPrefixLines(["1", "2", "3"], ["7", "8", "9"])).toEqual([]);
    });
});

describe("appendDroppedPrefixLines", () => {
    it("queues only lines that slid out of adjacent repaint windows", () => {
        const first = appendDroppedPrefixLines([], ["1", "2", "3"], ["2", "3", "4"]);
        expect(first).toEqual({ history: ["1"], pendingLines: ["1"] });

        const second = appendDroppedPrefixLines(first.history, ["2", "3", "4"], ["3", "4", "5"]);
        expect(second).toEqual({ history: ["1", "2"], pendingLines: ["2"] });
    });

    it("does not queue lines when snapshots cannot be confidently stitched", () => {
        expect(appendDroppedPrefixLines([], ["1", "2", "3"], ["7", "8", "9"])).toEqual({
            history: [],
            pendingLines: [],
        });
    });

    it("does not queue a dropped prefix already present at the injected history tail", () => {
        expect(appendDroppedPrefixLines(["1"], ["1", "2", "3"], ["2", "3", "4"])).toEqual({
            history: ["1"],
            pendingLines: [],
        });
    });
});

describe("extractAppendedSuffixLines", () => {
    it("returns the new lines that appeared at the bottom of a repaint window", () => {
        expect(extractAppendedSuffixLines(["1", "2", "3"], ["2", "3", "4", "5"])).toEqual(["4", "5"]);
    });

    it("returns an empty list when snapshots do not overlap", () => {
        expect(extractAppendedSuffixLines(["1", "2", "3"], ["7", "8", "9"])).toEqual([]);
    });
});

describe("reconcileAgentTuiSnapshotHistory", () => {
    it("injects only lines that are no longer in the visible repaint window", () => {
        const first = reconcileAgentTuiSnapshotHistory([], 0, ["1", "2", "3", "4"], 20);
        expect(first).toEqual({
            history: ["1", "2", "3", "4"],
            injectedLineCount: 0,
            pendingLines: [],
        });

        const second = reconcileAgentTuiSnapshotHistory(first.history, first.injectedLineCount, ["3", "4", "5", "6"], 20);
        expect(second).toEqual({
            history: ["1", "2", "3", "4", "5", "6"],
            injectedLineCount: 2,
            pendingLines: ["1", "2"],
        });
    });

    it("continues cleanly when a second prompt starts a new visible segment", () => {
        const first = reconcileAgentTuiSnapshotHistory(["A1", "A2", "A3", "A4"], 1, ["A3", "A4"], 20);
        expect(first).toEqual({
            history: ["A1", "A2", "A3", "A4"],
            injectedLineCount: 2,
            pendingLines: ["A2"],
        });

        const second = reconcileAgentTuiSnapshotHistory(
            first.history,
            first.injectedLineCount,
            ["› second prompt", "B1", "B2"],
            20
        );
        expect(second).toEqual({
            history: ["A1", "A2", "A3", "A4", "› second prompt", "B1", "B2"],
            injectedLineCount: 4,
            pendingLines: ["A3", "A4"],
        });
    });

    it("anchors a repeated visible window even when the trailing prompt suggestion changes", () => {
        const result = reconcileAgentTuiSnapshotHistory(
            ["1", "2", "3", "4", "5", "old suggestion"],
            2,
            ["2", "3", "4", "5", "new suggestion"],
            20
        );
        expect(result).toEqual({
            history: ["1", "2", "3", "4", "5", "old suggestion", "new suggestion"],
            injectedLineCount: 2,
            pendingLines: [],
        });
    });

    it("keeps injected count aligned when old transcript is trimmed", () => {
        const result = reconcileAgentTuiSnapshotHistory(["1", "2", "3", "4"], 2, ["3", "4", "5", "6"], 5);
        expect(result).toEqual({
            history: ["2", "3", "4", "5", "6"],
            injectedLineCount: 1,
            pendingLines: [],
        });
    });
});

describe("extractAgentTuiHistoryLines", () => {
    it("drops shell and transient footer lines while preserving prompt context", () => {
        expect(
            extractAgentTuiHistoryLines([
                "Windows PowerShell",
                "版权所有 (C) Microsoft Corporation。保留所有权利。",
                "尝试新的跨平台 PowerShell https://aka.ms/pscore6",
                "PS C:\\Users\\yucohu> codex --no-alt-screen \"List the numbers\"",
                "╭─────────────────────────────────────────────╮",
                "│ >_ OpenAI Codex (v0.122.0)                  │",
                "╰─────────────────────────────────────────────╯",
                "› List the numbers",
                "Write tests for @filename",
                "  1",
                "  2",
                "gpt-5.4 xhigh · ~",
            ])
        ).toEqual([
                "› List the numbers",
                "  1",
                "  2",
        ]);
    });

    it("drops blank and transient UI lines for stable overlap matching", () => {
        expect(extractAgentTuiHistoryLines(["", "", "section a", "", "line 1", "", "", "line 2", "", ""])).toEqual([
            "section a",
            "line 1",
            "line 2",
        ]);
    });

    it("drops Codex chrome, status and suggestions", () => {
        expect(
            extractAgentTuiHistoryLines([
                "╭─────────────────────────────────────────────────╮",
                "│ ✨ Update available! 0.122.0 -> 0.123.0         │",
                "│ See full release notes:                         │",
                "│ >_ OpenAI Codex (v0.122.0)                  │",
                "│ model:     gpt-5.4 xhigh   /model to change │",
                "│ directory: ~                                │",
                "╰─────────────────────────────────────────────────╯",
                '                  > codex --no-alt-screen "Print lines"',
                "• Working (0s • esc to interrupt)",
                "Use /skills to list available skills",
                "› Explain this codebase",
                " Explain this codebase",
                "› Print lines",
                "• FIRST_ROUND_LINE_001",
                "  FIRST_ROUND_LINE_002",
            ])
        ).toEqual(["› Print lines", "• FIRST_ROUND_LINE_001", "  FIRST_ROUND_LINE_002"]);
    });
});
