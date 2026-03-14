// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getWebPreviewDisplayUrl, WebViewPreviewFallback } from "./webview";

describe("webview preview fallback", () => {
    it("shows the requested URL", () => {
        const markup = renderToStaticMarkup(<WebViewPreviewFallback url="https://waveterm.dev/docs" />);

        expect(markup).toContain("electron webview unavailable");
        expect(markup).toContain("https://waveterm.dev/docs");
    });

    it("falls back to about:blank when no URL is available", () => {
        expect(getWebPreviewDisplayUrl("")).toBe("about:blank");
        expect(getWebPreviewDisplayUrl(null)).toBe("about:blank");
    });
});
