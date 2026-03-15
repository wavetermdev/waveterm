// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { fetchPreviewFileSuggestions } from "@/app/view/preview/previewsuggestions";
import { describe, expect, it, vi } from "vitest";
import { makeMockWaveEnv } from "../mock/mockwaveenv";

describe("suggestion preview helpers", () => {
    it("anchors file suggestions at the mock home directory without a PreviewModel", async () => {
        const env = makeMockWaveEnv();
        const result = await fetchPreviewFileSuggestions(env, "", { widgetid: "widget-1", reqnum: 1 });

        expect(result.reqnum).toBe(1);
        expect(result.suggestions.some((suggestion) => suggestion["file:path"] === "/Users/mike/Documents")).toBe(true);
        expect(result.suggestions.some((suggestion) => suggestion["file:path"] === "/Users/mike/Desktop")).toBe(true);
    });

    it("supports relative and absolute file queries through the mock WaveEnv rpc", async () => {
        const env = makeMockWaveEnv();
        const relativeResult = await fetchPreviewFileSuggestions(env, "Documents/not", { widgetid: "widget-2", reqnum: 2 });
        const absoluteResult = await fetchPreviewFileSuggestions(env, "/Users/mike/Doc", {
            widgetid: "widget-3",
            reqnum: 3,
        });

        expect(relativeResult.suggestions.some((suggestion) => suggestion.display.startsWith("Documents/not"))).toBe(true);
        expect(
            absoluteResult.suggestions.some((suggestion) => suggestion.display.startsWith("/Users/mike/Documents"))
        ).toBe(true);
    });

    it("disposes suggestions through the extracted helper", async () => {
        const disposeSuggestionsCommand = vi.fn(async () => null);
        const env = makeMockWaveEnv({
            rpc: {
                DisposeSuggestionsCommand: disposeSuggestionsCommand,
            },
        });

        const result = await fetchPreviewFileSuggestions(
            env,
            "",
            { widgetid: "widget-4", reqnum: 4, dispose: true },
            { cwd: "~" }
        );

        expect(result).toBeNull();
        expect(disposeSuggestionsCommand).toHaveBeenCalledOnce();
    });
});
