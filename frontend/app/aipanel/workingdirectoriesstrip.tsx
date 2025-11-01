// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms, WOS } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { isBlank } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useEffect, useState } from "react";

interface WorkingDirectory {
    path: string;
    source: "term" | "preview";
}

async function extractWorkingDirectory(blockId: string, block: Block): Promise<WorkingDirectory | null> {
    if (!block?.meta) return null;

    const connection = block.meta.connection;
    const isLocalhost = isBlank(connection);

    if (!isLocalhost) return null;

    const view = block.meta.view;

    if (view === "term") {
        const blockOref = WOS.makeORef("block", blockId);
        const rtInfo = await RpcApi.GetRTInfoCommand(TabRpcClient, {
            oref: blockOref,
        });
        if (!rtInfo?.["shell:hascurcwd"]) return null;

        const cwd = block.meta["cmd:cwd"];
        if (!isBlank(cwd)) {
            return { path: cwd, source: "term" };
        }
    } else if (view === "preview") {
        const file = block.meta.file;
        if (isBlank(file)) return null;

        try {
            const fileInfo = await RpcApi.FileInfoCommand(TabRpcClient, {
                info: { path: file },
            });

            if (fileInfo?.isdir) {
                return { path: file, source: "preview" };
            } else if (fileInfo?.dir) {
                return { path: fileInfo.dir, source: "preview" };
            }
        } catch (e) {
            console.error("Error getting file info:", e);
        }
    }

    return null;
}

async function formatDisplayPath(path: string): Promise<string> {
    if (path === "~") {
        try {
            const fileInfo = await RpcApi.FileInfoCommand(TabRpcClient, {
                info: { path },
            });
            if (fileInfo?.path) {
                return `~ (${fileInfo.path})`;
            }
        } catch (e) {
            console.error("Error formatting display path:", e);
        }
    }
    return path;
}

export const WorkingDirectoriesStrip = memo(() => {
    const tab = useAtomValue(atoms.tabAtom);
    const [directories, setDirectories] = useState<WorkingDirectory[]>([]);
    const [displayPaths, setDisplayPaths] = useState<Map<string, string>>(new Map());
    const [selectedDir, setSelectedDir] = useState<WorkingDirectory | null>(null);
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        const loadDirectories = async () => {
            if (!tab?.blockids || tab.blockids.length === 0) {
                setDirectories([]);
                return;
            }

            const dirPromises = tab.blockids.map(async (blockId) => {
                const blockOref = WOS.makeORef("block", blockId);
                try {
                    const block = WOS.getObjectValue<Block>(blockOref);
                    if (!block) return null;
                    return await extractWorkingDirectory(blockId, block);
                } catch (e) {
                    return null;
                }
            });

            const dirs = await Promise.all(dirPromises);
            const validDirs = dirs.filter((d) => d != null);

            const uniqueDirsMap = new Map<string, WorkingDirectory>();
            const normalizedPathMap = new Map<string, string>();

            for (const dir of validDirs) {
                let normalizedPath = dir.path;
                if (dir.path === "~") {
                    try {
                        const fileInfo = await RpcApi.FileInfoCommand(TabRpcClient, {
                            info: { path: dir.path },
                        });
                        if (fileInfo?.path) {
                            normalizedPath = fileInfo.path;
                        }
                    } catch (e) {
                        console.error("Error expanding home directory:", e);
                    }
                }

                if (!normalizedPathMap.has(normalizedPath)) {
                    normalizedPathMap.set(normalizedPath, dir.path);
                    uniqueDirsMap.set(dir.path, dir);
                }
            }

            const uniqueDirs = Array.from(uniqueDirsMap.values());
            setDirectories(uniqueDirs);

            const displayPathMap = new Map<string, string>();
            for (const dir of uniqueDirs) {
                const displayPath = await formatDisplayPath(dir.path);
                displayPathMap.set(dir.path, displayPath);
            }
            setDisplayPaths(displayPathMap);

            if (uniqueDirs.length > 0 && !selectedDir) {
                setSelectedDir(uniqueDirs[0]);
            }
        };

        setTimeout(() => loadDirectories(), 500);
    }, [tab?.blockids]);

    if (directories.length === 0) {
        return null;
    }

    const getIcon = (source: "term" | "preview") => {
        if (source === "term") {
            return <i className="fa-sharp fa-solid fa-laptop text-gray-400 w-4"></i>;
        }
        return <i className="fa-sharp fa-solid fa-folder text-gray-400 w-4"></i>;
    };

    const currentDir = selectedDir || directories[0];

    return (
        <div className="px-3 py-1.5 flex items-center gap-2 text-xs">
            <i className="fa-sharp fa-solid fa-folder-open text-gray-400"></i>
            <span className="text-gray-400">Working Dir:</span>
            <div className="relative flex-1 min-w-0">
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    className="w-full px-2 py-0.5 text-gray-300 text-left flex items-center justify-between cursor-pointer hover:text-white transition-colors min-w-0"
                >
                    <span className="truncate flex-1 mr-1">{displayPaths.get(currentDir.path) || currentDir.path}</span>
                    <i
                        className={`fa-sharp fa-solid fa-chevron-${isOpen ? "up" : "down"} text-[10px] flex-shrink-0 opacity-60`}
                    ></i>
                </button>
                {isOpen && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-gray-800 border border-gray-600 rounded shadow-lg z-50 max-h-60 overflow-y-auto">
                        {directories.map((dir, idx) => (
                            <button
                                key={idx}
                                onClick={() => {
                                    setSelectedDir(dir);
                                    setIsOpen(false);
                                }}
                                className={`w-full px-3 py-1.5 text-left text-xs hover:bg-gray-700 transition-colors cursor-pointer flex items-center gap-2 ${
                                    dir.path === selectedDir?.path ? "bg-gray-700 text-white" : "text-gray-300"
                                }`}
                            >
                                {getIcon(dir.source)}
                                <div className="truncate flex-1">{displayPaths.get(dir.path) || dir.path}</div>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
});

WorkingDirectoriesStrip.displayName = "WorkingDirectoriesStrip";
