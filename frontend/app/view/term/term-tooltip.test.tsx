// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TermLinkTooltipContent } from "./term-tooltip";

describe("TermLinkTooltipContent", () => {
    it("keeps the existing modifier-click hint for plain URLs", () => {
        const markup = renderToStaticMarkup(<TermLinkTooltipContent />);
        expect(markup).toContain("-click to open link");
        expect(markup).not.toContain("break-all");
    });

    it("shows and safely escapes the destination for OSC 8 links", () => {
        const markup = renderToStaticMarkup(<TermLinkTooltipContent url="https://example.com/?next=<script>&x=1" />);
        expect(markup).toContain("-click to open link");
        expect(markup).toContain("https://example.com/?next=&lt;script&gt;&amp;x=1");
        expect(markup).toContain("break-all");
        expect(markup).not.toContain("<script>");
    });
});
