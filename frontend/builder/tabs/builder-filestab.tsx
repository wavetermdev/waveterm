// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { formatFileSize } from "@/app/aipanel/ai-utils";
import { Modal } from "@/app/modals/modal";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { modalsModel } from "@/app/store/modalmodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { arrayToBase64 } from "@/util/util";
import { atoms } from "@/store/global";
import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useRef, useState } from "react";

const MaxFileSize = 5 * 1024 * 1024; // 5MB
const ReadOnlyFileNames = ["static/tw.css"];

type FileEntry = {
    name: string;
    size: number;
    modified: string;
    isReadOnly: boolean;
};

const RenameFileModal = memo(
    ({ appId, fileName, onSuccess }: { appId: string; fileName: string; onSuccess: () => void }) => {
        const displayName = fileName.replace("static/", "");
        const [newName, setNewName] = useState(displayName);
        const [error, setError] = useState("");
        const [isRenaming, setIsRenaming] = useState(false);

        const handleRename = async () => {
            const trimmedName = newName.trim();
            if (!trimmedName) {
                setError("File name cannot be empty");
                return;
            }
            if (trimmedName.includes("/") || trimmedName.includes("\\")) {
                setError("File name cannot contain / or \\");
                return;
            }
            if (trimmedName === displayName) {
                modalsModel.popModal();
                return;
            }

            setIsRenaming(true);
            try {
                await RpcApi.RenameAppFileCommand(TabRpcClient, {
                    appid: appId,
                    fromfilename: fileName,
                    tofilename: `static/${trimmedName}`,
                });
                onSuccess();
                modalsModel.popModal();
            } catch (err) {
                console.log("Error renaming file:", err);
                setError(err instanceof Error ? err.message : String(err));
            } finally {
                setIsRenaming(false);
            }
        };

        const handleClose = () => {
            modalsModel.popModal();
        };

        return (
            <Modal
                className="p-4 min-w-[500px]"
                onOk={handleRename}
                onCancel={handleClose}
                onClose={handleClose}
                okLabel="Rename"
                cancelLabel="Cancel"
                okDisabled={isRenaming || !newName.trim()}
            >
                <div className="flex flex-col gap-4 mb-4">
                    <h2 className="text-xl font-semibold">Rename File</h2>
                    <div className="flex flex-col gap-2">
                        <div className="text-sm text-secondary mb-1">
                            Current name: <span className="font-medium text-primary">{displayName}</span>
                        </div>
                        <input
                            type="text"
                            value={newName}
                            onChange={(e) => {
                                setNewName(e.target.value);
                                setError("");
                            }}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.nativeEvent.isComposing && newName.trim() && !error) {
                                    handleRename();
                                }
                            }}
                            className="px-3 py-2 bg-panel border border-border rounded focus:outline-none focus:border-accent"
                            autoFocus
                            disabled={isRenaming}
                            spellCheck={false}
                        />
                        {error && <div className="text-sm text-error">{error}</div>}
                    </div>
                </div>
            </Modal>
        );
    }
);

RenameFileModal.displayName = "RenameFileModal";

const DeleteFileModal = memo(
    ({ appId, fileName, onSuccess }: { appId: string; fileName: string; onSuccess: () => void }) => {
        const [isDeleting, setIsDeleting] = useState(false);
        const [error, setError] = useState("");

        const handleDelete = async () => {
            setIsDeleting(true);
            setError("");
            try {
                await RpcApi.DeleteAppFileCommand(TabRpcClient, {
                    appid: appId,
                    filename: fileName,
                });
                onSuccess();
                modalsModel.popModal();
            } catch (err) {
                console.log("Error deleting file:", err);
                setError(err instanceof Error ? err.message : String(err));
            } finally {
                setIsDeleting(false);
            }
        };

        const handleClose = () => {
            modalsModel.popModal();
        };

        useEffect(() => {
            const handleKeyDown = (e: KeyboardEvent) => {
                if (e.key === "Enter" && !isDeleting) {
                    e.preventDefault();
                    handleDelete();
                } else if (e.key === "Escape") {
                    e.preventDefault();
                    handleClose();
                }
            };

            document.addEventListener("keydown", handleKeyDown);
            return () => document.removeEventListener("keydown", handleKeyDown);
        }, [isDeleting]);

        return (
            <Modal
                className="p-4 min-w-[500px]"
                onOk={handleDelete}
                onCancel={handleClose}
                onClose={handleClose}
                okLabel="Delete"
                cancelLabel="Cancel"
                okDisabled={isDeleting}
            >
                <div className="flex flex-col gap-4 mb-4">
                    <h2 className="text-xl font-semibold">Delete File</h2>
                    <p>
                        Are you sure you want to delete <strong>{fileName.replace("static/", "")}</strong>?
                    </p>
                    <p className="text-sm text-secondary">This action cannot be undone.</p>
                    {error && <div className="text-sm text-error">{error}</div>}
                </div>
            </Modal>
        );
    }
);

DeleteFileModal.displayName = "DeleteFileModal";

