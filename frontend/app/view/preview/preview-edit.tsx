// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { tryReinjectKey } from "@/app/store/keymodel";
import { CodeEditor } from "@/app/view/codeeditor/codeeditor";
import { adaptFromReactOrNativeKeyEvent, checkKeyPressed } from "@/util/keyutil";
import { fireAndForget } from "@/util/util";
import { useAtomValue, useSetAtom } from "jotai";
import type * as MonacoTypes from "monaco-editor";
import * as monaco from "monaco-editor";
import { useEffect } from "react";
import type { SpecializedViewProps } from "./preview";

export const shellFileMap: Record<string, string> = {
    ".bashrc": "shell",
    ".bash_profile": "shell",
    ".bash_login": "shell",
    ".bash_logout": "shell",
    ".profile": "shell",
    ".zshrc": "shell",
    ".zprofile": "shell",
    ".zshenv": "shell",
    ".zlogin": "shell",
    ".zlogout": "shell",
    ".kshrc": "shell",
    ".cshrc": "shell",
    ".tcshrc": "shell",
    ".xonshrc": "python",
    ".shrc": "shell",
    ".aliases": "shell",
    ".functions": "shell",
    ".exports": "shell",
    ".direnvrc": "shell",
    ".vimrc": "shell",
    ".gvimrc": "shell",
};

function CodeEditPreview({ model }: SpecializedViewProps) {
    const fileContent = useAtomValue(model.fileContent);
    const setNewFileContent = useSetAtom(model.newFileContent);
    const fileInfo = useAtomValue(model.statFile);
    const fileName = fileInfo?.path || fileInfo?.name;
    const blockData = useAtomValue(model.blockAtom);
    const lineVal = blockData?.meta?.["editor:line"];

    const baseName = fileName ? fileName.split("/").pop() : null;
    const language = baseName && shellFileMap[baseName] ? shellFileMap[baseName] : undefined;

    function codeEditKeyDownHandler(e: WaveKeyboardEvent): boolean {
        if (checkKeyPressed(e, "Cmd:e")) {
            fireAndForget(() => model.setEditMode(false));
            return true;
        }
        if (checkKeyPressed(e, "Cmd:s") || checkKeyPressed(e, "Ctrl:s")) {
            fireAndForget(model.handleFileSave.bind(model));
            return true;
        }
        if (checkKeyPressed(e, "Cmd:r")) {
            fireAndForget(model.handleFileRevert.bind(model));
            return true;
        }
        return false;
    }

    useEffect(() => {
        model.codeEditKeyDownHandler = codeEditKeyDownHandler;
        model.refreshCallback = () => {
            globalStore.set(model.refreshVersion, (v) => v + 1);
        };
        return () => {
            model.codeEditKeyDownHandler = null;
            model.monacoRef.current = null;
            model.refreshCallback = null;
        };
    }, []);

    useEffect(() => {
        const editor = model.monacoRef.current;
        if (editor && lineVal) {
            const lineNum = typeof lineVal === "number" ? lineVal : parseInt(lineVal, 10);
            if (!isNaN(lineNum) && lineNum > 0) {
                editor.revealLineInCenter(lineNum);
                editor.setPosition({ lineNumber: lineNum, column: 1 });
                editor.focus();
            }
        }
    }, [lineVal, fileContent]);

    function onMount(editor: MonacoTypes.editor.IStandaloneCodeEditor, monacoApi: typeof monaco): () => void {
        model.monacoRef.current = editor;

        const keyDownDisposer = editor.onKeyDown((e: MonacoTypes.IKeyboardEvent) => {
            const waveEvent = adaptFromReactOrNativeKeyEvent(e.browserEvent);
            const handled = tryReinjectKey(waveEvent);
            if (handled) {
                e.stopPropagation();
                e.preventDefault();
            }
        });

        const currentLineVal = globalStore.get(model.blockAtom)?.meta?.["editor:line"];
        if (currentLineVal) {
            const lineNum = typeof currentLineVal === "number" ? currentLineVal : parseInt(currentLineVal, 10);
            if (!isNaN(lineNum) && lineNum > 0) {
                editor.revealLineInCenter(lineNum);
                editor.setPosition({ lineNumber: lineNum, column: 1 });
            }
        }

        const isFocused = globalStore.get(model.nodeModel.isFocused);
        if (isFocused) {
            editor.focus();
        }

        return () => {
            keyDownDisposer.dispose();
        };
    }

    return (
        <CodeEditor
            blockId={model.blockId}
            text={fileContent}
            fileName={fileName}
            language={language}
            readonly={fileInfo.readonly}
            onChange={(text) => setNewFileContent(text)}
            onMount={onMount}
        />
    );
}

export { CodeEditPreview };
