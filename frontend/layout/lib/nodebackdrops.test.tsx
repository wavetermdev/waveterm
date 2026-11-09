// @vitest-environment jsdom
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NodeBackdrops } from "./nodebackdrops";

describe("NodeBackdrops", () => {
    let container: HTMLDivElement;
    let root: Root;
    let onMagnifyToggle: ReturnType<typeof vi.fn>;
    let onCloseEphemeral: ReturnType<typeof vi.fn>;

    function render(magnifiedNodeId?: string, ephemeralNodeId?: string) {
        act(() => {
            root.render(
                <NodeBackdrops
                    blockBlur={2}
                    magnifiedNodeId={magnifiedNodeId}
                    ephemeralNodeId={ephemeralNodeId}
                    onMagnifyToggle={onMagnifyToggle}
                    onCloseEphemeral={onCloseEphemeral}
                />
            );
        });
    }

    function advanceTime(ms: number) {
        act(() => vi.advanceTimersByTime(ms));
    }

    function magnifiedBackdrop() {
        return container.querySelector<HTMLDivElement>(".magnified-node-backdrop");
    }

    function ephemeralBackdrop() {
        return container.querySelector<HTMLDivElement>(".ephemeral-node-backdrop");
    }

    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
        onMagnifyToggle = vi.fn();
        onCloseEphemeral = vi.fn();
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it("delays newly magnified backdrops by 100ms and dismisses the matching node", () => {
        render();
        render("browser");

        advanceTime(99);
        expect(magnifiedBackdrop()).toBeNull();
        advanceTime(1);
        expect(magnifiedBackdrop()?.style.getPropertyValue("--block-blur")).toBe("2px");
        act(() => magnifiedBackdrop().click());
        expect(onMagnifyToggle).toHaveBeenCalledExactlyOnceWith("browser");
        expect(ephemeralBackdrop()).toBeNull();
    });

    it("does not leave a click-blocking backdrop after rapid unmagnification or closing", () => {
        render();
        render("browser");
        advanceTime(40);
        render();

        advanceTime(100);
        expect(magnifiedBackdrop()).toBeNull();
        expect(ephemeralBackdrop()).toBeNull();
    });

    it("does not let a canceled timer reveal a newly magnified node early", () => {
        render();
        render("browser");
        advanceTime(40);
        render();
        advanceTime(10);
        render("terminal");

        advanceTime(50);
        expect(magnifiedBackdrop()).toBeNull();
        advanceTime(50);
        expect(magnifiedBackdrop()).not.toBeNull();
        act(() => magnifiedBackdrop().click());
        expect(onMagnifyToggle).toHaveBeenCalledExactlyOnceWith("terminal");
    });

    it("cancels the pending timer when magnification clears", () => {
        render();
        render("browser");
        expect(vi.getTimerCount()).toBe(1);
        render();
        expect(vi.getTimerCount()).toBe(0);
    });

    it("cancels the pending timer on unmount", () => {
        render();
        render("browser");
        expect(vi.getTimerCount()).toBe(1);
        act(() => root.unmount());
        expect(vi.getTimerCount()).toBe(0);
        root = createRoot(container);
    });

    it("shows restored magnification immediately without an ephemeral backdrop", () => {
        render("browser");

        expect(magnifiedBackdrop()).not.toBeNull();
        expect(ephemeralBackdrop()).toBeNull();
        expect(vi.getTimerCount()).toBe(0);
        render();
        expect(magnifiedBackdrop()).toBeNull();
    });

    it("keeps ephemeral backdrops independent of the magnification delay", () => {
        render();
        render("browser", "preview");

        expect(magnifiedBackdrop()).toBeNull();
        expect(ephemeralBackdrop()).not.toBeNull();
        act(() => ephemeralBackdrop().click());
        expect(onCloseEphemeral).toHaveBeenCalledExactlyOnceWith("preview");
        render("browser");
        expect(ephemeralBackdrop()).toBeNull();

        advanceTime(100);
        expect(magnifiedBackdrop()).not.toBeNull();
        render(undefined, "preview");
        expect(magnifiedBackdrop()).toBeNull();
        expect(ephemeralBackdrop()).not.toBeNull();
        render();
        expect(ephemeralBackdrop()).toBeNull();
    });
});
