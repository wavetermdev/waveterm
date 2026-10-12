// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";

import { applyTmuxSessionChange, toggleTmuxSession } from "./tmux-session";

describe("toggleTmuxSession", () => {
    it("associates an unchecked session", () => {
        expect(toggleTmuxSession("", "mactop-3")).toBe("mactop-3");
        expect(toggleTmuxSession("workspace-8", "mactop-3")).toBe("mactop-3");
    });

    it("cancels the association when the checked session is selected again", () => {
        expect(toggleTmuxSession("mactop-3", "mactop-3")).toBe("");
    });
});

describe("applyTmuxSessionChange", () => {
    it("does nothing when the selected session is already active", async () => {
        const persistSession = vi.fn(async () => {});
        const restartController = vi.fn(async () => {});

        const changed = await applyTmuxSessionChange("mactop-3", "mactop-3", persistSession, restartController);

        expect(changed).toBe(false);
        expect(persistSession).not.toHaveBeenCalled();
        expect(restartController).not.toHaveBeenCalled();
    });

    it.each([
        ["cancel", "mactop-3", ""],
        ["switch", "mactop-3", "workspace-8"],
        ["associate", "", "mactop-3"],
    ])("persists and restarts when attempting to %s", async (_operation, currentSession, nextSession) => {
        const calls: string[] = [];
        const persistSession = vi.fn(async (session: string) => {
            calls.push(`persist:${session}`);
        });
        const restartController = vi.fn(async () => {
            calls.push("restart");
        });

        const changed = await applyTmuxSessionChange(currentSession, nextSession, persistSession, restartController);

        expect(changed).toBe(true);
        expect(calls).toEqual([`persist:${nextSession}`, "restart"]);
    });

    it("does not restart when persisting the session fails", async () => {
        const persistSession = vi.fn(async () => {
            throw new Error("set meta failed");
        });
        const restartController = vi.fn(async () => {});

        await expect(applyTmuxSessionChange("mactop-3", "", persistSession, restartController)).rejects.toThrow(
            "set meta failed"
        );
        expect(restartController).not.toHaveBeenCalled();
    });
});
