// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { nextDisplayOrder, sortBookmarks } from "./bookmarksmodel";

describe("sortBookmarks", () => {
    it("returns [] for null", () => {
        expect(sortBookmarks(null)).toEqual([]);
    });
    it("sorts by display:order ascending", () => {
        const map = {
            b: { bookmarktype: "folder", label: "B", path: "/b", "display:order": 2 } as any,
            a: { bookmarktype: "folder", label: "A", path: "/a", "display:order": 1 } as any,
        };
        const out = sortBookmarks(map);
        expect(out.map((e) => e.key)).toEqual(["a", "b"]);
    });
});

describe("nextDisplayOrder", () => {
    it("returns 1 for empty", () => {
        expect(nextDisplayOrder([])).toBe(1);
    });
    it("returns max+1", () => {
        expect(nextDisplayOrder([{ key: "x", "display:order": 4 } as any])).toBe(5);
    });
});
