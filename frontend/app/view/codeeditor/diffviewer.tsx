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

const extToLanguage: Record<string, string> = {
    ts: "typescript", tsx: "typescriptreact",
    js: "javascript", jsx: "javascriptreact",
    php: "php", vue: "html",
    py: "python", rb: "ruby",
    go: "go", rs: "rust", java: "java",
    css: "css", scss: "scss", less: "less",
    html: "html", json: "json",
    yaml: "yaml", yml: "yaml",
    md: "markdown", sql: "sql",
    sh: "shell", bash: "shell", zsh: "shell",
    xml: "xml", svg: "xml",
    c: "c", cpp: "cpp", h: "c",
    cs: "csharp", swift: "swift", kt: "kotlin",
    blade: "html",
};

function getLanguageFromFileName(fileName: string): string | undefined {
    const ext = fileName.split(".").pop()?.toLowerCase();
    // Handle compound extensions like .blade.php
    const parts = fileName.split(".");
    if (parts.length >= 3) {
        const compound = parts.slice(-2).join(".");
        if (compound === "blade.php") return "html";
    }
    return ext ? extToLanguage[ext] : undefined;
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
                    path={editorPath}
                    original={original}
                    modified={modified}
                    options={editorOpts}
                    language={language ?? getLanguageFromFileName(fileName)}
                />
            </div>
        </div>
    );
}
