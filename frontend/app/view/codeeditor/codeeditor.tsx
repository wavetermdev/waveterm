// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useHeight } from "@/app/hook/useHeight";
import loader from "@monaco-editor/loader";
import { Editor, Monaco } from "@monaco-editor/react";
import type * as MonacoTypes from "monaco-editor/esm/vs/editor/editor.api";
import { useEffect, useRef } from "react";

import { adaptFromReactOrNativeKeyEvent, checkKeyPressed } from "@/util/keyutil";
import "./codeeditor.less";

// there is a global monaco variable (TODO get the correct TS type)
declare var monaco: Monaco;

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

interface CodeEditorProps {
    parentRef: React.MutableRefObject<HTMLDivElement>;
    text: string;
    filename: string;
    language?: string;
    onChange?: (text: string) => void;
    onSave?: () => void;
    onCancel?: () => void;
    onEdit?: () => void;
}

export function CodeEditor({
    parentRef,
    text,
    language,
    filename,
    onChange,
    onSave,
    onCancel,
    onEdit,
}: CodeEditorProps) {
    const divRef = useRef<HTMLDivElement>(null);

    const parentHeight = useHeight(parentRef);
    const theme = "wave-theme-dark";

    useEffect(() => {
        function handleKeyDown(e: KeyboardEvent) {
            const waveEvent = adaptFromReactOrNativeKeyEvent(e);
            if (onSave) {
                if (checkKeyPressed(waveEvent, "Cmd:s")) {
                    e.preventDefault();
                    onSave();
                    return;
                }
            }
            if (onCancel) {
                if (checkKeyPressed(waveEvent, "Cmd:r")) {
                    e.preventDefault();
                    onCancel();
                    return;
                }
            }
            if (onEdit) {
                if (checkKeyPressed(waveEvent, "Cmd:e")) {
                    e.preventDefault();
                    onEdit();
                    return;
                }
            }
        }

        const currentParentRef = parentRef.current;
        currentParentRef.addEventListener("keydown", handleKeyDown);

        return () => {
            currentParentRef.removeEventListener("keydown", handleKeyDown);
        };
    }, [onSave, onCancel, onEdit]);

    function handleEditorChange(text: string, ev: MonacoTypes.editor.IModelContentChangedEvent) {
        if (onChange) {
            onChange(text);
        }
    }

    function handleEditorOnMount(editor: MonacoTypes.editor.IStandaloneCodeEditor, monaco: Monaco) {
        // bind Cmd:e
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyE, () => {
            if (onEdit) {
                onEdit();
            }
        });
        // bind Cmd:s
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
            if (onSave) {
                onSave();
            }
        });
        // bind Cmd:r
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyR, () => {
            if (onCancel) {
                onCancel();
            }
        });
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
