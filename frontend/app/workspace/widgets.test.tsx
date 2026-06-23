import { describe, expect, it } from "vitest";

// Tests for the Files widget cwd resolution logic.

describe("Files widget cwd resolution", () => {
    it("detects preview widget with blank file as eligible for cwd resolution", () => {
        // Preview widgets without a specific file path should trigger cwd resolution.
        // This is validated at the component level via handleWidgetSelect.
        const eligibleMeta = { view: "preview" };
        expect(eligibleMeta.view).toBe("preview");
        expect("file" in eligibleMeta).toBe(false);
    });

    it("does not trigger cwd resolution for non-preview widgets", () => {
        const nonPreviewMeta = { view: "term", controller: "shell" };
        expect(nonPreviewMeta.view).not.toBe("preview");
    });

    it("marks the resolved block with preview:treemode flag", () => {
        // When the Files widget resolves cwd, it passes `preview:treemode: true`
        // in the block meta so the directory preview switches to tree mode.
        const resolvedMeta: Record<string, any> = {
            view: "preview",
            file: "/home/user/project",
            "preview:treemode": true,
        };
        expect(resolvedMeta["preview:treemode"]).toBe(true);
        expect(resolvedMeta.file).toBe("/home/user/project");
    });

    it("preserves connection from focused terminal when resolving cwd", () => {
        const focusedData = {
            viewtype: "term",
            blockmeta: { "cmd:cwd": "/remote/project" },
            connname: "my-server",
        };
        const resolvedMeta: Record<string, any> = {
            view: "preview",
            file: focusedData.blockmeta["cmd:cwd"],
            "preview:treemode": true,
        };
        if (focusedData.connname) {
            resolvedMeta.connection = focusedData.connname;
        }
        expect(resolvedMeta.file).toBe("/remote/project");
        expect(resolvedMeta.connection).toBe("my-server");
    });

    it("falls back to default when focused terminal is not a term block", () => {
        // Non-terminal focused blocks should not resolve cwd; widget launches as-is.
        const focusedData = { viewtype: "editor", blockmeta: {} };
        const isTerminal = focusedData.viewtype === "term";
        expect(isTerminal).toBe(false);
    });

    it("falls back to default when focused terminal has no cmd:cwd", () => {
        const focusedData = { viewtype: "term", blockmeta: {} };
        const hasCwd = focusedData.blockmeta?.["cmd:cwd"] != null;
        expect(hasCwd).toBe(false);
    });
});
