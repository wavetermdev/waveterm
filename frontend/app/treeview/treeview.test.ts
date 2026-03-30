// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { buildVisibleRows, TreeNodeData } from "@/app/treeview/treeview";
import { describe, expect, it } from "vitest";

function makeNodes(entries: TreeNodeData[]): Map<string, TreeNodeData> {
    return new Map(entries.map((entry) => [entry.id, entry]));
}

describe("treeview visible rows", () => {
    it("sorts directories before files and alphabetically", () => {
        const nodes = makeNodes([
            {
                id: "root",
                isDirectory: true,
                childrenStatus: "loaded",
                childrenIds: ["c", "a", "b"],
            },
            { id: "a", parentId: "root", isDirectory: false, label: "z-last.txt" },
            { id: "b", parentId: "root", isDirectory: true, label: "docs", childrenStatus: "loaded", childrenIds: [] },
            { id: "c", parentId: "root", isDirectory: false, label: "a-first.txt" },
        ]);
        const rows = buildVisibleRows(nodes, ["root"], new Set(["root"]));
        expect(rows.map((row) => row.id)).toEqual(["root", "b", "c", "a"]);
    });

    it("renders loading and capped synthetic rows", () => {
        const nodes = makeNodes([
            { id: "root", isDirectory: true, childrenStatus: "loading" },
            {
                id: "dir",
                isDirectory: true,
                childrenStatus: "capped",
                childrenIds: ["f1"],
                capInfo: { max: 1 },
            },
            { id: "f1", parentId: "dir", isDirectory: false, label: "one.txt" },
        ]);
        const loadingRows = buildVisibleRows(nodes, ["root"], new Set(["root"]));
        expect(loadingRows.map((row) => row.kind)).toEqual(["node", "loading"]);

        const cappedRows = buildVisibleRows(nodes, ["dir"], new Set(["dir"]));
        expect(cappedRows.map((row) => row.kind)).toEqual(["node", "node", "capped"]);
    });
});
