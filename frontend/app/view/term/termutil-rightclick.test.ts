// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { shouldShowWaveContextMenu } from "./termutil";

describe("shouldShowWaveContextMenu", () => {
    it("yields the right-click to an app that is tracking the mouse in auto mode", () => {
        expect(shouldShowWaveContextMenu("auto", "vt200")).toBe(false);
        expect(shouldShowWaveContextMenu("auto", "drag")).toBe(false);
        expect(shouldShowWaveContextMenu("auto", "any")).toBe(false);
    });

    it("shows the Wave menu when no app is tracking the mouse in auto mode", () => {
        expect(shouldShowWaveContextMenu("auto", "none")).toBe(true);
        expect(shouldShowWaveContextMenu(undefined, undefined)).toBe(true);
        expect(shouldShowWaveContextMenu(null, null)).toBe(true);
    });

    it("honors the explicit settings", () => {
        expect(shouldShowWaveContextMenu("wave", "drag")).toBe(true);
        expect(shouldShowWaveContextMenu("app", "none")).toBe(false);
    });

    it("treats unknown settings as auto", () => {
        expect(shouldShowWaveContextMenu("bogus", "drag")).toBe(false);
        expect(shouldShowWaveContextMenu("bogus", "none")).toBe(true);
    });
});
