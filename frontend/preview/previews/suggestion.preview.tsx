// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockHeaderSuggestionControl } from "@/app/suggestion/suggestion";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import { fetchPreviewFileSuggestions, PreviewSuggestionsEnv } from "@/app/view/preview/previewsuggestions";
import { atom, useAtom } from "jotai";
import { useCallback, useRef } from "react";

const SuggestionOpenAtom = atom(true);
const SelectedPathAtom = atom("");

export function SuggestionPreview() {
    const env = useWaveEnv<PreviewSuggestionsEnv>();
    const blockRef = useRef<HTMLDivElement>(null);
    const [isOpen, setIsOpen] = useAtom(SuggestionOpenAtom);
    const [selectedPath, setSelectedPath] = useAtom(SelectedPathAtom);
    const fetchSuggestions = useCallback(
        (query: string, reqContext: SuggestionRequestContext) => {
            return fetchPreviewFileSuggestions(env, query, reqContext, { cwd: "~" });
        },
        [env]
    );

    return (
        <div className="flex w-full max-w-[960px] flex-col gap-4 px-6 py-6">
            <div className="text-xs text-muted font-mono">
                standalone file suggestions using the preview WaveEnv + mock filesystem (try: Documents/, ~/, /, rea)
            </div>
            <div ref={blockRef} className="w-full overflow-hidden rounded-lg border border-border bg-panel">
                <div data-role="block-header" className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                    <div className="flex flex-col">
                        <div className="text-sm font-semibold text-foreground">File Suggestion Control</div>
                        <div className="text-xs text-muted">Anchored at ~ when no explicit cwd is provided</div>
                    </div>
                    <button
                        className="rounded bg-accent/80 px-3 py-1.5 text-primary transition-colors hover:bg-accent cursor-pointer"
                        onClick={() => setIsOpen(!isOpen)}
                    >
                        {isOpen ? "Close" : "Open"} picker
                    </button>
                </div>
                <div className="flex min-h-[260px] flex-col gap-3 px-4 py-4 text-sm text-muted">
                    <div>
                        Selected path:{" "}
                        <span className="font-mono text-foreground">{selectedPath === "" ? "nothing selected yet" : selectedPath}</span>
                    </div>
                    <div>Press Tab to complete directories, or start with / to switch to an absolute-path search.</div>
                </div>
            </div>
            <BlockHeaderSuggestionControl
                blockRef={blockRef}
                openAtom={SuggestionOpenAtom}
                onClose={() => setIsOpen(false)}
                onSelect={(suggestion, query) => {
                    setSelectedPath(suggestion?.["file:path"] ?? query);
                    return true;
                }}
                onTab={(suggestion) => {
                    if (suggestion["file:mimetype"] === "directory") {
                        return suggestion["file:name"] + "/";
                    }
                    return suggestion["file:name"];
                }}
                fetchSuggestions={fetchSuggestions}
                placeholderText="Open File..."
            />
        </div>
    );
}
