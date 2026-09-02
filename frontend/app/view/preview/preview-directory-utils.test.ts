// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { applyClearSelection, applySelectAll, applySelectionClick, buildDragFileItems, buildDropFileCopyOpts, buildSelectionItems, decideNativeDropRoute, formatDeleteConfirmText, getDragChipText, getDropBannerText, getFirstFocusableIndex, joinRemoteDir, moveFocusIndex, osDraggableItems, resolveDeleteItems } from "./preview-directory-utils";

describe("getFirstFocusableIndex", () => {
    it("skips the .. row at index 0 when present", () => {
        expect(getFirstFocusableIndex(true)).toBe(1);
    });

    it("starts at index 0 when there is no .. row", () => {
        expect(getFirstFocusableIndex(false)).toBe(0);
    });
});

describe("moveFocusIndex", () => {
    it("enters at the first selectable row from no-focus (down), skipping ..", () => {
        expect(moveFocusIndex(-1, 5, true, "down")).toBe(1);
    });

    it("enters at the first row from no-focus (down) when .. is absent", () => {
        expect(moveFocusIndex(-1, 5, false, "down")).toBe(0);
    });

    it("enters at the last row from no-focus (up)", () => {
        expect(moveFocusIndex(-1, 5, true, "up")).toBe(4);
        expect(moveFocusIndex(-1, 5, false, "up")).toBe(4);
    });

    it("pagedown/pageup from no-focus enter at first/last respectively", () => {
        expect(moveFocusIndex(-1, 5, true, "pagedown")).toBe(1);
        expect(moveFocusIndex(-1, 5, true, "pageup")).toBe(4);
    });

    it("moves down one row from a focused row", () => {
        expect(moveFocusIndex(2, 5, true, "down")).toBe(3);
    });

    it("moves up one row from a focused row", () => {
        expect(moveFocusIndex(2, 5, true, "up")).toBe(1);
    });

    it("ArrowUp from the first selectable row stays put (skips ..)", () => {
        expect(moveFocusIndex(1, 5, true, "up")).toBe(1);
    });

    it("treats a focus on the .. row (index 0) as no-focus and re-enters", () => {
        expect(moveFocusIndex(0, 5, true, "down")).toBe(1);
        expect(moveFocusIndex(0, 5, true, "up")).toBe(4);
    });

    it("clamps at the last row", () => {
        expect(moveFocusIndex(4, 5, true, "down")).toBe(4);
    });

    it("clamps a large pagedown at the last row", () => {
        expect(moveFocusIndex(0, 3, false, "pagedown")).toBe(2);
    });

    it("clamps an out-of-range index back into range", () => {
        expect(moveFocusIndex(5, 3, false, "down")).toBe(2);
    });

    it("returns -1 when there are no rows", () => {
        expect(moveFocusIndex(-1, 0, false, "down")).toBe(-1);
    });

    it("returns -1 when only the .. row exists (no focusable rows)", () => {
        expect(moveFocusIndex(-1, 1, true, "down")).toBe(-1);
    });
});

describe("buildDropFileCopyOpts", () => {
    const yearTimeout = 31536000000; // one year

    it("file + copy -> no recursive flag, year timeout", () => {
        const opts = buildDropFileCopyOpts(false, false);
        expect(opts.recursive).toBeUndefined();
        expect(opts.timeout).toBe(yearTimeout);
    });

    it("directory + copy -> no recursive flag (copy is always recursive backend-side)", () => {
        const opts = buildDropFileCopyOpts(true, false);
        expect(opts.recursive).toBeUndefined();
        expect(opts.timeout).toBe(yearTimeout);
    });

    it("directory + move -> recursive === true", () => {
        const opts = buildDropFileCopyOpts(true, true);
        expect(opts.recursive).toBe(true);
        expect(opts.timeout).toBe(yearTimeout);
    });

    it("file + move -> no recursive flag", () => {
        const opts = buildDropFileCopyOpts(false, true);
        expect(opts.recursive).toBeUndefined();
        expect(opts.timeout).toBe(yearTimeout);
    });
});

