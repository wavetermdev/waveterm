// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { fileInfoToTreeNodeData } from "@/app/fileexplorer/fileexplorer";
import { describe, expect, it } from "vitest";

describe("fileInfoToTreeNodeData", () => {
    it("maps directories to unloaded tree nodes", () => {
        const fileInfo: FileInfo = {
            path: "~/projects",
            name: "projects",
            isdir: true,
            readonly: true,
        };

        expect(fileInfoToTreeNodeData(fileInfo, "~")).toEqual({
            id: "~/projects",
            parentId: "~",
            path: "~/projects",
            label: "projects",
            isDirectory: true,
            mimeType: undefined,
            isReadonly: true,
            notfound: undefined,
            staterror: undefined,
            childrenStatus: "unloaded",
        });
    });

    it("maps files to loaded tree nodes", () => {
        const fileInfo: FileInfo = {
            path: "~/notes/todo.md",
            name: "todo.md",
            isdir: false,
            mimetype: "text/markdown",
        };

        expect(fileInfoToTreeNodeData(fileInfo, "~/notes")).toEqual({
            id: "~/notes/todo.md",
            parentId: "~/notes",
            path: "~/notes/todo.md",
            label: "todo.md",
            isDirectory: false,
            mimeType: "text/markdown",
            isReadonly: undefined,
            notfound: undefined,
            staterror: undefined,
            childrenStatus: "loaded",
        });
    });

    it("falls back to a stable serialized id when path is missing", () => {
        const fileInfo: FileInfo = {
            name: "mystery",
            isdir: false,
        };

        expect(fileInfoToTreeNodeData(fileInfo, "~").id).toBe("~::mystery::::file::");
    });
});
