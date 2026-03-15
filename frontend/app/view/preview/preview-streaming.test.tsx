// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Provider, atom } from "jotai";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StreamingPreview } from "./preview-streaming";

vi.mock("@/util/endpoints", () => ({
    getWebServerEndpoint: () => "http://wave.test",
}));

vi.mock("@/util/waveutil", () => ({
    formatRemoteUri: (path: string, conn: string) => `wsh://${conn}${path}`,
}));

describe("StreamingPreview", () => {
    it("renders PDFs with an object/embed viewer instead of an iframe", () => {
        const model = {
            refreshCallback: null,
            refreshVersion: atom(0),
            connection: atom("local"),
            statFile: atom({
                path: "/docs/guide.pdf",
                mimetype: "application/pdf",
            }),
        };

        const markup = renderToStaticMarkup(
            <Provider>
                <StreamingPreview model={model as any} parentRef={{ current: null }} />
            </Provider>
        );

        expect(markup).toContain("<object");
        expect(markup).toContain("<embed");
        expect(markup).not.toContain("<iframe");
        expect(markup).toContain("http://wave.test/wave/stream-file?path=wsh%3A%2F%2Flocal%2Fdocs%2Fguide.pdf");
    });
});