describe("decideNativeDropRoute", () => {
    const multiSourceSameParent: DragSourceState = {
        move: false,
        files: [
            { uri: "wsh://conn//home/user/a.txt", absParent: "/home/user", relName: "a.txt", isDir: false },
            { uri: "wsh://conn//home/user/b.txt", absParent: "/home/user", relName: "b.txt", isDir: false },
        ],
    };
    const multiSourceOtherParent: DragSourceState = {
        move: false,
        files: [
            { uri: "wsh://conn//home/user/a.txt", absParent: "/home/user", relName: "a.txt", isDir: false },
            { uri: "wsh://conn//home/other/b.txt", absParent: "/home/other", relName: "b.txt", isDir: false },
        ],
    };

    it("routes our own drag to a different directory as inapp (copy)", () => {
        expect(decideNativeDropRoute(multiSourceOtherParent, "/home/dest")).toBe("inapp");
    });

    it("routes an OS-file drag (no drag source) as upload", () => {
        expect(decideNativeDropRoute(null, "/home/user")).toBe("upload");
    });

    it("rejects a multi-file drag when every file's parent matches the drop dir", () => {
        expect(decideNativeDropRoute(multiSourceSameParent, "/home/user")).toBe("reject");
    });

    it("rejects a multi-file drag with a mixed parent (inapp) when any parent differs", () => {
        expect(decideNativeDropRoute(multiSourceOtherParent, "/home/user")).toBe("inapp");
    });

    it("treats an empty file list as inapp (not reject)", () => {
        expect(decideNativeDropRoute({ files: [], move: false }, "/home/user")).toBe("inapp");
    });

    it("rejects when dirPath is null or undefined", () => {
        expect(decideNativeDropRoute(multiSourceSameParent, null)).toBe("reject");
        expect(decideNativeDropRoute(multiSourceSameParent, undefined)).toBe("reject");
    });
});

describe("getDropBannerText", () => {
    const internalCopy: DragSourceState = { move: false, files: [] };
    const internalMove: DragSourceState = { move: true, files: [] };

    it("external OS drag (no drag source) advertises upload", () => {
        expect(getDropBannerText(null)).toBe("Drop files here to upload");
    });

    it("internal copy drag advertises copy", () => {
        expect(getDropBannerText(internalCopy)).toBe("Drop to copy here");
    });

    it("internal move drag advertises move", () => {
        expect(getDropBannerText(internalMove)).toBe("Drop to move here");
    });
});

describe("getDragChipText", () => {
    it("returns an empty string when there is no drag source", () => {
        expect(getDragChipText(null)).toBe("");
    });

    it("describes a single-file copy", () => {
        expect(
            getDragChipText({
                move: false,
                files: [{ uri: "u", absParent: "/d", relName: "a.txt", isDir: false }],
            })
        ).toBe("Copying 1 item");
    });

    it("describes a multi-file move", () => {
        expect(
            getDragChipText({
                move: true,
                files: [
                    { uri: "u1", absParent: "/d", relName: "a.txt", isDir: false },
                    { uri: "u2", absParent: "/d", relName: "b.txt", isDir: false },
                ],
            })
        ).toBe("Moving 2 items");
    });
});

describe("joinRemoteDir", () => {
    it("joins a plain directory and entry name", () => {
        expect(joinRemoteDir("/home/user", "a.txt")).toBe("/home/user/a.txt");
    });

    it("strips a trailing slash on dirPath before joining", () => {
        expect(joinRemoteDir("/home/user/", "a.txt")).toBe("/home/user/a.txt");
    });

    it("does not produce a double slash when dirPath is the filesystem root", () => {
        expect(joinRemoteDir("/", "a.txt")).toBe("/a.txt");
    });

    it("passes through an empty relName, returning the cleaned directory", () => {
        expect(joinRemoteDir("/home/user/", "")).toBe("/home/user");
    });

    it("handles a remote URI directory with a trailing slash", () => {
        expect(joinRemoteDir("wsh://conn//home/user/", "a.txt")).toBe("wsh://conn//home/user/a.txt");
    });
});

