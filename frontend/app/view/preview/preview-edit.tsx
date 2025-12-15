// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { tryReinjectKey } from "@/app/store/keymodel";
import { CodeEditor } from "@/app/view/codeeditor/codeeditor";
import { globalStore } from "@/store/global";
import { adaptFromReactOrNativeKeyEvent, checkKeyPressed } from "@/util/keyutil";
import { fireAndForget } from "@/util/util";
import { Monaco } from "@monaco-editor/react";
import { useAtomValue, useSetAtom } from "jotai";
import type * as MonacoTypes from "monaco-editor/esm/vs/editor/editor.api";
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
        // Start file watcher for auto-refresh
        model.startFileWatcher();
        return () => {
            model.codeEditKeyDownHandler = null;
            model.monacoRef.current = null;
            model.refreshCallback = null;
            model.stopFileWatcher();
        };
    }, []);

    function onMount(editor: MonacoTypes.editor.IStandaloneCodeEditor, monaco: Monaco): () => void {
        model.monacoRef.current = editor;

        const keyDownDisposer = editor.onKeyDown((e: MonacoTypes.IKeyboardEvent) => {
            const waveEvent = adaptFromReactOrNativeKeyEvent(e.browserEvent);
            const handled = tryReinjectKey(waveEvent);
            if (handled) {
                e.stopPropagation();
                e.preventDefault();
            }
        });

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
