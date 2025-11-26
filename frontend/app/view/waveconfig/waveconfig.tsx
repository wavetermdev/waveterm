// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Tooltip } from "@/app/element/tooltip";
import { CodeEditor } from "@/app/view/codeeditor/codeeditor";
import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { checkKeyPressed, keydownWrapper } from "@/util/keyutil";
import { useAtom, useAtomValue } from "jotai";
import { memo, useEffect } from "react";

const WaveConfigView = memo(({ blockId, model }: ViewComponentProps<WaveConfigViewModel>) => {
    const selectedFile = useAtomValue(model.selectedFileAtom);
    const [fileContent, setFileContent] = useAtom(model.fileContentAtom);
    const isLoading = useAtomValue(model.isLoadingAtom);
    const isSaving = useAtomValue(model.isSavingAtom);
    const errorMessage = useAtomValue(model.errorMessageAtom);
    const validationError = useAtomValue(model.validationErrorAtom);
    const configFiles = model.getConfigFiles();

    useEffect(() => {
        if (configFiles.length > 0 && !selectedFile) {
            model.loadFile(configFiles[0]);
        }
    }, [selectedFile, model]);

    const hasChanges = model.hasChanges();

    useEffect(() => {
        const handleKeyDown = keydownWrapper((e: WaveKeyboardEvent) => {
            if (checkKeyPressed(e, "Cmd:s")) {
                if (hasChanges && !isSaving) {
                    model.saveFile();
                }
                return true;
            }
            return false;
        });

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [hasChanges, isSaving, model]);

    const saveTooltip = `Save (${model.saveShortcut})`;

    return (
        <div className="flex flex-row w-full h-full">
            <div className="flex flex-col w-64 border-r border-border p-4 gap-1">
                <div className="text-lg font-semibold mb-2">Config Files</div>
                {configFiles.map((file) => (
                    <div
                        key={file.path}
                        onClick={() => model.loadFile(file)}
                        className={`px-3 py-2 rounded cursor-pointer transition-colors ${
                            selectedFile?.path === file.path ? "bg-accentbg text-primary" : "hover:bg-secondary/50"
                        }`}
                    >
                        {file.name}
                    </div>
                ))}
            </div>
            <div className="flex flex-col flex-1">
                {selectedFile && (
                    <>
                        <div className="flex flex-row items-center justify-between px-4 py-2 border-b border-border">
                            <div className="flex items-baseline gap-2">
                                <div className="text-lg font-semibold">{selectedFile.name}</div>
                                <div className="text-xs text-muted-foreground font-mono pb-0.5 ml-2">
                                    {selectedFile.path}
                                </div>
                            </div>
                            <div className="flex gap-2 items-center">
                                {hasChanges && <span className="text-xs text-warning">Unsaved changes</span>}
                                <Tooltip content={saveTooltip} placement="bottom">
                                    <button
                                        onClick={() => model.saveFile()}
                                        disabled={!hasChanges || isSaving}
                                        className={`px-3 py-1 rounded transition-colors text-sm ${
                                            !hasChanges || isSaving
                                                ? "border border-border text-muted-foreground opacity-50"
                                                : "bg-accent/80 text-primary hover:bg-accent cursor-pointer"
                                        }`}
                                    >
                                        {isSaving ? "Saving..." : "Save"}
                                    </button>
                                </Tooltip>
                            </div>
                        </div>
                        {errorMessage && (
                            <div className="bg-error text-primary px-4 py-2 border-b border-error flex items-center justify-between">
                                <span>{errorMessage}</span>
                                <button
                                    onClick={() => model.clearError()}
                                    className="ml-2 hover:bg-black/20 rounded p-1 cursor-pointer transition-colors"
                                >
                                    ✕
                                </button>
                            </div>
                        )}
                        {validationError && (
                            <div className="bg-error text-primary px-4 py-2 border-b border-error flex items-center justify-between">
                                <span>{validationError}</span>
                                <button
                                    onClick={() => model.clearValidationError()}
                                    className="ml-2 hover:bg-black/20 rounded p-1 cursor-pointer transition-colors"
                                >
                                    ✕
                                </button>
                            </div>
                        )}
                        <div className="flex-1 overflow-hidden">
                            {isLoading ? (
                                <div className="flex items-center justify-center h-full text-muted-foreground">
                                    Loading...
                                </div>
                            ) : (
                                <CodeEditor
                                    blockId={blockId}
                                    text={fileContent}
                                    fileName={`${model.configDir}/${selectedFile.path}`}
                                    language={selectedFile.language}
                                    readonly={false}
                                    onChange={setFileContent}
                                />
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
});

WaveConfigView.displayName = "WaveConfigView";

export { WaveConfigView };