const BuilderFilesTab = memo(() => {
    const builderAppId = useAtomValue(atoms.builderAppId);
    const [files, setFiles] = useState<FileEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [isDragging, setIsDragging] = useState(false);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; fileName: string } | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const loadFiles = useCallback(async () => {
        if (!builderAppId) return;

        setLoading(true);
        setError("");
        try {
            const result = await RpcApi.ListAllAppFilesCommand(TabRpcClient, { appid: builderAppId });
            const fileEntries: FileEntry[] = result.entries
                .filter((entry) => !entry.dir && entry.name.startsWith("static/"))
                .map((entry) => ({
                    name: entry.name,
                    size: entry.size || 0,
                    modified: entry.modified,
                    isReadOnly: ReadOnlyFileNames.includes(entry.name),
                }))
                .sort((a, b) => a.name.localeCompare(b.name));
            setFiles(fileEntries);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }, [builderAppId]);

    const handleRefresh = useCallback(async () => {
        // Clear files and add delay so UX shows the refresh is happening
        setFiles([]);
        await new Promise((resolve) => setTimeout(resolve, 100));
        await loadFiles();
    }, [loadFiles]);

    useEffect(() => {
        loadFiles();
    }, [loadFiles]);

    useEffect(() => {
        const handleClickOutside = () => setContextMenu(null);
        if (contextMenu) {
            document.addEventListener("click", handleClickOutside);
            return () => document.removeEventListener("click", handleClickOutside);
        }
    }, [contextMenu]);

    const handleFileUpload = async (fileList: FileList) => {
        if (!builderAppId || fileList.length === 0) return;

        const file = fileList[0];
        if (file.size > MaxFileSize) {
            setError(`File size exceeds maximum allowed size of ${formatFileSize(MaxFileSize)}`);
            return;
        }

        setError("");
        setLoading(true);

        try {
            const arrayBuffer = await file.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            const base64Encoded = arrayToBase64(uint8Array);

            await RpcApi.WriteAppFileCommand(TabRpcClient, {
                appid: builderAppId,
                filename: `static/${file.name}`,
                data64: base64Encoded,
            });

            await loadFiles();
        } catch (err) {
            console.error("Error uploading file:", err);
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        handleFileUpload(e.dataTransfer.files);
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files) {
            handleFileUpload(e.target.files);
        }
    };

    const handleContextMenu = (e: React.MouseEvent, fileName: string) => {
        const menu: ContextMenuItem[] = [
            {
                label: "Rename File",
                click: () => {
                    modalsModel.pushModal("RenameFileModal", { appId: builderAppId, fileName, onSuccess: loadFiles });
                },
            },
            {
                type: "separator",
            },
            {
                label: "Delete File",
                click: () => {
                    modalsModel.pushModal("DeleteFileModal", { appId: builderAppId, fileName, onSuccess: loadFiles });
                },
            },
        ];

        ContextMenuModel.showContextMenu(menu, e);
    };

    return (
        <div
            className={`w-full h-full flex flex-col p-4 border-2 border-dashed transition-colors ${
                isDragging ? "bg-accent/5 border-accent" : "border-transparent"
            }`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
        >
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Static Files</h2>
                <div className="flex gap-2">
                    <button
                        className="px-3 py-1 text-sm font-medium rounded bg-panel border border-border hover:bg-hover transition-colors cursor-pointer"
                        onClick={handleRefresh}
                        disabled={loading}
                        title="Refresh file list"
                    >
                        <i className="fa fa-refresh" />
                    </button>
                    <button
                        className="px-3 py-1 text-sm font-medium rounded bg-accent/80 text-primary hover:bg-accent transition-colors cursor-pointer"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={loading}
                    >
                        <i className="fa fa-plus mr-2" />
                        Add File
                    </button>
                </div>
                <input ref={fileInputRef} type="file" onChange={handleFileInputChange} className="hidden" />
            </div>

            {error && (
                <div className="mb-4 p-3 bg-error/10 border border-error/30 rounded text-sm text-error flex items-center gap-2">
                    <i className="fa fa-triangle-exclamation" />
                    <span>{error}</span>
                </div>
            )}

            <div className="mb-3 p-2 bg-blue-500/10 border border-blue-500/30 rounded text-sm text-secondary">
                Drag and drop files here or click "Add File". Maximum file size: {formatFileSize(MaxFileSize)}
            </div>

            <div className="flex-1 overflow-auto">
                {loading && files.length === 0 ? (
                    <div className="text-center text-secondary py-8">Loading files...</div>
                ) : files.length === 0 ? (
                    <div className="text-center text-secondary py-12">
                        <i className="fa fa-file text-4xl mb-3 opacity-50" />
                        <p>No files yet. Drag and drop files here or click "Add File" to get started.</p>
                    </div>
                ) : (
                    <div className="space-y-1">
                        {files.map((file) => (
                            <div
                                key={file.name}
                                className="flex items-center gap-3 p-2 bg-panel hover:bg-hover border border-border rounded transition-colors"
                                onContextMenu={(e) => !file.isReadOnly && handleContextMenu(e, file.name)}
                            >
                                <i className="fa fa-file text-secondary" />
                                <div className="flex-1 min-w-0">
                                    <div className="font-medium truncate">{file.name.replace("static/", "")}</div>
                                    <div className="text-xs text-secondary">
                                        {formatFileSize(file.size)}
                                        {file.isReadOnly && (
                                            <span className="ml-2 text-warning">
                                                <i className="fa fa-lock mr-1" />
                                                Generated by framework (read-only)
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className="text-xs text-secondary">{file.modified}</div>
                                {!file.isReadOnly && (
                                    <button
                                        className="px-2 py-1 hover:bg-hover rounded transition-colors cursor-pointer"
                                        onClick={(e) => handleContextMenu(e, file.name)}
                                        title="File options"
                                    >
                                        <i className="fa fa-ellipsis-vertical" />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
});

BuilderFilesTab.displayName = "BuilderFilesTab";

export { BuilderFilesTab, DeleteFileModal, RenameFileModal };
