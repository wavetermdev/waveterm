// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { TreeNodeData, TreeView } from "@/app/treeview/treeview";
import { useMemo, useState } from "react";

const RootId = "workspace:/";
const RootNode: TreeNodeData = {
    id: RootId,
    path: RootId,
    label: "workspace",
    isDirectory: true,
    childrenStatus: "unloaded",
};

const DirectoryData: Record<string, TreeNodeData[]> = {
    [RootId]: [
        { id: "workspace:/src", path: "workspace:/src", label: "src", parentId: RootId, isDirectory: true },
        { id: "workspace:/docs", path: "workspace:/docs", label: "docs", parentId: RootId, isDirectory: true },
        { id: "workspace:/README.md", path: "workspace:/README.md", label: "README.md", parentId: RootId, isDirectory: false, mimeType: "text/markdown" },
        { id: "workspace:/package.json", path: "workspace:/package.json", label: "package.json", parentId: RootId, isDirectory: false, mimeType: "application/json" },
    ],
    "workspace:/src": [
        { id: "workspace:/src/app", path: "workspace:/src/app", label: "app", parentId: "workspace:/src", isDirectory: true },
        { id: "workspace:/src/styles", path: "workspace:/src/styles", label: "styles", parentId: "workspace:/src", isDirectory: true },
        ...Array.from({ length: 200 }).map((_, idx) => ({
            id: `workspace:/src/file-${idx.toString().padStart(3, "0")}.tsx`,
            path: `workspace:/src/file-${idx.toString().padStart(3, "0")}.tsx`,
            label: `file-${idx.toString().padStart(3, "0")}.tsx`,
            parentId: "workspace:/src",
            isDirectory: false,
            mimeType: "text/typescript",
        })),
    ],
    "workspace:/src/app": [
        { id: "workspace:/src/app/main.tsx", path: "workspace:/src/app/main.tsx", label: "main.tsx", parentId: "workspace:/src/app", isDirectory: false, mimeType: "text/typescript" },
        { id: "workspace:/src/app/router.ts", path: "workspace:/src/app/router.ts", label: "router.ts", parentId: "workspace:/src/app", isDirectory: false, mimeType: "text/typescript" },
    ],
    "workspace:/src/styles": [
        { id: "workspace:/src/styles/app.css", path: "workspace:/src/styles/app.css", label: "app.css", parentId: "workspace:/src/styles", isDirectory: false, mimeType: "text/css" },
    ],
    "workspace:/docs": Array.from({ length: 25 }).map((_, idx) => ({
        id: `workspace:/docs/page-${idx + 1}.md`,
        path: `workspace:/docs/page-${idx + 1}.md`,
        label: `page-${idx + 1}.md`,
        parentId: "workspace:/docs",
        isDirectory: false,
        mimeType: "text/markdown",
    })),
};

export function TreeViewPreview() {
    const [width, setWidth] = useState(260);
    const [selection, setSelection] = useState<string>(RootId);
    const initialNodes = useMemo(() => ({ [RootId]: RootNode }), []);

    return (
        <div className="w-full max-w-[900px] px-6">
            <div className="mb-4 rounded-md border border-border bg-panel p-4">
                <div className="text-xs text-muted">Tree width: {width}px</div>
                <input
                    type="range"
                    min={100}
                    max={400}
                    value={width}
                    onChange={(event) => setWidth(Number(event.target.value))}
                    className="mt-2 w-full cursor-pointer"
                />
                <div className="mt-3 text-xs text-muted">Selection: {selection}</div>
            </div>
            <TreeView
                rootIds={[RootId]}
                initialNodes={initialNodes}
                width={width}
                minWidth={100}
                maxWidth={400}
                height={420}
                maxDirEntries={120}
                fetchDir={async (id, limit) => {
                    await new Promise((resolve) => setTimeout(resolve, 220));
                    const entries = DirectoryData[id] ?? [];
                    return {
                        nodes: entries.slice(0, limit),
                        capped: entries.length > limit,
                        totalKnown: entries.length,
                    };
                }}
                onOpenFile={(id) => {
                    setSelection(`open:${id}`);
                }}
                onSelectionChange={(id) => {
                    setSelection(id);
                }}
            />
        </div>
    );
}
