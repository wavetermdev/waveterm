// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useHeight } from "@/app/hook/useHeight";
import { useWidth } from "@/app/hook/useWidth";
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
                base: "vs-dark",
                inherit: true,
                rules: [],
                colors: {
                    "editor.background": "#00000000",
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

            // Disable default validation errors for typescript and javascript
            monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
                noSemanticValidation: true,
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
    const parentWidth = useWidth(parentRef);
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
                    value={text}
                    options={editorOpts}
                    height={parentHeight}
                    width={parentWidth}
                    onChange={handleEditorChange}
                    onMount={handleEditorOnMount}
                    path={filename}
                    language={language}
                />
            </div>
        </div>
    );
}
