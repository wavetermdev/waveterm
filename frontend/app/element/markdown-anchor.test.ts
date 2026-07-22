// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { pickCurrentAnchor } from "./markdown-anchor";

describe("pickCurrentAnchor", () => {
    it("returns null for empty", () => {
        expect(pickCurrentAnchor([], 100)).toBeNull();
    });
    it("returns first when all below viewport", () => {
        const items = [
            { href: "#a", top: 50 },
            { href: "#b", top: 120 },
        ];
        expect(pickCurrentAnchor(items, 0)).toBe("#a");
    });
    it("returns the last heading at/above viewport top", () => {
        const items = [
            { href: "#a", top: -30 },
            { href: "#b", top: 10 },
            { href: "#c", top: 200 },
        ];
        expect(pickCurrentAnchor(items, 12)).toBe("#b");
    });
});
