// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Tooltip } from "@/app/element/tooltip";
import { globalStore } from "@/app/store/jotaiStore";
import { tryReinjectKey } from "@/app/store/keymodel";
import { settingsService } from "@/app/store/settings-service";
import { CodeEditor } from "@/app/view/codeeditor/codeeditor";
import type { ConfigFile, WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { adaptFromReactOrNativeKeyEvent, checkKeyPressed, keydownWrapper } from "@/util/keyutil";
import { cn } from "@/util/util";
import { useAtom, useAtomValue } from "jotai";
import type * as MonacoTypes from "monaco-editor";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { debounce } from "throttle-debounce";

import "./waveconfig.scss";

/**
 * JSON Editor Modal - Opens settings.json in a modal overlay
 */
interface JsonEditorModalProps {
    model: WaveConfigViewModel;
    blockId: string;
    onClose: () => void;
}

const JsonEditorModal = memo(({ model, blockId, onClose }: JsonEditorModalProps) => {
    const [fileContent, setFileContent] = useAtom(model.fileContentAtom);
    const isSaving = useAtomValue(model.isSavingAtom);
    const hasChanges = useAtomValue(model.hasEditedAtom);
    const validationError = useAtomValue(model.validationErrorAtom);
    const errorMessage = useAtomValue(model.errorMessageAtom);
    const editorRef = useRef<MonacoTypes.editor.IStandaloneCodeEditor>(null);

    const handleContentChange = useCallback(
        (newContent: string) => {
            setFileContent(newContent);
            model.markAsEdited();
        },
        [setFileContent, model]
    );

    const handleEditorMount = useCallback(
        (editor: MonacoTypes.editor.IStandaloneCodeEditor) => {
            editorRef.current = editor;
            editor.focus();

            const keyDownDisposer = editor.onKeyDown((e: MonacoTypes.IKeyboardEvent) => {
                const waveEvent = adaptFromReactOrNativeKeyEvent(e.browserEvent);
                // Allow Escape to close the modal
                if (e.keyCode === 9 /* Escape */) {
                    onClose();
                    e.stopPropagation();
                    e.preventDefault();
                    return;
                }
                const handled = tryReinjectKey(waveEvent);
                if (handled) {
                    e.stopPropagation();
                    e.preventDefault();
                }
            });

            return () => {
                keyDownDisposer.dispose();
                editorRef.current = null;
            };
        },
        [onClose]
    );

    const handleSave = useCallback(async () => {
        await model.saveFile();
        if (!globalStore.get(model.validationErrorAtom)) {
            onClose();
        }
    }, [model, onClose]);

    // Close on backdrop click
    const handleBackdropClick = useCallback(
        (e: React.MouseEvent) => {
            if (e.target === e.currentTarget) {
                onClose();
            }
        },
        [onClose]
    );

    // Handle keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = keydownWrapper((e: WaveKeyboardEvent) => {
            if (checkKeyPressed(e, "Cmd:s")) {
                if (hasChanges && !isSaving) {
                    handleSave();
                }
                return true;
            }
            if (checkKeyPressed(e, "Escape")) {
                onClose();
                return true;
            }
            return false;
        });

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [hasChanges, isSaving, handleSave, onClose]);

    return (
        <div className="waveconfig-modal-backdrop" onClick={handleBackdropClick}>
            <div className="waveconfig-modal">
                <div className="waveconfig-modal-header">
                    <div className="waveconfig-modal-title">
                        <i className="fa fa-solid fa-code" />
                        <span>settings.json</span>
                    </div>
                    <div className="waveconfig-modal-actions">
                        {hasChanges && (
                            <span className="waveconfig-modal-unsaved">Unsaved changes</span>
                        )}
                        <button
                            onClick={handleSave}
                            disabled={!hasChanges || isSaving}
                            className={cn("waveconfig-modal-save", {
                                disabled: !hasChanges || isSaving,
                            })}
                        >
                            {isSaving ? "Saving..." : "Save"}
                        </button>
                        <button onClick={onClose} className="waveconfig-modal-close">
                            <i className="fa fa-solid fa-times" />
                        </button>
                    </div>
                </div>
                {(errorMessage || validationError) && (
                    <div className="waveconfig-modal-error">
                        <span>{errorMessage || validationError}</span>
                        <button
                            onClick={() => {
                                model.clearError();
                                model.clearValidationError();
                            }}
                        >
                            <i className="fa fa-solid fa-times" />
                        </button>
                    </div>
                )}
                <div className="waveconfig-modal-content">
                    <CodeEditor
                        blockId={blockId}
                        text={fileContent}
                        fileName="WAVECONFIGPATH/settings.json"
                        language="json"
                        readonly={false}
                        onChange={handleContentChange}
                        onMount={handleEditorMount}
                    />
                </div>
            </div>
        </div>
    );
});

JsonEditorModal.displayName = "JsonEditorModal";

/**
 * Config Tab Bar - Horizontal tabs for config sections
 */
interface ConfigTabBarProps {
    model: WaveConfigViewModel;
    onEditJson: () => void;
}

