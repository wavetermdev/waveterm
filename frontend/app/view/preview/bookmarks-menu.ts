// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { BookmarkEntry } from "@/app/store/bookmarksmodel";

function bookmarkIcon(bm: BookmarkEntry): string {
    if (bm.bookmarktype == "folder") {
        return "folder";
    }
    if (bm.bookmarktype == "docpos") {
        return "bookmark";
    }
    return "file";
}

function bookmarkLabel(bm: BookmarkEntry): string {
    if (bm.label) {
        return bm.label;
    }
    return bm.path;
}

type BookmarkMenuHandlers = {
    onOpen: (bm: BookmarkEntry) => void;
    onAddCurrent: () => void;
    onEdit: () => void;
};

function buildBookmarkMenu(entries: BookmarkEntry[], handlers: BookmarkMenuHandlers): ContextMenuItem[] {
    const menu: ContextMenuItem[] = entries.map((bm) => ({
        label: bookmarkLabel(bm),
        click: () => handlers.onOpen(bm),
    }));
    if (entries.length > 0) {
        menu.push({ type: "separator" });
    }
    menu.push({ label: "Add Current Location", click: () => handlers.onAddCurrent() });
    menu.push({ label: "Edit Bookmarks…", click: () => handlers.onEdit() });
    return menu;
}

export { bookmarkIcon, bookmarkLabel, buildBookmarkMenu };
export type { BookmarkMenuHandlers };
