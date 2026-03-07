// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { isDev } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { TreeNodeData, TreeView } from "@/app/treeview/treeview";
import { cn, makeConnRoute } from "@/util/util";
import { memo, useCallback, useMemo, useState } from "react";

const FileExplorerRootId = "~";
const FileExplorerConn = "local";
const FileExplorerRootNode: TreeNodeData = {
    id: FileExplorerRootId,
    path: FileExplorerRootId,
    label: FileExplorerRootId,
    isDirectory: true,
    childrenStatus: "unloaded",
};

export function fileInfoToTreeNodeData(fileInfo: FileInfo, parentId: string): TreeNodeData {
    const nodeId =
        fileInfo.path ??
        [
            parentId,
            fileInfo.name ?? "",
            fileInfo.dir ?? "",
            fileInfo.isdir ? "dir" : "file",
            fileInfo.staterror ?? "",
        ].join("::");
    return {
        id: nodeId,
        parentId,
        path: fileInfo.path,
        label: fileInfo.name ?? fileInfo.path ?? nodeId,
        isDirectory: !!fileInfo.isdir,
        mimeType: fileInfo.mimetype,
        isReadonly: fileInfo.readonly,
        notfound: fileInfo.notfound,
        staterror: fileInfo.staterror,
        childrenStatus: fileInfo.isdir ? "unloaded" : "loaded",
    };
}

const FileExplorerPanel = memo(() => {
    const [selectedPath, setSelectedPath] = useState<string>(FileExplorerRootId);
    const initialNodes = useMemo(() => ({ [FileExplorerRootId]: FileExplorerRootNode }), []);
    const initialExpandedIds = useMemo(() => [FileExplorerRootId], []);

    const fetchDir = useCallback(async (id: string, limit: number) => {
        const nodes: TreeNodeData[] = [];
        for await (const response of RpcApi.RemoteListEntriesCommand(
            TabRpcClient,
            { path: id, opts: { limit } },
            { route: makeConnRoute(FileExplorerConn) }
        )) {
            for (const fileInfo of response.fileinfo ?? []) {
                nodes.push(fileInfoToTreeNodeData(fileInfo, id));
            }
        }
        return { nodes };
    }, []);

    if (!isDev()) {
        return null;
    }

    return (
        <div className="flex h-full min-h-0 flex-col bg-panel">
            <div className="border-b border-border px-4 py-3">
                <div className="text-sm font-semibold text-foreground">File Explorer</div>
                <div className="mt-1 overflow-hidden whitespace-nowrap text-ellipsis text-xs text-muted">local • {selectedPath}</div>
            </div>
            <div className="min-h-0 flex-1">
                <TreeView
                    rootIds={[FileExplorerRootId]}
                    initialNodes={initialNodes}
                    initialExpandedIds={initialExpandedIds}
                    fetchDir={fetchDir}
                    width="100%"
                    minWidth={0}
                    maxWidth={100000}
                    height="100%"
                    className={cn("h-full rounded-none border-0")}
                    expandDirectoriesOnClick
                    onSelectionChange={(_, node) => setSelectedPath(node.path ?? node.id)}
                />
            </div>
        </div>
    );
});

FileExplorerPanel.displayName = "FileExplorerPanel";

export { FileExplorerPanel };