describe("buildDragFileItems", () => {
    const entries = [
        { path: "/dir/..", name: "..", isdir: true },
        { path: "/dir/a.txt", name: "a.txt", isdir: false },
        { path: "/dir/b.txt", name: "b.txt", isdir: false },
        { path: "/dir/sub", name: "sub", isdir: true },
        { path: "/dir/c.txt", name: "c.txt", isdir: false },
    ];

    it("dragging a selected path picks all selected entries INCLUDING directories (excludes ..)", () => {
        const selectedPaths = new Set(["/dir/a.txt", "/dir/b.txt", "/dir/sub"]);
        const files = buildDragFileItems(selectedPaths, "/dir/a.txt", entries, "/dir", "conn");
        expect(files).toEqual([
            { relName: "a.txt", absParent: "/dir", uri: "wsh://conn//dir/a.txt", isDir: false },
            { relName: "b.txt", absParent: "/dir", uri: "wsh://conn//dir/b.txt", isDir: false },
            { relName: "sub", absParent: "/dir", uri: "wsh://conn//dir/sub", isDir: true },
        ]);
    });

    it("dragging an unselected path picks just that single file", () => {
        const selectedPaths = new Set(["/dir/a.txt"]);
        const files = buildDragFileItems(selectedPaths, "/dir/c.txt", entries, "/dir", "conn");
        expect(files).toEqual([
            { relName: "c.txt", absParent: "/dir", uri: "wsh://conn//dir/c.txt", isDir: false },
        ]);
    });

    it("dragging an unselected directory picks just that directory with isDir true", () => {
        const selectedPaths = new Set(["/dir/a.txt"]);
        const files = buildDragFileItems(selectedPaths, "/dir/sub", entries, "/dir", "conn");
        expect(files).toEqual([
            { relName: "sub", absParent: "/dir", uri: "wsh://conn//dir/sub", isDir: true },
        ]);
    });

    it("a mixed files+dirs selection returns both with correct isDir", () => {
        const selectedPaths = new Set(["/dir/a.txt", "/dir/sub"]);
        const files = buildDragFileItems(selectedPaths, "/dir/a.txt", entries, "/dir", "conn");
        expect(files).toEqual([
            { relName: "a.txt", absParent: "/dir", uri: "wsh://conn//dir/a.txt", isDir: false },
            { relName: "sub", absParent: "/dir", uri: "wsh://conn//dir/sub", isDir: true },
        ]);
    });

    it("never includes the .. entry even when selected", () => {
        const selectedPaths = new Set(["/dir/..", "/dir/sub"]);
        const files = buildDragFileItems(selectedPaths, "/dir/..", entries, "/dir", "conn");
        expect(files).toEqual([
            { relName: "sub", absParent: "/dir", uri: "wsh://conn//dir/sub", isDir: true },
        ]);
    });
});

describe("osDraggableItems", () => {
    const mixed: DraggedFile[] = [
        { relName: "a.txt", absParent: "/dir", uri: "wsh://conn//dir/a.txt", isDir: false },
        { relName: "sub", absParent: "/dir", uri: "wsh://conn//dir/sub", isDir: true },
        { relName: "b.txt", absParent: "/dir", uri: "wsh://conn//dir/b.txt", isDir: false },
    ];

    it("keeps files and drops directories", () => {
        expect(osDraggableItems(mixed)).toEqual([
            { relName: "a.txt", absParent: "/dir", uri: "wsh://conn//dir/a.txt", isDir: false },
            { relName: "b.txt", absParent: "/dir", uri: "wsh://conn//dir/b.txt", isDir: false },
        ]);
    });

    it("returns [] for a directory-only selection", () => {
        const dirsOnly: DraggedFile[] = [
            { relName: "sub", absParent: "/dir", uri: "wsh://conn//dir/sub", isDir: true },
        ];
        expect(osDraggableItems(dirsOnly)).toEqual([]);
    });

    it("returns [] for an empty list", () => {
        expect(osDraggableItems([])).toEqual([]);
    });
});

