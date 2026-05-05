// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { MonacoCodeEditor } from "@/app/monaco/monaco-react";
import { NotesViewModel } from "@/app/view/notes/notes-model";
import { useAtomValue } from "jotai";
import type * as MonacoTypes from "monaco-editor";
import { useCallback, useRef } from "react";
import { debounce } from "throttle-debounce";

export function NotesView({ model }: ViewComponentProps<NotesViewModel>) {
    const content = useAtomValue(model.contentAtom);
    const error = useAtomValue(model.errorAtom);
    const loaded = useAtomValue(model.loadedAtom);

    const editorRef = useRef<MonacoTypes.editor.IStandaloneCodeEditor | null>(null);

    const debouncedSave = useCallback(
        debounce(1000, (text: string) => {
            model.saveContent(text);
        }),
        [model]
    );

    const handleMount = useCallback(
        (editor: MonacoTypes.editor.IStandaloneCodeEditor) => {
            editorRef.current = editor;
            model.setEditorRef(editorRef);
            return () => {
                editorRef.current = null;
            };
        },
        [model]
    );

    if (!loaded) {
        return <div className="flex items-center justify-center h-full text-secondary">Loading...</div>;
    }

    if (error) {
        return (
            <div className="flex items-center justify-center h-full p-8">
                <div className="text-error text-center text-lg">{error}</div>
            </div>
        );
    }

    return (
        <MonacoCodeEditor
            text={content}
            readonly={false}
            language="markdown"
            onChange={debouncedSave}
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
