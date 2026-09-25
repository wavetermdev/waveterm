// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { makeTermLinkHandlers } from "./term-links";

function linkEvent(metaKey = false, ctrlKey = false): MouseEvent {
    return { metaKey, ctrlKey, preventDefault: vi.fn(), clientX: 12, clientY: 34 } as unknown as MouseEvent;
}

describe("terminal link handlers", () => {
    it.each([
        { isMacOS: true, modifier: "metaKey" },
        { isMacOS: false, modifier: "ctrlKey" },
    ])("only opens $modifier-clicked links on the corresponding platform", ({ isMacOS }) => {
        const openUri = vi.fn();
        const handlers = makeTermLinkHandlers(isMacOS, openUri, vi.fn());
        const plainClick = linkEvent();
        handlers.activate(plainClick, "https://example.com/first");
        expect(plainClick.preventDefault).toHaveBeenCalledOnce();
        expect(openUri).not.toHaveBeenCalled();

        const wrongModifier = linkEvent(!isMacOS, isMacOS);
        handlers.activate(wrongModifier, "https://example.com/second");
        expect(openUri).not.toHaveBeenCalled();

        const rightModifier = linkEvent(isMacOS, !isMacOS);
        handlers.activate(rightModifier, "https://example.com/third");
        expect(openUri).toHaveBeenCalledExactlyOnceWith("https://example.com/third");
    });

    it("reports hovered links and clears them on leave", () => {
        const onHover = vi.fn();
        const handlers = makeTermLinkHandlers(false, vi.fn(), onHover);
        handlers.hover(linkEvent(), "https://example.com");
        handlers.leave();
        expect(onHover.mock.calls).toEqual([
            ["https://example.com", 12, 34],
            [null, 0, 0],
        ]);
    });
});
