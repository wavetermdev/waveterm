// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Tooltip } from "@/app/element/tooltip";
import { globalStore } from "@/app/store/jotaiStore";
import { CodeEditor } from "@/app/view/codeeditor/codeeditor";
import type { ConfigFile, WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { checkKeyPressed, keydownWrapper } from "@/util/keyutil";
import { cn } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useRef } from "react";
import { debounce } from "throttle-debounce";

interface ConfigSidebarProps {
    model: WaveConfigViewModel;
}

const ConfigSidebar = memo(({ model }: ConfigSidebarProps) => {
    const selectedFile = useAtomValue(model.selectedFileAtom);
    const [isMenuOpen, setIsMenuOpen] = useAtom(model.isMenuOpenAtom);
    const configFiles = model.getConfigFiles();
    const deprecatedConfigFiles = model.getDeprecatedConfigFiles();

    const handleFileSelect = (file: ConfigFile) => {
        model.loadFile(file);
        setIsMenuOpen(false);
    };

    return (
        <div className="flex flex-col w-48 border-r border-border @w600:h-full @max-w600:absolute @max-w600:left-0.5 @max-w600:top-0 @max-w600:bottom-0.5 @max-w600:z-10 @max-w600:bg-background @max-w600:shadow-xl @max-w600:rounded-bl">
            <div className="flex items-center justify-between px-4 py-2 border-b border-border @w600:hidden">
                <span className="font-semibold">Config Files</span>
                <button
                    onClick={() => setIsMenuOpen(false)}
                    className="hover:bg-secondary/50 rounded p-1 cursor-pointer transition-colors"
                >
                    ✕
                </button>
            </div>
            {configFiles.map((file) => (
                <div
                    key={file.path}
                    onClick={() => handleFileSelect(file)}
                    className={`px-4 py-2 border-b border-border cursor-pointer transition-colors ${
                        selectedFile?.path === file.path ? "bg-accentbg text-primary" : "hover:bg-secondary/50"
                    }`}
                >
                    <div className="whitespace-nowrap overflow-hidden text-ellipsis">{file.name}</div>
                    {file.description && (
                        <div className="text-xs text-muted mt-0.5 whitespace-nowrap overflow-hidden text-ellipsis">
                            {file.description}
                        </div>
                    )}
                </div>
            ))}
            {deprecatedConfigFiles.length > 0 && (
                <>
                    {deprecatedConfigFiles.map((file) => (
                        <div
                            key={file.path}
                            onClick={() => handleFileSelect(file)}
                            className={`px-4 py-2 border-b border-border cursor-pointer transition-colors ${
                                selectedFile?.path === file.path ? "bg-accentbg text-primary" : "hover:bg-secondary/50"
                            }`}
                        >
                            <div className="flex items-center gap-2 overflow-hidden">
                                <span className="text-secondary truncate">{file.name}</span>
                                <span
                                    className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${
                                        selectedFile?.path === file.path
                                            ? "text-primary/80 bg-secondary/50"
                                            : "text-muted-foreground/70 bg-secondary/30"
                                    }`}
                                >
                                    deprecated
                                </span>
                            </div>
                        </div>
                    ))}
                </>
            )}
        </div>
    );
});

ConfigSidebar.displayName = "ConfigSidebar";

const WaveConfigView = memo(({ blockId, model }: ViewComponentProps<WaveConfigViewModel>) => {
    const selectedFile = useAtomValue(model.selectedFileAtom);
    const [fileContent, setFileContent] = useAtom(model.fileContentAtom);
    const isLoading = useAtomValue(model.isLoadingAtom);
    const isSaving = useAtomValue(model.isSavingAtom);
    const errorMessage = useAtomValue(model.errorMessageAtom);
    const validationError = useAtomValue(model.validationErrorAtom);
    const [isMenuOpen, setIsMenuOpen] = useAtom(model.isMenuOpenAtom);
    const hasChanges = useAtomValue(model.hasEditedAtom);
    const [activeTab, setActiveTab] = useAtom(model.activeTabAtom);
    const editorContainerRef = useRef<HTMLDivElement>(null);

    const handleContentChange = useCallback(
        (newContent: string) => {
            setFileContent(newContent);
            model.markAsEdited();
        },
        [setFileContent, model]
    );

    const handleEditorMount = useCallback(
        (editor) => {
            model.editorRef.current = editor;
            const isFocused = globalStore.get(model.nodeModel.isFocused);
            if (isFocused) {
                editor.focus();
            }
            return () => {
                model.editorRef.current = null;
            };
        },
        [model]
    );

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

    useEffect(() => {
        if (!editorContainerRef.current) {
            return;
        }
        const debouncedLayout = debounce(100, () => {
            if (model.editorRef.current) {
                model.editorRef.current.layout();
            }
        });
        const resizeObserver = new ResizeObserver(debouncedLayout);
        resizeObserver.observe(editorContainerRef.current);
        return () => resizeObserver.disconnect();
    }, [model]);

    const saveTooltip = `Save (${model.saveShortcut})`;

    return (
        <div className="@container flex flex-row w-full h-full">
            {isMenuOpen && (
                <div className="absolute inset-0 bg-black/50 z-5 @w600:hidden" onClick={() => setIsMenuOpen(false)} />
            )}
            <div className={`h-full ${isMenuOpen ? "" : "@max-w600:hidden"}`}>
                <ConfigSidebar model={model} />
            </div>
            <div ref={editorContainerRef} className="flex flex-col flex-1 min-w-0">
                {selectedFile && (
                    <>
                        <div className="flex flex-row items-center justify-between px-4 py-2 border-b border-border">
                            <div className="flex items-baseline gap-2 min-w-0">
                                <button
                                    onClick={() => setIsMenuOpen(true)}
                                    className="@w600:hidden hover:bg-secondary/50 rounded p-1 cursor-pointer transition-colors mr-2 shrink-0"
                                >
                                    <i className="fa fa-bars" />
                                </button>
                                <div className="text-lg font-semibold whitespace-nowrap shrink-0">
                                    {selectedFile.name}
                                </div>
                                {selectedFile.docsUrl && (
                                    <Tooltip content="View documentation">
                                        <a
                                            href={`${selectedFile.docsUrl}?ref=waveconfig`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="!text-muted-foreground hover:!text-primary transition-colors ml-1 shrink-0 cursor-pointer"
                                        >
                                            <i className="fa fa-book text-sm" />
                                        </a>
                                    </Tooltip>
                                )}
                                <div className="text-xs text-muted-foreground font-mono pb-0.5 ml-1 truncate @max-w450:hidden">
                                    {selectedFile.path}
                                </div>
                            </div>
                            <div className="flex gap-2 items-baseline shrink-0">
                                {selectedFile.hasJsonView && (
                                    <>
                                        {hasChanges && (
                                            <span className="text-xs text-warning pb-0.5 @max-w450:hidden">
                                                Unsaved changes
                                            </span>
                                        )}
                                        <Tooltip content={saveTooltip} placement="bottom" divClassName="shrink-0">
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
                                    </>
                                )}
                            </div>
                        </div>
                        {selectedFile.visualComponent && selectedFile.hasJsonView && (
                            <div className="flex gap-0 border-b border-border">
                                <button
                                    onClick={() => setActiveTab("visual")}
                                    className={cn(
                                        "px-4 pt-1 pb-1.5 cursor-pointer transition-colors text-secondary",
                                        activeTab === "visual"
                                            ? "bg-highlightbg text-primary"
                                            : "bg-transparent hover:bg-hover"
                                    )}
                                >
                                    Visual
                                </button>
                                <button
                                    onClick={() => setActiveTab("json")}
                                    className={cn(
                                        "px-4 pt-1 pb-1.5 cursor-pointer transition-colors text-secondary",
                                        activeTab === "json"
                                            ? "bg-highlightbg text-primary"
                                            : "bg-transparent hover:bg-hover"
                                    )}
                                >
                                    Raw JSON
                                </button>
                            </div>
                        )}
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
                            ) : selectedFile.visualComponent && (!selectedFile.hasJsonView || activeTab === "visual") ? (
                                (() => {
                                    const VisualComponent = selectedFile.visualComponent;
                                    return <VisualComponent model={model} />;
                                })()
                            ) : (
                                <CodeEditor
                                    blockId={blockId}
                                    text={fileContent}
                                    fileName={`WAVECONFIGPATH/${selectedFile.path}`}
                                    language={selectedFile.language}
                                    readonly={false}
                                    onChange={handleContentChange}
                                    onMount={handleEditorMount}
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
