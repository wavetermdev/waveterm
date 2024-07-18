// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/store/global";
import loader from "@monaco-editor/loader";
import { Editor, Monaco } from "@monaco-editor/react";
import * as jotai from "jotai";
import type * as MonacoTypes from "monaco-editor/esm/vs/editor/editor.api";
import { useEffect, useRef, useState } from "react";

import "./codeeditor.less";

// there is a global monaco variable (TODO get the correct TS type)
declare var monaco: Monaco;
let monacoLoadedAtom = jotai.atom(false);

function loadMonaco() {
    loader.config({ paths: { vs: "monaco" } });
    loader
        .init()
        .then(() => {
            monaco.editor.defineTheme("wave-theme-dark", {
                base: "hc-black",
                inherit: true,
                rules: [],
                colors: {
                    "editor.background": "#000000",
                },
            });
            monaco.editor.defineTheme("wave-theme-light", {
                base: "hc-light",
                inherit: true,
                rules: [],
                colors: {
                    "editor.background": "#fefefe",
                },
            });
            globalStore.set(monacoLoadedAtom, true);
            console.log("monaco loaded", monaco);
        })
        .catch((e) => {
            console.error("error loading monaco", e);
        });
}

// TODO: need to update these on theme change (pull from CSS vars)
document.addEventListener("DOMContentLoaded", () => {
    setTimeout(loadMonaco, 30);
});

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
    };
    return opts;
}

interface CodeEditProps {
    readonly?: boolean;
    text: string;
    language?: string;
    filename: string;
    onChange?: (text: string) => void;
}

export function CodeEditor({ readonly = false, text, language, filename, onChange }: CodeEditProps) {
    const [divDims, setDivDims] = useState(null);
    const monacoLoaded = jotai.useAtomValue(monacoLoadedAtom);

    const monacoRef = useRef<MonacoTypes.editor.IStandaloneCodeEditor | null>(null);
    const divRef = useRef<HTMLDivElement>(null);
    const monacoLoadedRef = useRef<boolean | null>(null);

    const theme = "wave-theme-dark";

    useEffect(() => {
        if (!divRef.current) {
            return;
        }
        const height = divRef.current.clientHeight;
        const width = divRef.current.clientWidth;
        setDivDims({ height, width });
    }, []);

    useEffect(() => {
        if (monacoLoadedRef.current === null) {
            monacoLoadedRef.current = monacoLoaded;
        }
    }, [monacoLoaded]);

    function handleEditorMount(editor: MonacoTypes.editor.IStandaloneCodeEditor) {
        monacoRef.current = editor;
        const monacoModel = editor.getModel();
        //monaco.editor.setModelLanguage(monacoModel, "text/markdown");
    }

    function handleEditorChange(text: string, ev: MonacoTypes.editor.IModelContentChangedEvent) {
        onChange(text);
    }

    const editorOpts = defaultEditorOptions();
    editorOpts.readOnly = readonly;

    return (
        <div className="code-editor-wrapper">
            <div className="code-editor" ref={divRef}>
                {divDims != null && monacoLoaded ? (
                    <Editor
                        theme={theme}
                        height={divDims.height}
                        value={text}
                        onMount={handleEditorMount}
                        options={editorOpts}
                        onChange={handleEditorChange}
                        path={filename}
                        language={language}
                    />
                ) : null}
            </div>
        </div>
    );
}
