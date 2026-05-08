// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { tryReinjectKey } from "@/app/store/keymodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { CodeEditor } from "@/app/view/codeeditor/codeeditor";
import { adaptFromReactOrNativeKeyEvent, checkKeyPressed } from "@/util/keyutil";
import { fireAndForget, makeConnRoute } from "@/util/util";
import { useAtomValue, useSetAtom } from "jotai";
import type * as MonacoTypes from "monaco-editor";
import * as monaco from "monaco-editor";
import { useEffect } from "react";
import type { SpecializedViewProps } from "./preview";
import type { PreviewModel } from "./preview-model";

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

async function applyGitGutter(
    editor: MonacoTypes.editor.IStandaloneCodeEditor,
    decorationCollection: MonacoTypes.editor.IEditorDecorationsCollection,
    model: PreviewModel
) {
    try {
        const blockData = globalStore.get(model.blockAtom);
        const filePath = blockData?.meta?.file;
        const connName = blockData?.meta?.connection;
        if (!filePath) return;

        const cwd = filePath.substring(0, filePath.lastIndexOf("/")) || "/";
        const route = makeConnRoute(connName);

        const resp = await RpcApi.RemoteGitLineDiffCommand(TabRpcClient, { cwd, file: filePath }, { route });
        if (!resp || resp.error || !resp.hunks?.length) return;

        const decorations: MonacoTypes.editor.IModelDeltaDecoration[] = resp.hunks.map((hunk) => {
            let glyphClass: string;
            if (hunk.type === "added") {
                glyphClass = "git-gutter-added";
            } else if (hunk.type === "modified") {
                glyphClass = "git-gutter-modified";
            } else {
                glyphClass = "git-gutter-deleted";
            }
            return {
                range: new monaco.Range(hunk.startline, 1, hunk.endline, 1),
                options: {
                    isWholeLine: true,
                    glyphMarginClassName: glyphClass,
                    overviewRuler: {
                        color: hunk.type === "added" ? "#2ea04370" : hunk.type === "modified" ? "#0078d470" : "#f8514970",
                        position: monaco.editor.OverviewRulerLane.Left,
                    },
                },
            };
        });

        decorationCollection.set(decorations);
    } catch {
        // silently ignore - file might not be in a git repo
    }
}

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
        return () => {
            model.codeEditKeyDownHandler = null;
            model.monacoRef.current = null;
            model.refreshCallback = null;
        };
    }, []);

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

        const isFocused = globalStore.get(model.nodeModel.isFocused);
        if (isFocused) {
            editor.focus();
        }

        const decorationCollection = editor.createDecorationsCollection([]);
        applyGitGutter(editor, decorationCollection, model);

        return () => {
            keyDownDisposer.dispose();
            decorationCollection.clear();
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
