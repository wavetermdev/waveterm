// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { CodeEditor } from "@/app/view/codeeditor/codeeditor";
import { BuilderAppPanelModel } from "@/builder/store/builder-apppanel-model";
import { atoms } from "@/store/global";
import * as keyutil from "@/util/keyutil";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import type * as MonacoTypes from "monaco-editor";
import { memo, useEffect } from "react";

const BuilderCodeTab = memo(() => {
    const model = BuilderAppPanelModel.getInstance();
    const builderAppId = useAtomValue(atoms.builderAppId);
    const codeContent = useAtomValue(model.codeContentAtom);
    const isLoading = useAtomValue(model.isLoadingAtom);
    const error = useAtomValue(model.errorAtom);
    const saveNeeded = useAtomValue(model.saveNeededAtom);
    const activeTab = useAtomValue(model.activeTab);

    useEffect(() => {
        if (activeTab === "code" && model.monacoEditorRef.current) {
            setTimeout(() => {
                model.monacoEditorRef.current?.layout();
            }, 0);
        }
    }, [activeTab, model.monacoEditorRef]);

    const handleCodeChange = (newText: string) => {
        model.setCodeContent(newText);
    };

    const handleEditorMount = (editor: MonacoTypes.editor.IStandaloneCodeEditor, monaco: typeof MonacoTypes) => {
        model.setMonacoEditorRef(editor);
        return () => {
            model.setMonacoEditorRef(null);
        };
    };

    const handleSave = () => {
        if (builderAppId) {
            model.saveAppFile(builderAppId);
        }
    };

    const handleKeyDown = keyutil.keydownWrapper((waveEvent: WaveKeyboardEvent) => {
        if (keyutil.checkKeyPressed(waveEvent, "Cmd:s")) {
            handleSave();
            return true;
        }
        return false;
    });

    if (!builderAppId) {
        return (
            <div className="w-full h-full flex items-center justify-center">
                <div className="text-secondary">No builder app selected</div>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="w-full h-full flex items-center justify-center">
                <div className="text-secondary">Loading app.go...</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="w-full h-full flex items-center justify-center">
                <div className="text-red-500">{error}</div>
            </div>
        );
    }

    return (
        <div className="w-full h-full relative" onKeyDown={handleKeyDown}>
            <button
                className={cn(
                    "absolute top-1 right-4 z-50 px-3 py-1 text-sm font-medium rounded transition-colors shadow-lg",
                    saveNeeded
                        ? "bg-accent/80 text-primary hover:bg-accent cursor-pointer"
                        : "bg-gray-600 text-gray-400 cursor-default"
                )}
                onClick={saveNeeded ? handleSave : undefined}
            >
                Save
            </button>
            <CodeEditor
                blockId={builderAppId}
                text={codeContent}
                readonly={false}
                language="go"
                fileName="app.go"
                onChange={handleCodeChange}
                onMount={handleEditorMount}
            />
        </div>
    );
});

BuilderCodeTab.displayName = "BuilderCodeTab";

export { BuilderCodeTab };
