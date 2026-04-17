import { describe, expect, it } from "vitest";

import {
    computeResizePreserveScrollback,
    DefaultTermScrollback,
    getAlternateWheelInputSequence,
    getWheelLineDelta,
    MaxTermScrollback,
    normalizeTermScrollback,
    shouldHandleTerminalWheel,
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

    it("handles alternate-buffer wheel for full-screen terminal apps", () => {
        expect(shouldHandleTerminalWheel(false, "alternate")).toBe(true);
    });

    it("does not handle already-cancelled wheel events", () => {
        expect(shouldHandleTerminalWheel(true, "normal")).toBe(false);
    });
});

describe("getAlternateWheelInputSequence", () => {
    it("maps upward wheel movement to PageUp", () => {
        expect(getAlternateWheelInputSequence(-1)).toBe("\x1b[5~");
    });

    it("maps downward wheel movement to PageDown", () => {
        expect(getAlternateWheelInputSequence(1)).toBe("\x1b[6~");
    });

    it("scales large wheel deltas into multiple page inputs", () => {
        expect(getAlternateWheelInputSequence(-12)).toBe("\x1b[5~\x1b[5~");
    });

    it("ignores invalid wheel deltas", () => {
        expect(getAlternateWheelInputSequence(0)).toBe("");
        expect(getAlternateWheelInputSequence(Number.NaN)).toBe("");
    });
});
