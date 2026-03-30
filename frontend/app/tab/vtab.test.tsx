// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { VTab, VTabItem } from "./vtab";

const OriginalCss = globalThis.CSS;
const HexColorRegex = /^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i;

function renderVTab(tab: VTabItem): string {
    return renderToStaticMarkup(
        <VTab
            tab={tab}
            active={false}
            isDragging={false}
            isReordering={false}
            onSelect={() => null}
            onDragStart={() => null}
            onDragOver={() => null}
            onDrop={() => null}
            onDragEnd={() => null}
        />
    );
}

describe("VTab badges", () => {
    beforeAll(() => {
        globalThis.CSS = {
            supports: (_property: string, value: string) => HexColorRegex.test(value),
        } as typeof CSS;
    });

    afterAll(() => {
        globalThis.CSS = OriginalCss;
    });

    it("renders shared badges and a validated flag badge", () => {
        const markup = renderVTab({
            id: "tab-1",
            name: "Build Logs",
            badges: [{ badgeid: "badge-1", icon: "bell", color: "#f59e0b", priority: 2 }],
            flagColor: "#429DFF",
        });

        expect(markup).toContain("#429DFF");
        expect(markup).toContain("#f59e0b");
        expect(markup).toContain("rounded-full");
    });

    it("ignores invalid flag colors", () => {
        const markup = renderVTab({
            id: "tab-2",
            name: "Deploy",
            badges: [{ badgeid: "badge-2", icon: "bell", color: "#4ade80", priority: 2 }],
            flagColor: "definitely-not-a-color",
        });

        expect(markup).not.toContain("definitely-not-a-color");
        expect(markup).not.toContain("fa-flag");
        expect(markup).toContain("#4ade80");
    });
});