const ConfigTabBar = memo(({ model, onEditJson }: ConfigTabBarProps) => {
    const selectedFile = useAtomValue(model.selectedFileAtom);
    const configFiles = model.getConfigFiles();
    const deprecatedConfigFiles = model.getDeprecatedConfigFiles();

    const handleFileSelect = useCallback(
        (file: ConfigFile) => {
            model.loadFile(file);
        },
        [model]
    );

    return (
        <div className="waveconfig-tabbar">
            <div className="waveconfig-tabs">
                {configFiles.map((file) => (
                    <button
                        key={file.path}
                        onClick={() => handleFileSelect(file)}
                        className={cn("waveconfig-tab", {
                            active: selectedFile?.path === file.path,
                        })}
                    >
                        {file.name}
                    </button>
                ))}
                {deprecatedConfigFiles.map((file) => (
                    <button
                        key={file.path}
                        onClick={() => handleFileSelect(file)}
                        className={cn("waveconfig-tab", "deprecated", {
                            active: selectedFile?.path === file.path,
                        })}
                    >
                        {file.name}
                        <span className="waveconfig-tab-badge">deprecated</span>
                    </button>
                ))}
            </div>
            <div className="waveconfig-tabbar-actions">
                {selectedFile?.docsUrl && (
                    <Tooltip content="View documentation">
                        <a
                            href={`${selectedFile.docsUrl}?ref=waveconfig`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="waveconfig-docs-link"
                        >
                            <i className="fa fa-solid fa-book" />
                        </a>
                    </Tooltip>
                )}
                {selectedFile?.path === "settings.json" && selectedFile?.visualComponent && (
                    <button onClick={onEditJson} className="waveconfig-edit-json">
                        Edit in settings.json
                    </button>
                )}
            </div>
        </div>
    );
});

ConfigTabBar.displayName = "ConfigTabBar";

/**
 * Main WaveConfig View Component
 */
const WaveConfigView = memo(({ blockId, model }: ViewComponentProps<WaveConfigViewModel>) => {
    const selectedFile = useAtomValue(model.selectedFileAtom);
    const [fileContent, setFileContent] = useAtom(model.fileContentAtom);
    const isLoading = useAtomValue(model.isLoadingAtom);
    const errorMessage = useAtomValue(model.errorMessageAtom);
    const validationError = useAtomValue(model.validationErrorAtom);
    const editorContainerRef = useRef<HTMLDivElement>(null);
    const [isJsonModalOpen, setIsJsonModalOpen] = useState(false);

    const handleContentChange = useCallback(
        (newContent: string) => {
            setFileContent(newContent);
            model.markAsEdited();
        },
        [setFileContent, model]
    );

    const handleEditorMount = useCallback(
        (editor: MonacoTypes.editor.IStandaloneCodeEditor) => {
            model.editorRef.current = editor;

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
                model.editorRef.current = null;
            };
        },
        [model]
    );

    // Open JSON modal and load settings.json content
    const handleEditJson = useCallback(async () => {
        // Flush any pending settings changes first
        await settingsService.forceSave();
        // Find and load settings.json
        const settingsFile = model.getConfigFiles().find((f) => f.path === "settings.json");
        if (settingsFile) {
            await model.loadFile(settingsFile);
        }
        setIsJsonModalOpen(true);
    }, [model]);

    const handleCloseJsonModal = useCallback(() => {
        setIsJsonModalOpen(false);
        // Reload the current file to refresh any changes
        if (selectedFile) {
            model.loadFile(selectedFile);
        }
    }, [selectedFile, model]);

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

    return (
        <div ref={editorContainerRef} className="waveconfig-container">
            <ConfigTabBar model={model} onEditJson={handleEditJson} />

            {(errorMessage || validationError) && (
                <div className="waveconfig-error">
                    <span>{errorMessage || validationError}</span>
                    <button
                        onClick={() => {
                            model.clearError();
                            model.clearValidationError();
                        }}
                    >
                        <i className="fa fa-solid fa-times" />
                    </button>
                </div>
            )}

            <div className="waveconfig-content">
                {isLoading ? (
                    <div className="waveconfig-loading">
                        <i className="fa fa-solid fa-spinner fa-spin" />
                        <span>Loading...</span>
                    </div>
                ) : selectedFile?.visualComponent ? (
                    (() => {
                        const VisualComponent = selectedFile.visualComponent;
                        return <VisualComponent model={model} />;
                    })()
                ) : selectedFile ? (
                    <CodeEditor
                        blockId={blockId}
                        text={fileContent}
                        fileName={`WAVECONFIGPATH/${selectedFile.path}`}
                        language={selectedFile.language}
                        readonly={false}
                        onChange={handleContentChange}
                        onMount={handleEditorMount}
                    />
                ) : null}
            </div>

            {isJsonModalOpen && (
                <JsonEditorModal
                    model={model}
                    blockId={blockId}
                    onClose={handleCloseJsonModal}
                />
            )}
        </div>
    );
});

WaveConfigView.displayName = "WaveConfigView";

export { WaveConfigView };
