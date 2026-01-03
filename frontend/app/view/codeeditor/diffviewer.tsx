// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { MonacoDiffViewer } from "@/app/monaco/monaco-react";
import { useOverrideConfigAtom } from "@/app/store/global";
import { boundNumber } from "@/util/util";
import type * as MonacoTypes from "monaco-editor";
import { useMemo, useRef } from "react";

interface DiffViewerProps {
    blockId: string;
    original: string;
    modified: string;
    language?: string;
    fileName: string;
}

function defaultDiffEditorOptions(): MonacoTypes.editor.IDiffEditorOptions {
    const opts: MonacoTypes.editor.IDiffEditorOptions = {
        scrollBeyondLastLine: false,
        fontSize: 12,
        fontFamily: "Hack",
        smoothScrolling: true,
        scrollbar: {
            useShadows: false,
            verticalScrollbarSize: 5,
            horizontalScrollbarSize: 5,
        },
        minimap: {
            enabled: true,
        },
        readOnly: true,
        renderSideBySide: true,
        originalEditable: false,
    };
    return opts;
}

export function DiffViewer({ blockId, original, modified, language, fileName }: DiffViewerProps) {
    const minimapEnabled = useOverrideConfigAtom(blockId, "editor:minimapenabled") ?? false;
    const fontSize = boundNumber(useOverrideConfigAtom(blockId, "editor:fontsize"), 6, 64);
    const inlineDiff = useOverrideConfigAtom(blockId, "editor:inlinediff");
    const theme = "wave-theme-dark";
    const uuidRef = useRef(crypto.randomUUID()).current;
    let editorPath: string;
    if (fileName) {
        const separator = fileName.startsWith("/") ? "" : "/";
        editorPath = blockId + separator + fileName;
    } else {
        editorPath = uuidRef;
    }

    const editorOpts = useMemo(() => {
        const opts = defaultDiffEditorOptions();
        opts.minimap.enabled = minimapEnabled;
        opts.fontSize = fontSize;
        if (inlineDiff != null) {
            opts.renderSideBySide = !inlineDiff;
        }
        return opts;
    }, [minimapEnabled, fontSize, inlineDiff]);

    return (
        <div className="flex flex-col w-full h-full overflow-hidden items-center justify-center">
            <div className="flex flex-col h-full w-full">
                <MonacoDiffViewer
                    theme={theme}
                    path={editorPath}
                    original={original}
                    modified={modified}
                    options={editorOpts}
                    language={language}
                />
            </div>
        </div>
    );
}
