import { describe, expect, it } from "vitest";

import { getWheelLineDelta } from "./termutil";

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
