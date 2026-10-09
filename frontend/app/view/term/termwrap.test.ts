// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("TermWrap IME data ordering", () => {
    let originalDocument: Document;

    beforeEach(() => {
        vi.useFakeTimers();
        originalDocument = globalThis.document;
        vi.stubGlobal("document", {
            createElement: () => ({
                getContext: () => null,
            }),
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        if (originalDocument != null) {
            vi.stubGlobal("document", originalDocument);
        }
        vi.resetModules();
    });

    async function makeTermWrapHarness() {
        const { TermWrap } = await import("./termwrap");
        const sent: string[] = [];
        const termWrap = Object.create(TermWrap.prototype) as InstanceType<typeof TermWrap>;

        termWrap.loaded = true;
        termWrap.disposed = false;
        termWrap.compositionActive = false;
        termWrap.compositionRecentlyEndedUntil = 0;
        termWrap.pendingCompositionSuffix = null;
        termWrap.sendDataHandler = (data: string) => sent.push(data);
        termWrap.multiInputCallback = null;

        return { sent, termWrap };
    }

    it("sends Enter after committed IME text when Enter arrives during composition", async () => {
        const { sent, termWrap } = await makeTermWrapHarness();

        termWrap.compositionActive = true;
        termWrap.handleTermData("\r");
        expect(sent).toEqual([]);

        termWrap.compositionActive = false;
        termWrap.compositionRecentlyEndedUntil = Date.now() + 75;
        termWrap.handleTermData("가");

        expect(sent).toEqual(["가", "\r"]);
    });

    it("flushes a deferred Enter if composition ends without committed text", async () => {
        const { sent, termWrap } = await makeTermWrapHarness();

        termWrap.compositionActive = true;
        termWrap.handleTermData("\r");
        termWrap.compositionActive = false;
        termWrap.schedulePendingCompositionSuffixFlush();

        vi.advanceTimersByTime(30);

        expect(sent).toEqual(["\r"]);
    });

    it("does not defer ordinary ASCII data while composition is active", async () => {
        const { sent, termWrap } = await makeTermWrapHarness();

        termWrap.compositionActive = true;
        termWrap.handleTermData("hello");

        expect(sent).toEqual(["hello"]);
    });

    it("does not treat a full ASCII line as a composition suffix", async () => {
        const { sent, termWrap } = await makeTermWrapHarness();

        termWrap.compositionRecentlyEndedUntil = Date.now() + 75;
        termWrap.handleTermData("previous sentence");

        expect(sent).toEqual(["previous sentence"]);
    });
});