describe("buildSelectionItems", () => {
    const entries = [
        { path: "/dir/..", name: "..", isdir: true },
        { path: "/dir/a.txt", name: "a.txt", isdir: false },
        { path: "/dir/b.txt", name: "b.txt", isdir: false },
        { path: "/dir/sub", name: "sub", isdir: true },
    ];

    it("builds all selected items INCLUDING directories (excludes ..), with correct uri/absParent/isDir", () => {
        const selectedPaths = new Set(["/dir/a.txt", "/dir/sub", "/dir/.."]);
        const items = buildSelectionItems(selectedPaths, entries, "/dir", "conn");
        expect(items).toEqual([
            { relName: "a.txt", absParent: "/dir", uri: "wsh://conn//dir/a.txt", isDir: false },
            { relName: "sub", absParent: "/dir", uri: "wsh://conn//dir/sub", isDir: true },
        ]);
    });

    it("empty selection -> []", () => {
        expect(buildSelectionItems(new Set(), entries, "/dir", "conn")).toEqual([]);
    });
});

const selectablePaths = ["/a", "/b", "/c", "/d"];

describe("applySelectionClick", () => {
    it("plain click replaces the selection with a single path and sets the anchor", () => {
        const prev = { selectedPaths: new Set(["/b"]), anchor: "/b" };
        const next = applySelectionClick(prev, "/c", { cmd: false, shift: false }, selectablePaths);
        expect([...next.selectedPaths]).toEqual(["/c"]);
        expect(next.anchor).toBe("/c");
    });

    it("cmd-click toggles a path on and sets the anchor to that path", () => {
        const prev = { selectedPaths: new Set(["/a"]), anchor: "/a" };
        const next = applySelectionClick(prev, "/b", { cmd: true, shift: false }, selectablePaths);
        expect([...next.selectedPaths].sort()).toEqual(["/a", "/b"]);
        expect(next.anchor).toBe("/b");
    });

    it("cmd-click toggles a path off and sets the anchor to that path", () => {
        const prev = { selectedPaths: new Set(["/a", "/b"]), anchor: "/a" };
        const next = applySelectionClick(prev, "/b", { cmd: true, shift: false }, selectablePaths);
        expect([...next.selectedPaths]).toEqual(["/a"]);
        expect(next.anchor).toBe("/b");
    });

    it("shift-click selects a contiguous forward range and keeps the anchor", () => {
        const prev = { selectedPaths: new Set(["/a"]), anchor: "/a" };
        const next = applySelectionClick(prev, "/c", { cmd: false, shift: true }, selectablePaths);
        expect([...next.selectedPaths].sort()).toEqual(["/a", "/b", "/c"]);
        expect(next.anchor).toBe("/a");
    });

    it("shift-click selects a contiguous reverse range and keeps the anchor", () => {
        const prev = { selectedPaths: new Set(["/c"]), anchor: "/c" };
        const next = applySelectionClick(prev, "/a", { cmd: false, shift: true }, selectablePaths);
        expect([...next.selectedPaths].sort()).toEqual(["/a", "/b", "/c"]);
        expect(next.anchor).toBe("/c");
    });

    it("shift-click with a null anchor falls back to plain selection", () => {
        const prev = { selectedPaths: new Set(), anchor: null };
        const next = applySelectionClick(prev, "/b", { cmd: false, shift: true }, selectablePaths);
        expect([...next.selectedPaths]).toEqual(["/b"]);
        expect(next.anchor).toBe("/b");
    });

    it("shift-click with an anchor not in selectablePaths falls back to plain selection", () => {
        const prev = { selectedPaths: new Set(), anchor: "/missing" };
        const next = applySelectionClick(prev, "/b", { cmd: false, shift: true }, selectablePaths);
        expect([...next.selectedPaths]).toEqual(["/b"]);
        expect(next.anchor).toBe("/b");
    });
});

describe("applySelectAll", () => {
    it("selects every selectable path and anchors at the first", () => {
        const next = applySelectAll(selectablePaths);
        expect([...next.selectedPaths].sort()).toEqual(["/a", "/b", "/c", "/d"]);
        expect(next.anchor).toBe("/a");
    });

    it("handles an empty selectable list with a null anchor", () => {
        const next = applySelectAll([]);
        expect(next.selectedPaths.size).toBe(0);
        expect(next.anchor).toBeNull();
    });
});

