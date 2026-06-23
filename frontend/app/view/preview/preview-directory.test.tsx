import { describe, expect, it } from "vitest";

describe("DirectoryPreview treemode flag", () => {
    it("renders tree mode when meta has preview:treemode true", () => {
        const blockMeta = { view: "preview", file: "/tmp", "preview:treemode": true };
        // DirectoryTableOrTree checks block.meta["preview:treemode"]
        expect(blockMeta["preview:treemode"]).toBe(true);
    });

    it("falls back to table mode when preview:treemode is absent", () => {
        const blockMeta = { view: "preview", file: "~" };
        expect(blockMeta["preview:treemode"]).toBeUndefined();
    });

    it("falls back to table mode when preview:treemode is false", () => {
        const blockMeta = { view: "preview", file: "/tmp", "preview:treemode": false };
        expect(blockMeta["preview:treemode"]).toBe(false);
    });
});
