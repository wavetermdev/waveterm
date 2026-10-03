// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from "vitest";
import { bookmarkIcon, bookmarkLabel, buildBookmarkMenu } from "./bookmarks-menu";

const folder = { key: "k", bookmarktype: "folder", label: "Home", path: "~" } as any;

describe("bookmark menu helpers", () => {
    it("icon by type", () => {
        expect(bookmarkIcon(folder)).toBe("folder");
        expect(bookmarkIcon({ ...folder, bookmarktype: "docpos" })).toBe("bookmark");
        expect(bookmarkIcon({ ...folder, bookmarktype: "file" })).toBe("file");
    });
    it("label falls back to path", () => {
        expect(bookmarkLabel({ ...folder, label: "" })).toBe("~");
    });
    it("builds menu with entries + actions", () => {
        const onOpen = vi.fn();
        const menu = buildBookmarkMenu([folder], { onOpen, onAddCurrent: vi.fn(), onEdit: vi.fn() });
        expect(menu.length).toBe(4); // 1 bookmark + separator + add + edit
        (menu[0] as any).click();
        expect(onOpen).toHaveBeenCalledWith(folder);
    });
});
