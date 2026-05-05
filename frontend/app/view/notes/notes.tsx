// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { MonacoCodeEditor } from "@/app/monaco/monaco-react";
import { tryReinjectKey } from "@/app/store/keymodel";
import { globalStore } from "@/app/store/jotaiStore";
import { NotesViewModel } from "@/app/view/notes/notes-model";
import { adaptFromReactOrNativeKeyEvent } from "@/util/keyutil";
import { useAtomValue } from "jotai";
import type * as MonacoTypes from "monaco-editor";
import { useCallback, useRef } from "react";

export function NotesView({ model }: ViewComponentProps<NotesViewModel>) {
    const content = useAtomValue(model.contentAtom);
    const loadError = useAtomValue(model.loadErrorAtom);
    const loaded = useAtomValue(model.loadedAtom);

    const editorRef = useRef<MonacoTypes.editor.IStandaloneCodeEditor | null>(null);

    const handleMount = useCallback(
        (editor: MonacoTypes.editor.IStandaloneCodeEditor) => {
            editorRef.current = editor;
            model.setEditorRef(editorRef);
            model.restoreCursorPos();
            editor.onDidChangeCursorPosition(() => {
                const offset = editor.getModel()?.getOffsetAt(editor.getPosition());
                if (offset != null) {
                    model.onCursorChange(offset);
                }
            });
            const keyDownDisposer = editor.onKeyDown((e: MonacoTypes.IKeyboardEvent) => {
                const waveEvent = adaptFromReactOrNativeKeyEvent(e.browserEvent);
                const handled = tryReinjectKey(waveEvent);
                if (handled) {
                    e.stopPropagation();
                    e.preventDefault();
                }
            });
            if (globalStore.get(model.nodeModel.isFocused)) {
                editor.focus();
            }
            return () => {
                keyDownDisposer.dispose();
                editorRef.current = null;
            };
        },
        [model]
    );

    if (!loaded) {
        return <div className="flex items-center justify-center h-full text-secondary">Loading...</div>;
    }

    if (loadError) {
        return (
            <div className="flex items-center justify-center h-full p-8">
                <div className="text-errormsg text-center text-lg">{loadError}</div>
            </div>
        );
    }

    return (
        <MonacoCodeEditor
            text={content}
            readonly={false}
            language="markdown"
            onChange={(text) => model.onContentChange(text)}
            onMount={handleMount}
            path="~/notes.md"
            options={{
                wordWrap: "on",
                minimap: { enabled: false },
                lineNumbers: "off",
                folding: false,
                scrollBeyondLastLine: false,
            }}
        />
    );
}
