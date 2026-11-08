// @vitest-environment jsdom
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMacOSFirstClickHandler } from "./macos-firstclick";

describe("macOS activation clicks", () => {
    let lastNativeFocusTime: number;
    let cleanup: () => void;
    let button: HTMLButtonElement;
    let onMouseDown: ReturnType<typeof vi.fn>;
    let onClick: ReturnType<typeof vi.fn>;
    let focusBlock: ReturnType<typeof vi.fn>;
    let focusAIPanel: ReturnType<typeof vi.fn>;
    let getLastNativeWindowFocusTime: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(1000000);
        lastNativeFocusTime = Date.now() - 1000;
        document.body.innerHTML = '<section data-blockid="browser"><button>Reload</button></section>';
        button = document.querySelector("button");
        onMouseDown = vi.fn();
        onClick = vi.fn();
        button.addEventListener("mousedown", onMouseDown);
        button.addEventListener("click", onClick);
        focusBlock = vi.fn();
        focusAIPanel = vi.fn();
        getLastNativeWindowFocusTime = vi.fn(() => lastNativeFocusTime);
        cleanup = installMacOSFirstClickHandler({
            getLastNativeWindowFocusTime,
            focusBlock,
            focusAIPanel,
        });
    });

    afterEach(() => {
        cleanup();
        document.body.innerHTML = "";
        vi.useRealTimers();
    });

    function click(target: Element = button) {
        const mouseDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true, detail: 1 });
        const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 });
        target.dispatchEvent(mouseDown);
        target.dispatchEvent(clickEvent);
        return { mouseDown, clickEvent };
    }

    function activateNativeWindow() {
        lastNativeFocusTime = Date.now();
        window.dispatchEvent(new FocusEvent("focus"));
    }

    it("allows toolbar clicks after renderer-only focus without native window activation", () => {
        window.dispatchEvent(new FocusEvent("focus"));

        const { mouseDown, clickEvent } = click();
        vi.advanceTimersByTime(10);

        expect(mouseDown.defaultPrevented).toBe(false);
        expect(clickEvent.defaultPrevented).toBe(false);
        expect(onMouseDown).toHaveBeenCalledTimes(1);
        expect(onClick).toHaveBeenCalledTimes(1);
        expect(focusBlock).not.toHaveBeenCalled();
    });

    it("keeps toolbar clicks responsive through repeated renderer-only focus changes", () => {
        for (let i = 0; i < 20; i++) {
            window.dispatchEvent(new FocusEvent("blur"));
            window.dispatchEvent(new FocusEvent("focus"));
            click();
            vi.advanceTimersByTime(12);
        }

        expect(onMouseDown).toHaveBeenCalledTimes(20);
        expect(onClick).toHaveBeenCalledTimes(20);
        expect(focusBlock).not.toHaveBeenCalled();
        expect(getLastNativeWindowFocusTime).toHaveBeenCalledTimes(20);
    });

    it("does not query the main process for clicks outside a renderer focus transition", () => {
        click();
        window.dispatchEvent(new FocusEvent("focus"));
        vi.advanceTimersByTime(50);
        click();
        click();

        expect(onClick).toHaveBeenCalledTimes(3);
        expect(getLastNativeWindowFocusTime).not.toHaveBeenCalled();
    });

    it("allows clicks when there is no native activation timestamp", () => {
        lastNativeFocusTime = null;
        window.dispatchEvent(new FocusEvent("focus"));

        click();

        expect(onClick).toHaveBeenCalledTimes(1);
        expect(focusBlock).not.toHaveBeenCalled();
        expect(getLastNativeWindowFocusTime).toHaveBeenCalledTimes(1);
    });

    it("still suppresses the activation click after its delayed focus blurs the renderer", () => {
        focusBlock.mockImplementation(() => window.dispatchEvent(new FocusEvent("blur")));
        activateNativeWindow();
        button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, detail: 1 }));

        vi.advanceTimersByTime(10);
        const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 });
        button.dispatchEvent(clickEvent);

        expect(focusBlock).toHaveBeenCalledExactlyOnceWith("browser");
        expect(clickEvent.defaultPrevented).toBe(true);
        expect(onClick).not.toHaveBeenCalled();
    });

    it("cancels delayed focus when the renderer loses focus before the timer runs", () => {
        activateNativeWindow();
        click();
        window.dispatchEvent(new FocusEvent("blur"));
        vi.advanceTimersByTime(10);

        expect(focusBlock).not.toHaveBeenCalled();
    });

    it("allows keyboard activation and cancels pending mouse focus", () => {
        activateNativeWindow();
        button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, detail: 1 }));
        button.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        button.click();
        vi.advanceTimersByTime(10);

        expect(onClick).toHaveBeenCalledTimes(1);
        expect(focusBlock).not.toHaveBeenCalled();
    });

    it("allows a programmatic click without consuming suppression of the physical activation click", () => {
        activateNativeWindow();
        button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, detail: 1 }));

        button.click();
        const clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 });
        button.dispatchEvent(clickEvent);

        expect(onClick).toHaveBeenCalledTimes(1);
        expect(clickEvent.defaultPrevented).toBe(true);
    });

    it("suppresses the activation click and focuses its browser pane", () => {
        activateNativeWindow();

        const { mouseDown, clickEvent } = click();
        vi.advanceTimersByTime(10);

        expect(mouseDown.defaultPrevented).toBe(true);
        expect(clickEvent.defaultPrevented).toBe(true);
        expect(onMouseDown).not.toHaveBeenCalled();
        expect(onClick).not.toHaveBeenCalled();
        expect(focusBlock).toHaveBeenCalledExactlyOnceWith("browser");
    });

    it("allows a second click during the same activation without later stealing its focus", () => {
        activateNativeWindow();
        click();
        vi.advanceTimersByTime(1);

        const { mouseDown, clickEvent } = click();
        vi.advanceTimersByTime(10);

        expect(mouseDown.defaultPrevented).toBe(false);
        expect(clickEvent.defaultPrevented).toBe(false);
        expect(onClick).toHaveBeenCalledTimes(1);
        expect(focusBlock).not.toHaveBeenCalled();
    });

    it("suppresses a new activation click after the window is reactivated", () => {
        activateNativeWindow();
        click();
        vi.advanceTimersByTime(100);

        activateNativeWindow();
        const { clickEvent } = click();
        vi.advanceTimersByTime(10);

        expect(clickEvent.defaultPrevented).toBe(true);
        expect(onClick).not.toHaveBeenCalled();
        expect(focusBlock).toHaveBeenCalledTimes(2);
    });

    it("does not extend the activation window when renderer focus changes", () => {
        activateNativeWindow();
        vi.advanceTimersByTime(50);
        window.dispatchEvent(new FocusEvent("focus"));

        const { clickEvent } = click();

        expect(clickEvent.defaultPrevented).toBe(false);
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("preserves activation-click handling for the AI panel", () => {
        document.querySelector("section").removeAttribute("data-blockid");
        document.querySelector("section").setAttribute("data-aipanel", "true");
        activateNativeWindow();

        click();
        vi.advanceTimersByTime(10);

        expect(focusAIPanel).toHaveBeenCalledTimes(1);
        expect(focusBlock).not.toHaveBeenCalled();
        expect(onClick).not.toHaveBeenCalled();
    });

    it("removes listeners and cancels delayed focus when disposed", () => {
        activateNativeWindow();
        click();

        cleanup();
        vi.advanceTimersByTime(10);
        click();

        expect(focusBlock).not.toHaveBeenCalled();
        expect(onClick).toHaveBeenCalledTimes(1);
    });
});
