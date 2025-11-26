// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Tooltip } from "@/app/element/tooltip";
import { getApi } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { CodeEditor } from "@/app/view/codeeditor/codeeditor";
import { checkKeyPressed, keydownWrapper } from "@/util/keyutil";
import { base64ToString, stringToBase64 } from "@/util/util";
import { atom, PrimitiveAtom, useAtom, useAtomValue, useSetAtom } from "jotai";
import { memo, useCallback, useEffect, useMemo } from "react";

type ConfigFile = {
    name: string;
    path: string;
    language: string;
};

const configFiles: ConfigFile[] = [
    { name: "General", path: "settings.json", language: "json" },
    { name: "Connections", path: "connections.json", language: "json" },
    { name: "Widgets", path: "widgets.json", language: "json" },
    { name: "AI Presets", path: "presets/ai.json", language: "json" },
];

const selectedFileAtom = atom<ConfigFile>(null) as PrimitiveAtom<ConfigFile>;
const fileContentAtom = atom<string>("") as PrimitiveAtom<string>;
const originalContentAtom = atom<string>("") as PrimitiveAtom<string>;
const isLoadingAtom = atom<boolean>(false) as PrimitiveAtom<boolean>;
const isSavingAtom = atom<boolean>(false) as PrimitiveAtom<boolean>;
const errorMessageAtom = atom<string>(null) as PrimitiveAtom<string>;
const validationErrorAtom = atom<string>(null) as PrimitiveAtom<string>;

const WaveConfigView = memo(({ blockId }: { blockId: string }) => {
    const selectedFile = useAtomValue(selectedFileAtom);
    const setSelectedFile = useSetAtom(selectedFileAtom);
    const [fileContent, setFileContent] = useAtom(fileContentAtom);
    const [originalContent, setOriginalContent] = useAtom(originalContentAtom);
    const isLoading = useAtomValue(isLoadingAtom);
    const setIsLoading = useSetAtom(isLoadingAtom);
    const isSaving = useAtomValue(isSavingAtom);
    const setIsSaving = useSetAtom(isSavingAtom);
    const [errorMessage, setErrorMessage] = useAtom(errorMessageAtom);
    const [validationError, setValidationError] = useAtom(validationErrorAtom);

    const loadFile = useCallback(
        async (file: ConfigFile) => {
            setIsLoading(true);
            setErrorMessage(null);
            try {
                const configDir = getApi().getConfigDir();
                const fullPath = `${configDir}/${file.path}`;
                const fileData = await RpcApi.FileReadCommand(TabRpcClient, {
                    info: { path: fullPath },
                });
                const content = fileData?.data64 ? base64ToString(fileData.data64) : "";
                setFileContent(content);
                setOriginalContent(content);
                setSelectedFile(file);
            } catch (err) {
                setErrorMessage(`Failed to load ${file.name}: ${err.message || String(err)}`);
                setFileContent("");
                setOriginalContent("");
            } finally {
                setIsLoading(false);
            }
        },
        [setFileContent, setOriginalContent, setSelectedFile, setIsLoading, setErrorMessage]
    );

    const saveFile = useCallback(async () => {
        if (!selectedFile) return;
        
        try {
            const parsed = JSON.parse(fileContent);
            const formatted = JSON.stringify(parsed, null, 2);
            
            setIsSaving(true);
            setErrorMessage(null);
            setValidationError(null);
            
            try {
                const configDir = getApi().getConfigDir();
                const fullPath = `${configDir}/${selectedFile.path}`;
                await RpcApi.FileWriteCommand(TabRpcClient, {
                    info: { path: fullPath },
                    data64: stringToBase64(formatted),
                });
                setFileContent(formatted);
                setOriginalContent(formatted);
            } catch (err) {
                setErrorMessage(`Failed to save ${selectedFile.name}: ${err.message || String(err)}`);
            } finally {
                setIsSaving(false);
            }
        } catch (err) {
            setValidationError(`Invalid JSON: ${err.message || String(err)}`);
        }
    }, [selectedFile, fileContent, setFileContent, setOriginalContent, setIsSaving, setErrorMessage, setValidationError]);

    useEffect(() => {
        if (configFiles.length > 0 && !selectedFile) {
            loadFile(configFiles[0]);
        }
    }, [selectedFile, loadFile]);

    const hasChanges = fileContent !== originalContent;

    useEffect(() => {
        const handleKeyDown = keydownWrapper((e: WaveKeyboardEvent) => {
            if (checkKeyPressed(e, "Cmd:s")) {
                if (hasChanges && !isSaving) {
                    saveFile();
                }
                return true;
            }
            return false;
        });

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [hasChanges, isSaving, saveFile]);

    const saveTooltip = useMemo(() => {
        const platform = getApi().getPlatform();
        const shortcut = platform === "darwin" ? "Cmd+S" : "Alt+S";
        return `Save (${shortcut})`;
    }, []);

    return (
        <div className="flex flex-row w-full h-full">
            <div className="flex flex-col w-64 border-r border-border p-4 gap-1">
                <div className="text-lg font-semibold mb-2">Config Files</div>
                {configFiles.map((file) => (
                    <div
                        key={file.path}
                        onClick={() => loadFile(file)}
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
                                        onClick={saveFile}
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
                                    onClick={() => setErrorMessage(null)}
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
                                    onClick={() => setValidationError(null)}
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
                                    fileName={selectedFile.path}
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
