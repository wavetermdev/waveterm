// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useHeight } from "@/app/hook/useHeight";
import loader from "@monaco-editor/loader";
import { Editor, Monaco } from "@monaco-editor/react";
import type * as MonacoTypes from "monaco-editor/esm/vs/editor/editor.api";
import React, { useRef } from "react";

import "./codeeditor.less";

// there is a global monaco variable (TODO get the correct TS type)
declare var monaco: Monaco;

export function loadMonaco() {
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
    };
    return opts;
}

interface CodeEditorProps {
    parentRef: React.MutableRefObject<HTMLDivElement>;
    text: string;
    filename: string;
    language?: string;
    onChange?: (text: string) => void;
    onMount?: (monacoPtr: MonacoTypes.editor.IStandaloneCodeEditor, monaco: Monaco) => () => void;
}

export function CodeEditor({ parentRef, text, language, filename, onChange, onMount }: CodeEditorProps) {
    const divRef = useRef<HTMLDivElement>(null);
    const unmountRef = useRef<() => void>(null);
    const parentHeight = useHeight(parentRef);
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

    const editorOpts = defaultEditorOptions();

    return (
        <div className="code-editor-wrapper">
            <div className="code-editor" ref={divRef}>
                <Editor
                    theme={theme}
                    height={parentHeight}
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
