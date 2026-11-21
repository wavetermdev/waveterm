// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TermWrap, isCompositionSuffixData } from "./termwrap";

function makeFakeTermWrap(): TermWrap & { sent: string[] } {
    const tw = Object.create(TermWrap.prototype) as TermWrap & { sent: string[] };
    tw.loaded = true;
    tw.compositionActive = false;
    tw.compositionRecentlyEndedUntil = Date.now() + 75;
    tw.pendingCompositionSuffix = null;
    tw.sent = [];
    tw.sendDataHandler = (d: string) => tw.sent.push(d);
    tw.multiInputCallback = () => {};
    return tw;
}

describe("isCompositionSuffixData", () => {
    it("accepts short printable ASCII terminators only", () => {
        expect(isCompositionSuffixData(" ")).toBe(true);
        expect(isCompositionSuffixData("?")).toBe(true);
        expect(isCompositionSuffixData(",")).toBe(true);
        expect(isCompositionSuffixData("\uACE0")).toBe(false);
        expect(isCompositionSuffixData("\r")).toBe(false);
        expect(isCompositionSuffixData("toolong")).toBe(false);
    });
});

describe("TermWrap composition ordering", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
    });

    it("puts a terminator behind the syllable it followed (Windows order)", () => {
        const tw = makeFakeTermWrap();
        tw.handleTermData(" ");
        expect(tw.sent).toEqual([]);
        tw.handleTermData("\uACE0");
        expect(tw.sent.join("")).toBe("\uACE0 ");
    });

    it("drops the duplicated terminator in the late textarea re-read", () => {
        const tw = makeFakeTermWrap();
        tw.handleTermData("?");
        tw.handleTermData("\uB2E4?");
        expect(tw.sent.join("")).toBe("\uB2E4?");
    });

    it("does not hold ordinary keystrokes outside the commit window", () => {
        const tw = makeFakeTermWrap();
        tw.compositionRecentlyEndedUntil = 0;
        tw.handleTermData("abc");
        expect(tw.sent).toEqual(["abc"]);
    });

    it("flushes a held terminator when nothing follows", () => {
        const tw = makeFakeTermWrap();
        tw.handleTermData(" ");
        vi.advanceTimersByTime(40);
        expect(tw.sent).toEqual([" "]);
    });

    it("flushes a held terminator before pasted text", () => {
        const tw = makeFakeTermWrap();
        tw.handleTermData(" ");
        tw.pasteDispatching = true;
        tw.handleTermData("\uBD99\uC5EC\uB123\uAE30 ");
        expect(tw.sent.join("")).toBe(" \uBD99\uC5EC\uB123\uAE30 ");
    });

    it("sends a held terminator to the multi-input recipients captured at keystroke time", () => {
        const tw = makeFakeTermWrap();
        const atKeystroke = vi.fn();
        const laterRetarget = vi.fn();
        tw.multiInputCallback = atKeystroke;
        tw.handleTermData(" ");
        tw.multiInputCallback = laterRetarget;
        vi.advanceTimersByTime(40);
        expect(tw.sent).toEqual([" "]);
        expect(atKeystroke).toHaveBeenCalledWith(" ");
        expect(laterRetarget).not.toHaveBeenCalled();
    });

    it("keeps a held terminator away from multi-input enabled after the keystroke", () => {
        const tw = makeFakeTermWrap();
        const laterEnabled = vi.fn();
        (tw as any).multiInputCallback = undefined;
        tw.handleTermData(" ");
        tw.multiInputCallback = laterEnabled;
        vi.advanceTimersByTime(40);
        expect(tw.sent).toEqual([" "]);
        expect(laterEnabled).not.toHaveBeenCalled();
    });

    it("does not merge suffix chunks produced for different multi-input recipients", () => {
        const tw = makeFakeTermWrap();
        const first = vi.fn();
        const second = vi.fn();
        tw.multiInputCallback = first;
        tw.handleTermData(" ");
        tw.multiInputCallback = second;
        tw.handleTermData("?");
        expect(tw.sent).toEqual([" "]);
        vi.advanceTimersByTime(40);
        expect(tw.sent).toEqual([" ", "?"]);
        expect(first).toHaveBeenCalledWith(" ");
        expect(second).toHaveBeenCalledWith("?");
    });
});
