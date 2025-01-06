// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useOverrideConfigAtom } from "@/app/store/global";
import { boundNumber } from "@/util/util";
import loader from "@monaco-editor/loader";
import { Editor, Monaco } from "@monaco-editor/react";
import type * as MonacoTypes from "monaco-editor/esm/vs/editor/editor.api";
import { configureMonacoYaml } from "monaco-yaml";
import React, { useMemo, useRef } from "react";

import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import ymlWorker from "./yamlworker?worker";

import "./codeeditor.scss";

// there is a global monaco variable (TODO get the correct TS type)
declare var monaco: Monaco;

window.MonacoEnvironment = {
    getWorker(_, label) {
        if (label === "json") {
            return new jsonWorker();
        }
        if (label === "css" || label === "scss" || label === "less") {
            return new cssWorker();
        }
        if (label === "yaml" || label === "yml") {
            return new ymlWorker();
        }
        if (label === "html" || label === "handlebars" || label === "razor") {
            return new htmlWorker();
        }
        if (label === "typescript" || label === "javascript") {
            return new tsWorker();
        }
        return new editorWorker();
    },
};

export function loadMonaco() {
    loader.config({ paths: { vs: "monaco" } });
    loader
        .init()
        .then(() => {
            monaco.editor.defineTheme("wave-theme-dark", {
                base: "vs-dark",
                inherit: true,
                rules: [],
                colors: {
                    "editor.background": "#00000000",
                    "editorStickyScroll.background": "#00000055",
                    "minimap.background": "#00000077",
                    focusBorder: "#00000000",
                },
            });
            monaco.editor.defineTheme("wave-theme-light", {
                base: "vs",
                inherit: true,
                rules: [],
                colors: {
                    "editor.background": "#fefefe",
                    focusBorder: "#00000000",
                },
            });
            configureMonacoYaml(monaco, {
                validate: true,
                schemas: [],
            });
            // Disable default validation errors for typescript and javascript
            monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
                noSemanticValidation: true,
            });
            monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
                validate: true,
                allowComments: false, // Set to true if you want to allow comments in JSON
                schemas: [], // You can specify JSON schemas here if needed
            });
        })
        .catch((e) => {
            console.error("error loading monaco", e);
        });
}

function defaultEditorOptions(): MonacoTypes.editor.IEditorOptions {
    const opts: MonacoTypes.editor.IEditorOptions = {
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
        stickyScroll: {
            enabled: false,
        },
    };
    return opts;
}

interface CodeEditorProps {
    blockId: string;
    text: string;
    filename: string;
    language?: string;
    meta?: MetaType;
    onChange?: (text: string) => void;
    onMount?: (monacoPtr: MonacoTypes.editor.IStandaloneCodeEditor, monaco: Monaco) => () => void;
}

export function CodeEditor({ blockId, text, language, filename, meta, onChange, onMount }: CodeEditorProps) {
    const divRef = useRef<HTMLDivElement>(null);
    const unmountRef = useRef<() => void>(null);
    const minimapEnabled = useOverrideConfigAtom(blockId, "editor:minimapenabled") ?? false;
    const stickyScrollEnabled = useOverrideConfigAtom(blockId, "editor:stickyscrollenabled") ?? false;
    const wordWrap = useOverrideConfigAtom(blockId, "editor:wordwrap") ?? false;
    const fontSize = boundNumber(useOverrideConfigAtom(blockId, "editor:fontsize"), 6, 64);
    const theme = "wave-theme-dark";

    React.useEffect(() => {
        return () => {
            // unmount function
            if (unmountRef.current) {
                unmountRef.current();
            }
        };
    }, []);

    function handleEditorChange(text: string, ev: MonacoTypes.editor.IModelContentChangedEvent) {
        if (onChange) {
            onChange(text);
        }
    }

    function handleEditorOnMount(editor: MonacoTypes.editor.IStandaloneCodeEditor, monaco: Monaco) {
        if (onMount) {
            unmountRef.current = onMount(editor, monaco);
        }
    }

    const editorOpts = useMemo(() => {
        const opts = defaultEditorOptions();
        opts.minimap.enabled = minimapEnabled;
        opts.stickyScroll.enabled = stickyScrollEnabled;
        opts.wordWrap = wordWrap ? "on" : "off";
        opts.fontSize = fontSize;
        return opts;
    }, [minimapEnabled, stickyScrollEnabled, wordWrap, fontSize]);

    return (
        <div className="code-editor-wrapper">
            <div className="code-editor" ref={divRef}>
                <Editor
                    theme={theme}
                    value={text}
                    options={editorOpts}
                    onChange={handleEditorChange}
                    onMount={handleEditorOnMount}
                    path={filename}
                    language={language}
                />
            </div>
        </div>
    );
}