describe("applyClearSelection", () => {
    it("empties the selection and clears the anchor", () => {
        const next = applyClearSelection();
        expect(next.selectedPaths.size).toBe(0);
        expect(next.anchor).toBeNull();
    });
});

const deleteEntries = [
    { path: "/dir/..", name: "..", isdir: true },
    { path: "/dir/a.txt", name: "a.txt", isdir: false },
    { path: "/dir/b.txt", name: "b.txt", isdir: false },
    { path: "/dir/sub", name: "sub", isdir: true },
];

describe("resolveDeleteItems", () => {
    it("right-clicking an unselected path deletes just that item", () => {
        const selectedPaths = new Set(["/dir/a.txt"]);
        const items = resolveDeleteItems(selectedPaths, "/dir/b.txt", deleteEntries);
        expect(items).toEqual([{ path: "/dir/b.txt", name: "b.txt", isdir: false }]);
    });

    it("right-clicking an already-selected path deletes the whole selection", () => {
        const selectedPaths = new Set(["/dir/a.txt", "/dir/b.txt"]);
        const items = resolveDeleteItems(selectedPaths, "/dir/a.txt", deleteEntries);
        expect(items).toEqual([
            { path: "/dir/a.txt", name: "a.txt", isdir: false },
            { path: "/dir/b.txt", name: "b.txt", isdir: false },
        ]);
    });

    it("clickedPath null deletes the whole selection", () => {
        const selectedPaths = new Set(["/dir/a.txt", "/dir/sub"]);
        const items = resolveDeleteItems(selectedPaths, null, deleteEntries);
        expect(items).toEqual([
            { path: "/dir/a.txt", name: "a.txt", isdir: false },
            { path: "/dir/sub", name: "sub", isdir: true },
        ]);
    });

    it("never includes the .. entry", () => {
        const selectedPaths = new Set(["/dir/..", "/dir/a.txt"]);
        const items = resolveDeleteItems(selectedPaths, null, deleteEntries);
        expect(items).toEqual([{ path: "/dir/a.txt", name: "a.txt", isdir: false }]);
    });
});

describe("formatDeleteConfirmText", () => {
    it("returns an empty string for an empty list", () => {
        expect(formatDeleteConfirmText([])).toBe("");
    });

    it("names a single file", () => {
        expect(formatDeleteConfirmText([{ path: "/dir/a.txt", name: "a.txt", isdir: false }])).toBe('Delete "a.txt"?');
    });

    it("names a single directory with contents wording", () => {
        expect(formatDeleteConfirmText([{ path: "/dir/reports", name: "reports", isdir: true }])).toBe(
            'Delete "reports" and all its contents?'
        );
    });

    it("falls back to the basename when name is missing", () => {
        expect(formatDeleteConfirmText([{ path: "/dir/a.txt", isdir: false }])).toBe('Delete "a.txt"?');
    });

    it("lists a few items, marking directories with a trailing slash", () => {
        expect(
            formatDeleteConfirmText([
                { path: "/dir/a.txt", name: "a.txt", isdir: false },
                { path: "/dir/b.txt", name: "b.txt", isdir: false },
                { path: "/dir/notes", name: "notes", isdir: true },
            ])
        ).toBe('Delete 3 items? ("a.txt", "b.txt", "notes/")');
    });

    it("caps long lists at three names with a +N more suffix", () => {
        expect(
            formatDeleteConfirmText([
                { path: "/dir/a.txt", name: "a.txt", isdir: false },
                { path: "/dir/b.txt", name: "b.txt", isdir: false },
                { path: "/dir/notes", name: "notes", isdir: true },
                { path: "/dir/c.txt", name: "c.txt", isdir: false },
                { path: "/dir/d.txt", name: "d.txt", isdir: false },
            ])
        ).toBe('Delete 5 items? ("a.txt", "b.txt", "notes/", +2 more)');
    });

    it("caps a two-name list without a +N more suffix", () => {
        expect(
            formatDeleteConfirmText([
                { path: "/dir/a.txt", name: "a.txt", isdir: false },
                { path: "/dir/b.txt", name: "b.txt", isdir: false },
            ])
        ).toBe('Delete 2 items? ("a.txt", "b.txt")');
    });
});
