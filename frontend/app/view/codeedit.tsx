// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import "./codeedit.less";

import { globalStore } from "@/store/global";
import loader from "@monaco-editor/loader";
import { Editor, Monaco } from "@monaco-editor/react";
import * as jotai from "jotai";
import type * as MonacoTypes from "monaco-editor/esm/vs/editor/editor.api";
import * as React from "react";

// there is a global monaco variable (TODO get the correct TS type)
declare var monaco: Monaco;
let monacoLoadedAtom = jotai.atom(false);

function loadMonaco() {
    loader.config({ paths: { vs: "./monaco" } });
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
    };
    return opts;
}

interface CodeEditProps {
    readonly: boolean;
    text: string;
}

export function CodeEdit({ readonly, text }: CodeEditProps) {
    const divRef = React.useRef<HTMLDivElement>(null);
    const monacoRef = React.useRef<MonacoTypes.editor.IStandaloneCodeEditor | null>(null);
    const theme = "wave-theme-dark";
    const [divDims, setDivDims] = React.useState(null);
    const monacoLoaded = jotai.useAtomValue(monacoLoadedAtom);

    React.useEffect(() => {
        if (!divRef.current) {
            return;
        }
        const height = divRef.current.clientHeight;
        const width = divRef.current.clientWidth;
        setDivDims({ height, width });
    }, [divRef.current]);

    function handleEditorMount(editor: MonacoTypes.editor.IStandaloneCodeEditor) {
        monacoRef.current = editor;
        const monacoModel = editor.getModel();
        monaco.editor.setModelLanguage(monacoModel, "text/markdown");
    }

    function handleEditorChange(newText: string, ev: MonacoTypes.editor.IModelContentChangedEvent) {
        // TODO
    }

    const editorOpts = defaultEditorOptions();
    editorOpts.readOnly = readonly;

    return (
        <div className="codeedit" ref={divRef}>
            {divDims != null && monacoLoaded ? (
                <Editor
                    theme={theme}
                    height={divDims.height}
                    defaultLanguage={"text/markdown"}
                    value={text}
                    onMount={handleEditorMount}
                    options={editorOpts}
                    onChange={handleEditorChange}
                />
            ) : null}
        </div>
    );
}

interface CodeEditViewProps {
    readonly?: boolean;
    text: string;
}

export function CodeEditView({ readonly = false, text }: CodeEditViewProps) {
    return (
        <div className="view-codeedit">
            <CodeEdit readonly={readonly} text={text} />
        </div>
    );
}
