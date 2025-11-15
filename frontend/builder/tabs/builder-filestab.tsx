// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Modal } from "@/app/modals/modal";
import { modalsModel } from "@/app/store/modalmodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { atoms } from "@/store/global";
import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useRef, useState } from "react";

const MaxFileSize = 5 * 1024 * 1024; // 5MB

type FileEntry = {
    name: string;
    size: number;
    modified: string;
    isReadOnly: boolean;
};

function formatFileSize(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

const RenameFileModal = memo(({ appId, fileName, onSuccess }: { appId: string; fileName: string; onSuccess: () => void }) => {
    const [newName, setNewName] = useState(fileName);
    const [error, setError] = useState("");
    const [isRenaming, setIsRenaming] = useState(false);

    const handleRename = async () => {
        const trimmedName = newName.trim();
        if (!trimmedName) {
            setError("File name cannot be empty");
            return;
        }
        if (trimmedName === fileName) {
            modalsModel.popModal();
            return;
        }

        setIsRenaming(true);
        try {
            await RpcApi.RenameAppFileCommand(TabRpcClient, {
                appid: appId,
                fromfilename: fileName,
                tofilename: trimmedName,
            });
            onSuccess();
            modalsModel.popModal();
        } catch (err) {
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
            className="p-4"
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
                    />
                    {error && <div className="text-sm text-error">{error}</div>}
                </div>
            </div>
        </Modal>
    );
});

RenameFileModal.displayName = "RenameFileModal";

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
                    isReadOnly: entry.name === "static/tw.css",
                }))
                .sort((a, b) => a.name.localeCompare(b.name));
            setFiles(fileEntries);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }, [builderAppId]);

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
            const base64 = btoa(String.fromCharCode(...uint8Array));

            await RpcApi.WriteAppFileCommand(TabRpcClient, {
                appid: builderAppId,
                filename: `static/${file.name}`,
                data64: base64,
            });

            await loadFiles();
        } catch (err) {
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
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, fileName });
    };

    const handleDelete = async (fileName: string, isReadOnly: boolean) => {
        if (!builderAppId || isReadOnly) return;
        
        setContextMenu(null);
        setError("");
        try {
            await RpcApi.DeleteAppFileCommand(TabRpcClient, {
                appid: builderAppId,
                filename: fileName,
            });
            await loadFiles();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    const handleRename = (fileName: string, isReadOnly: boolean) => {
        if (isReadOnly) return;
        setContextMenu(null);
        modalsModel.pushModal("RenameFileModal", { appId: builderAppId, fileName, onSuccess: loadFiles });
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
                <button
                    className="px-3 py-1 text-sm font-medium rounded bg-accent/80 text-primary hover:bg-accent transition-colors cursor-pointer"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={loading}
                >
                    <i className="fa fa-plus mr-2" />
                    Add File
                </button>
                <input
                    ref={fileInputRef}
                    type="file"
                    onChange={handleFileInputChange}
                    className="hidden"
                />
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
                                className="flex items-center gap-3 p-2 bg-panel hover:bg-hover border border-border rounded transition-colors cursor-pointer"
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
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {contextMenu && (
                <div
                    className="fixed bg-panel border border-border rounded shadow-lg py-1 z-50"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                >
                    <button
                        className="w-full px-4 py-2 text-left hover:bg-hover transition-colors cursor-pointer"
                        onClick={() => {
                            const file = files.find(f => f.name === contextMenu.fileName);
                            if (file) handleRename(contextMenu.fileName, file.isReadOnly);
                        }}
                    >
                        <i className="fa fa-pen mr-2" />
                        Rename
                    </button>
                    <button
                        className="w-full px-4 py-2 text-left text-error hover:bg-error/10 transition-colors cursor-pointer"
                        onClick={() => {
                            const file = files.find(f => f.name === contextMenu.fileName);
                            if (file) handleDelete(contextMenu.fileName, file.isReadOnly);
                        }}
                    >
                        <i className="fa fa-trash mr-2" />
                        Delete
                    </button>
                </div>
            )}
        </div>
    );
});

BuilderFilesTab.displayName = "BuilderFilesTab";

export { BuilderFilesTab, RenameFileModal };