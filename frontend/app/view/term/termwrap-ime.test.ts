// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { isImeCompositionEvent, makeCustomKeyEventHandler } from "./termwrap";

function createKeyEvent(opts: Partial<KeyboardEvent>): KeyboardEvent {
    return {
        isComposing: false,
        key: "",
        code: "",
        keyCode: 0,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        shiftKey: false,
        ...opts,
    } as unknown as KeyboardEvent;
}

describe("isImeCompositionEvent", () => {
    it("identifies space pressed during IME composition", () => {
        const ev = createKeyEvent({
            isComposing: true,
            key: " ",
            code: "Space",
            keyCode: 32,
        });
        expect(isImeCompositionEvent(ev)).toBe(true);
    });

    it("identifies enter and punctuation keys pressed during IME composition", () => {
        expect(isImeCompositionEvent(createKeyEvent({ isComposing: true, key: "Enter", keyCode: 13 }))).toBe(true);
        expect(isImeCompositionEvent(createKeyEvent({ isComposing: true, key: ".", keyCode: 190 }))).toBe(true);
        expect(isImeCompositionEvent(createKeyEvent({ isComposing: true, key: ",", keyCode: 188 }))).toBe(true);
        expect(isImeCompositionEvent(createKeyEvent({ isComposing: true, key: "?", keyCode: 191 }))).toBe(true);
    });

    it("identifies process key and keyCode 229 as IME composition", () => {
        expect(isImeCompositionEvent(createKeyEvent({ key: "Process", keyCode: 229 }))).toBe(true);
        expect(isImeCompositionEvent(createKeyEvent({ key: "Process", keyCode: 0 }))).toBe(true);
        expect(isImeCompositionEvent(createKeyEvent({ key: "Unidentified", keyCode: 229 }))).toBe(true);
    });

    it("does not treat modifier combinations as IME composition", () => {
        expect(isImeCompositionEvent(createKeyEvent({ isComposing: true, ctrlKey: true, key: "c", keyCode: 67 }))).toBe(
            false
        );
        expect(isImeCompositionEvent(createKeyEvent({ isComposing: true, metaKey: true, key: "v", keyCode: 86 }))).toBe(
            false
        );
        expect(isImeCompositionEvent(createKeyEvent({ isComposing: true, altKey: true, key: "a", keyCode: 65 }))).toBe(
            false
        );
        expect(isImeCompositionEvent(createKeyEvent({ keyCode: 229, ctrlKey: true }))).toBe(false);
    });

    it("returns false for regular keystrokes outside composition", () => {
        expect(isImeCompositionEvent(createKeyEvent({ isComposing: false, key: "a", keyCode: 65 }))).toBe(false);
        expect(isImeCompositionEvent(createKeyEvent({ isComposing: false, key: " ", keyCode: 32 }))).toBe(false);
        expect(isImeCompositionEvent(createKeyEvent({ isComposing: false, key: "Enter", keyCode: 13 }))).toBe(false);
    });
});

describe("makeCustomKeyEventHandler", () => {
    it("returns false for space pressed during composition without calling keydownHandler", () => {
        const keydownHandler = vi.fn();
        const handler = makeCustomKeyEventHandler(keydownHandler);
        const ev = createKeyEvent({
            isComposing: true,
            key: " ",
            code: "Space",
            keyCode: 32,
        });

        const result = handler(ev);
        expect(result).toBe(false);
        expect(keydownHandler).not.toHaveBeenCalled();
    });

    it("returns false for IME process events without calling keydownHandler", () => {
        const keydownHandler = vi.fn();
        const handler = makeCustomKeyEventHandler(keydownHandler);
        const ev = createKeyEvent({
            key: "Process",
            keyCode: 229,
        });

        const result = handler(ev);
        expect(result).toBe(false);
        expect(keydownHandler).not.toHaveBeenCalled();
    });

    it("delegates normal keystrokes to keydownHandler", () => {
        const keydownHandler = vi.fn().mockReturnValue(false);
        const handler = makeCustomKeyEventHandler(keydownHandler);
        const ev = createKeyEvent({
            isComposing: false,
            key: "Enter",
            keyCode: 13,
            shiftKey: true,
        });

        const result = handler(ev);
        expect(result).toBe(false);
        expect(keydownHandler).toHaveBeenCalledWith(ev);
    });

    it("returns true for normal keystrokes when keydownHandler is undefined", () => {
        const handler = makeCustomKeyEventHandler(undefined);
        const ev = createKeyEvent({
            isComposing: false,
            key: "a",
            keyCode: 65,
        });

        const result = handler(ev);
        expect(result).toBe(true);
    });

    it("delegates modifier shortcuts to keydownHandler even if keyCode is 229", () => {
        const keydownHandler = vi.fn().mockReturnValue(true);
        const handler = makeCustomKeyEventHandler(keydownHandler);
        const ev = createKeyEvent({
            keyCode: 229,
            ctrlKey: true,
            key: "c",
        });

        const result = handler(ev);
        expect(result).toBe(true);
        expect(keydownHandler).toHaveBeenCalledWith(ev);
    });
});
