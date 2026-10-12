// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms } from "@/app/store/global-atoms";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { Atom, atom } from "jotai";

type BookmarkEntry = FileBookmark & { key: string };

function sortBookmarks(map: { [key: string]: FileBookmark }): BookmarkEntry[] {
    if (map == null) {
        return [];
    }
    const entries: BookmarkEntry[] = Object.keys(map).map((key) => ({ key, ...map[key] }));
    entries.sort((a, b) => (a["display:order"] ?? 0) - (b["display:order"] ?? 0));
    return entries;
}

function nextDisplayOrder(entries: BookmarkEntry[]): number {
    let max = 0;
    for (const e of entries) {
        const ord = e["display:order"] ?? 0;
        if (ord > max) {
            max = ord;
        }
    }
    return max + 1;
}

const fileBookmarksAtom: Atom<BookmarkEntry[]> = atom((get) => {
    const fullConfig = get(atoms.fullConfigAtom);
    return sortBookmarks(fullConfig?.filebookmarks);
});

class BookmarksModel {
    private static instance: BookmarksModel | null = null;

    static getInstance(): BookmarksModel {
        if (!BookmarksModel.instance) {
            BookmarksModel.instance = new BookmarksModel();
        }
        return BookmarksModel.instance;
    }

    private constructor() {}

    getBookmarks(): BookmarkEntry[] {
        return globalStore.get(fileBookmarksAtom);
    }

    async add(bookmark: FileBookmark): Promise<string> {
        const key = crypto.randomUUID();
        const order = nextDisplayOrder(this.getBookmarks());
        await RpcApi.SetFileBookmarkCommand(TabRpcClient, {
            key,
            bookmark: { ...bookmark, "display:order": order },
        });
        return key;
    }

    async update(key: string, patch: Partial<FileBookmark>): Promise<void> {
        const existing = this.getBookmarks().find((b) => b.key == key);
        if (existing == null) {
            return;
        }
        const { key: _omit, ...rest } = existing;
        await RpcApi.SetFileBookmarkCommand(TabRpcClient, {
            key,
            bookmark: { ...rest, ...patch },
        });
    }

    async remove(key: string): Promise<void> {
        await RpcApi.DeleteFileBookmarkCommand(TabRpcClient, key);
    }

    async reorder(orderedKeys: string[]): Promise<void> {
        const byKey = new Map(this.getBookmarks().map((b) => [b.key, b]));
        for (let i = 0; i < orderedKeys.length; i++) {
            const b = byKey.get(orderedKeys[i]);
            if (b == null) {
                continue;
            }
            const newOrder = i + 1;
            if ((b["display:order"] ?? 0) == newOrder) {
                continue;
            }
            const { key: _omit, ...rest } = b;
            await RpcApi.SetFileBookmarkCommand(TabRpcClient, {
                key: b.key,
                bookmark: { ...rest, "display:order": newOrder },
            });
        }
    }
}

export { BookmarksModel, fileBookmarksAtom, nextDisplayOrder, sortBookmarks };
export type { BookmarkEntry };
