// @vitest-environment jsdom
// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { act, useLayoutEffect, useMemo, useState } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBlockFocus } from "./blockfocus";

type TestPaneProps = {
    blockId: string;
    selected: string;
    select: (blockId: string) => void;
    giveFocus: () => boolean;
};

function TestPane({ blockId, selected, select, giveFocus }: TestPaneProps) {
    const nodeModel = useMemo(() => ({ blockId, focusNode: () => select(blockId) }), [blockId, select]);
    const viewModel = useMemo(() => ({ giveFocus }), [giveFocus]);
    const { focusElemRef, handleClick, handleFocusCapture } = useBlockFocus(nodeModel, viewModel, selected === blockId);
    return (
        <section
            data-blockid={blockId}
            data-selected={selected === blockId}
            onClick={handleClick}
            onFocusCapture={handleFocusCapture}
        >
            <header data-testid={`${blockId}-header`}>
                <input aria-label={`${blockId} address`} />
                <button type="button">Reload</button>
            </header>
            <input ref={focusElemRef} data-testid={`${blockId}-fallback`} />
            <button type="button" data-testid={`${blockId}-content`}>
                Web content
            </button>
        </section>
    );
}

function FocusAfterMount() {
    useLayoutEffect(() => {
        document.querySelector<HTMLInputElement>('[aria-label="b address"]').focus();
    }, []);
    return null;
}

describe("block focus ownership", () => {
    let container: HTMLDivElement;
    let root: Root;
    let selectPane: (blockId: string) => void;
    let frames: Map<number, FrameRequestCallback>;
    let nextFrame: number;

    beforeEach(() => {
        vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
        frames = new Map();
        nextFrame = 0;
        vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
            frames.set(++nextFrame, callback);
            return nextFrame;
        });
        vi.stubGlobal("cancelAnimationFrame", (frame: number) => frames.delete(frame));
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
        vi.unstubAllGlobals();
    });

    function contentFocus(blockId: string) {
        return vi.fn(() => {
            container.querySelector<HTMLButtonElement>(`[data-testid="${blockId}-content"]`).focus();
            return true;
        });
    }

    async function renderPanes(
        giveFocusA = contentFocus("a"),
        giveFocusB = contentFocus("b"),
        focusAfterMount = false
    ) {
        function TestLayout() {
            const [selected, setSelected] = useState("a");
            selectPane = setSelected;
            return (
                <>
                    <TestPane blockId="a" selected={selected} select={setSelected} giveFocus={giveFocusA} />
                    <TestPane blockId="b" selected={selected} select={setSelected} giveFocus={giveFocusB} />
                    {focusAfterMount && <FocusAfterMount />}
                </>
            );
        }
        await act(async () => root.render(<TestLayout />));
    }

    async function flushFrames() {
        const queued = [...frames.values()];
        frames.clear();
        await act(async () => queued.forEach((callback) => callback(0)));
    }

    function address(blockId: string) {
        return container.querySelector<HTMLInputElement>(`[aria-label="${blockId} address"]`);
    }

    it("does not reclaim focus when another pane receives focus during the same commit", async () => {
        await renderPanes(contentFocus("a"), contentFocus("b"), true);

        expect(document.activeElement).toBe(address("b"));
        expect(container.querySelector('[data-blockid="b"]').getAttribute("data-selected")).toBe("true");
    });

    it("preserves address-bar focus while clicking between browser panes", async () => {
        await renderPanes();

        for (const blockId of ["b", "a", "b"]) {
            await act(async () => {
                address(blockId).focus();
                address(blockId).click();
            });
            expect(document.activeElement).toBe(address(blockId));
            expect(container.querySelector(`[data-blockid="${blockId}"]`).getAttribute("data-selected")).toBe("true");
        }
    });

    it("selects an unfocused pane when its non-focusable header is clicked", async () => {
        await renderPanes();

        await act(async () => container.querySelector<HTMLElement>('[data-testid="b-header"]').click());

        expect(container.querySelector('[data-blockid="b"]').getAttribute("data-selected")).toBe("true");
        expect(document.activeElement).toBe(container.querySelector('[data-testid="b-content"]'));
    });

    it("moves DOM focus to the pane selected by a keyboard action", async () => {
        const giveFocusA = contentFocus("a");
        await renderPanes(giveFocusA);
        giveFocusA.mockClear();

        await act(async () => selectPane("b"));

        expect(document.activeElement).toBe(container.querySelector('[data-testid="b-content"]'));
        expect(giveFocusA).not.toHaveBeenCalled();
    });

    it("does not let a deferred focus retry take focus from the address bar", async () => {
        const giveFocusA = vi.fn(() => false);
        await renderPanes(giveFocusA);
        expect(frames.size).toBe(1);
        expect(document.activeElement).toBe(container.querySelector('[data-testid="a-fallback"]'));

        await act(async () => address("a").focus());
        await flushFrames();

        expect(document.activeElement).toBe(address("a"));
        expect(giveFocusA).toHaveBeenCalledTimes(1);
    });

    it("cancels a deferred focus retry when its pane loses selection", async () => {
        const giveFocusA = vi.fn(() => false);
        await renderPanes(giveFocusA);

        await act(async () => selectPane("b"));
        await flushFrames();

        expect(frames.size).toBe(0);
        expect(document.activeElement).toBe(container.querySelector('[data-testid="b-content"]'));
        expect(giveFocusA).toHaveBeenCalledTimes(1);
    });

    it("retries view focus when the fallback input still owns focus", async () => {
        const giveFocusA = vi.fn(() => false);
        await renderPanes(giveFocusA);

        await flushFrames();

        expect(giveFocusA).toHaveBeenCalledTimes(2);
    });
});
