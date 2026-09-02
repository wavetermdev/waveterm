// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { fireAndForget, isBlank } from "@/util/util";
import { formatRemoteUri } from "@/util/waveutil";
import dayjs from "dayjs";
import React from "react";
import { type PreviewModel } from "./preview-model";

export type NativeDropRoute = "inapp" | "upload" | "reject";

export const PageJumpSize = 20;

export type FocusDirection = "up" | "down" | "pageup" | "pagedown";

// The ".." row is never keyboard-focusable: when present it occupies index 0,
// so focusable rows begin at index 1; otherwise at index 0.
export function getFirstFocusableIndex(hasDotDot: boolean): number {
    return hasDotDot ? 1 : 0;
}

// Computes the next focus index for arrow/page navigation within a directory
// table. `current` may be -1 (no row focused, e.g. after an off-grid click or
// Escape): focus then enters at the first row for "down"/"pagedown" or the last
// row for "up"/"pageup", always skipping the ".." row. A current index below
// the first focusable row (the ".." row itself, or -1) is treated as "no
// focus". Returns -1 when there are no focusable rows.
export function moveFocusIndex(
    current: number,
    rowCount: number,
    hasDotDot: boolean,
    direction: FocusDirection,
    pageSize: number = PageJumpSize
): number {
    const first = getFirstFocusableIndex(hasDotDot);
    const last = rowCount - 1;
    if (rowCount <= 0 || first > last) {
        return -1;
    }
    const clamp = (i: number) => Math.min(Math.max(i, first), last);
    if (current < first) {
        return direction === "up" || direction === "pageup" ? last : first;
    }
    switch (direction) {
        case "up":
            return clamp(current - 1);
        case "down":
            return clamp(current + 1);
        case "pageup":
            return clamp(current - pageSize);
        case "pagedown":
            return clamp(current + pageSize);
        default:
            return clamp(current);
    }
}

// Decides how a native drop should be handled:
//  - our own widget drag (dragSource set) to a different directory -> "inapp" (copy)
//  - our own widget drag dropped back into its own parent directory -> "reject" (no-op)
//  - no drag source (e.g. OS/Finder/Explorer files) -> "upload"
export function decideNativeDropRoute(
    dragSource: DragSourceState | null,
    dirPath: string | null | undefined
): NativeDropRoute {
    if (dirPath == null) {
        return "reject";
    }
    if (dragSource != null) {
        if (dragSource.files.length > 0 && dragSource.files.every((f) => f.absParent === dirPath)) {
            return "reject";
        }
        return "inapp";
    }
    return "upload";
}

// Returns the overlay banner text shown while a drag is in progress.
// Internal widget drags (dragSource set) advertise the pending copy/move;
// external OS drags (dragSource null) advertise upload. This guarantees the
// upload wording is never shown for our own in-app drags.
export function getDropBannerText(dragSource: DragSourceState | null): string {
    if (dragSource == null) {
        return "Drop files here to upload";
    }
    return dragSource.move ? "Drop to move here" : "Drop to copy here";
}

// Returns the small corner-chip text shown during an internal drag, in place of
// the full-width banner. The mode is taken from dragSource.move (Cmd/Ctrl+drag
// = move) and the count from the dragged file set.
export function getDragChipText(dragSource: DragSourceState | null): string {
    if (dragSource == null) {
        return "";
    }
    const count = dragSource.files.length;
    const noun = count === 1 ? "item" : "items";
    return `${dragSource.move ? "Moving" : "Copying"} ${count} ${noun}`;
}

// Builds the per-item FileCopyOpts for an in-app drop. Directory copies are
// unsupported backend-side (RemoteFileCopyCommand refuses recursive copies), so
// copy opts never set recursive. Directory moves set recursive=true, though
// RemoteFileMoveCommand ignores opts entirely (same-host dir move is os.Rename).
export function buildDropFileCopyOpts(isDir: boolean, move: boolean): FileCopyOpts {
    const opts: FileCopyOpts = { timeout: 31536000000 }; // one year
    if (move && isDir) {
        opts.recursive = true;
    }
    return opts;
}

// Builds the full drag item list from the current selection. If the dragged
// path is part of the selection, every selected item is dragged; otherwise only
// the dragged row. Directories are included (isDir: true) so they participate
// in in-app drops; only the ".." row is excluded. Callers must filter with
// osDraggableItems before passing items to the Electron native drag, which is
// files-only.
export function buildDragFileItems(
    selectedPaths: Set<string>,
    draggedPath: string,
    entries: Array<{ path: string; name: string; isdir: boolean }>,
    dirPath: string,
    connName: string
): DraggedFile[] {
    const paths = selectedPaths.has(draggedPath) ? selectedPaths : new Set<string>([draggedPath]);
    return entries
        .filter((entry) => entry.name !== ".." && paths.has(entry.path))
        .map((entry) => ({
            relName: entry.name,
            absParent: dirPath,
            uri: formatRemoteUri(entry.path, connName),
            isDir: entry.isdir,
        }));
}

// Filters a drag item list down to the items that can be handed to the Electron
// native drag. The native drag streams each item to a temp file for OS drag-out,
// so directories must be excluded (OS folder drag-out is files-only by product
// decision). Directories still participate in in-app drops via dragSource.
export function osDraggableItems(items: DraggedFile[]): DraggedFile[] {
    return items.filter((item) => !item.isDir);
}

// Builds the full selection as DraggedFile items (INCLUDING directories), for
// clipboard copy/cut. The ".." row is excluded.
export function buildSelectionItems(
    selectedPaths: Set<string>,
    entries: Array<{ path: string; name: string; isdir: boolean }>,
    dirPath: string,
    connName: string
): DraggedFile[] {
    return entries
        .filter((entry) => entry.name !== ".." && selectedPaths.has(entry.path))
        .map((entry) => ({
            relName: entry.name,
            absParent: dirPath,
            uri: formatRemoteUri(entry.path, connName),
            isDir: entry.isdir,
        }));
}

// Joins a directory path with a relative entry name to form a full-file
// destination path. Trailing slashes on destDir are stripped (except for the
// filesystem root "/") so the result never contains a double slash. An empty
// relName is a passthrough: the cleaned directory path is returned unchanged
// (callers never pass an empty relName in practice, so no error is warranted).
export function joinRemoteDir(destDir: string, relName: string): string {
    let dir = destDir ?? "";
    while (dir.length > 1 && dir.endsWith("/")) {
        dir = dir.slice(0, -1);
    }
    if (relName == null || relName === "") {
        return dir;
    }
    return `${dir}/${relName}`;
}

export type SelectionState = { selectedPaths: Set<string>; anchor: string | null };

// plain click -> {path}; cmd-click -> toggle path (anchor=path);
// shift-click -> range over selectablePaths from anchor to path (anchor unchanged);
// if anchor is null or not found in selectablePaths, fall back to plain {path}.
// If cmd is set, treat as toggle (ignore shift).
export function applySelectionClick(
    prev: SelectionState,
    path: string,
    opts: { cmd: boolean; shift: boolean },
    selectablePaths: string[]
): SelectionState {
    if (opts.cmd) {
        const nextPaths = new Set(prev.selectedPaths);
        if (nextPaths.has(path)) {
            nextPaths.delete(path);
        } else {
            nextPaths.add(path);
        }
        return { selectedPaths: nextPaths, anchor: path };
    }
    if (opts.shift) {
        const anchorIdx = prev.anchor != null ? selectablePaths.indexOf(prev.anchor) : -1;
        const pathIdx = selectablePaths.indexOf(path);
        if (anchorIdx !== -1 && pathIdx !== -1) {
            const [start, end] = anchorIdx <= pathIdx ? [anchorIdx, pathIdx] : [pathIdx, anchorIdx];
            const nextPaths = new Set<string>();
            for (let i = start; i <= end; i++) {
                nextPaths.add(selectablePaths[i]);
            }
            return { selectedPaths: nextPaths, anchor: prev.anchor };
        }
        return { selectedPaths: new Set([path]), anchor: path };
    }
    return { selectedPaths: new Set([path]), anchor: path };
}

// select all selectablePaths, anchor = first
export function applySelectAll(selectablePaths: string[]): SelectionState {
    return {
        selectedPaths: new Set(selectablePaths),
        anchor: selectablePaths.length > 0 ? selectablePaths[0] : null,
    };
}

// empty set, null anchor
export function applyClearSelection(): SelectionState {
    return { selectedPaths: new Set(), anchor: null };
}

export const overwriteError = "set overwrite flag to delete the existing file";
export const mergeError = "set overwrite flag to delete the existing contents or set merge flag to merge the contents";

export const displaySuffixes = {
    B: "b",
    kB: "k",
    MB: "m",
    GB: "g",
    TB: "t",
    KiB: "k",
    MiB: "m",
    GiB: "g",
    TiB: "t",
};

export function getBestUnit(bytes: number, si = false, sigfig = 3): string {
    if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "-";
    if (bytes === 0) return "0B";

    const units = si ? ["kB", "MB", "GB", "TB"] : ["KiB", "MiB", "GiB", "TiB"];
    const divisor = si ? 1000 : 1024;

    const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(divisor)), units.length);
    const unit = idx === 0 ? "B" : units[idx - 1];
    const value = bytes / Math.pow(divisor, idx);

    return `${parseFloat(value.toPrecision(sigfig))}${displaySuffixes[unit] ?? unit}`;
}

function padDay(day: number) {
    return String(day).padStart(2, " ");
}

export function getLastModifiedTime(unixMillis: number): string {
    const file = dayjs(unixMillis);
    const now = dayjs();

    const day = padDay(file.date());
    const time = file.format("HH:mm");

    if (now.isSame(file, "year")) {
        return `${file.format("MMM")} ${day} ${time}`;
    }

    return `${file.format("YYYY-MM-DD")}`;
}

const iconRegex = /^[a-z0-9- ]+$/;

export function isIconValid(icon: string): boolean {
    if (isBlank(icon)) {
        return false;
    }
    return icon.match(iconRegex) != null;
}

export function getSortIcon(sortType: string | boolean): React.ReactNode {
    switch (sortType) {
        case "asc":
            return <i className="fa-solid fa-chevron-up dir-table-head-direction"></i>;
        case "desc":
            return <i className="fa-solid fa-chevron-down dir-table-head-direction"></i>;
        default:
            return null;
    }
}

export function cleanMimetype(input: string): string {
    const truncated = input.split(";")[0];
    return truncated.trim();
}

export function handleRename(
    model: PreviewModel,
    path: string,
    newPath: string,
    isDir: boolean,
    setErrorMsg: (msg: ErrorMsg) => void
) {
    fireAndForget(async () => {
        try {
            let srcuri = await model.formatRemoteUri(path, globalStore.get);
            if (isDir) {
                srcuri += "/";
            }
            await model.env.rpc.FileMoveCommand(TabRpcClient, {
                srcuri,
                desturi: await model.formatRemoteUri(newPath, globalStore.get),
            });
        } catch (e) {
            const errorText = `${e}`;
            console.warn(`Rename failed: ${errorText}`);
            const errorMsg: ErrorMsg = {
                status: "Rename Failed",
                text: `${e}`,
            };
            setErrorMsg(errorMsg);
        }
        model.refresh();
    });
}

// Decides which items to delete. Right-clicking an unselected row deletes just
// that row; otherwise (keyboard, or right-clicking an already-selected row)
// deletes the whole selection. The ".." row is always excluded. Each item
// carries its display name so the confirmation text can name the items.
export function resolveDeleteItems(
    selectedPaths: Set<string>,
    clickedPath: string | null,
    entries: Array<{ path: string; name: string; isdir: boolean }>
): Array<{ path: string; name: string; isdir: boolean }> {
    const paths = clickedPath != null && !selectedPaths.has(clickedPath) ? new Set<string>([clickedPath]) : selectedPaths;
    return entries
        .filter((entry) => entry.name !== ".." && paths.has(entry.path))
        .map((entry) => ({ path: entry.path, name: entry.name, isdir: entry.isdir }));
}

// Formats the confirmation text for a delete operation. Single items are named
// directly (directories call out "and all its contents"); multiple items show up
// to three names (directories marked with a trailing slash) plus a "+N more"
// suffix for the rest. Returns "" for an empty list (nothing to confirm).
export function formatDeleteConfirmText(items: Array<{ path: string; name?: string; isdir: boolean }>): string {
    if (items.length === 0) {
        return "";
    }
    const names = items.map((item) => item.name ?? item.path.split("/").at(-1) ?? item.path);
    if (items.length === 1) {
        const name = names[0];
        return items[0].isdir ? `Delete "${name}" and all its contents?` : `Delete "${name}"?`;
    }
    const shownCount = Math.min(items.length, 3);
    const shown: string[] = [];
    for (let i = 0; i < shownCount; i++) {
        shown.push(items[i].isdir ? `${names[i]}/` : names[i]);
    }
    const extra = items.length - shownCount;
    const list = shown.map((name) => `"${name}"`).join(", ");
    const suffix = extra > 0 ? `, +${extra} more` : "";
    return `Delete ${items.length} items? (${list}${suffix})`;
}

export function handleFileDeleteBatch(
    model: PreviewModel,
    items: Array<{ path: string; name: string; isdir: boolean }>,
    confirm: (msg: ErrorMsg) => void,
    setErrorMsg: (msg: ErrorMsg) => void
): void {
    if (items.length === 0) {
        return;
    }
    const doDelete = () => {
        fireAndForget(async () => {
            for (const item of items) {
                try {
                    const formattedPath = await model.formatRemoteUri(item.path, globalStore.get);
                    await model.env.rpc.FileDeleteCommand(TabRpcClient, {
                        path: formattedPath,
                        recursive: item.isdir,
                    });
                } catch (e) {
                    setErrorMsg({
                        status: "Delete Failed",
                        text: `Failed to delete "${item.path}": ${e}`,
                        level: "error",
                    });
                }
            }
            model.refresh();
            globalStore.set(model.selectedPaths, new Set());
            globalStore.set(model.selectionAnchor, null);
        });
    };
    confirm({
        status: "Confirm Delete",
        text: formatDeleteConfirmText(items),
        level: "warning",
        buttons: [
            { text: "Delete", onClick: doDelete, destructive: true },
            { text: "Cancel", onClick: () => {} },
        ],
    });
}

export function makeDirectoryDefaultMenuItems(model: PreviewModel): ContextMenuItem[] {
    const defaultSort = globalStore.get(model.env.getSettingsKeyAtom("preview:defaultsort")) ?? "name";
    const showHiddenFiles = globalStore.get(model.showHiddenFiles) ?? true;
    return [
        {
            label: "Directory Sort Order",
            submenu: [
                {
                    label: "Name",
                    type: "checkbox",
                    checked: defaultSort === "name",
                    click: () =>
                        fireAndForget(() =>
                            model.env.rpc.SetConfigCommand(TabRpcClient, { "preview:defaultsort": "name" })
                        ),
                },
                {
                    label: "Last Modified",
                    type: "checkbox",
                    checked: defaultSort === "modtime",
                    click: () =>
                        fireAndForget(() =>
                            model.env.rpc.SetConfigCommand(TabRpcClient, { "preview:defaultsort": "modtime" })
                        ),
                },
            ],
        },
        {
            label: "Show Hidden Files",
            submenu: [
                {
                    label: "On",
                    type: "checkbox",
                    checked: showHiddenFiles,
                    click: () => {
                        globalStore.set(model.showHiddenFiles, true);
                        fireAndForget(() =>
                            model.env.rpc.SetConfigCommand(TabRpcClient, { "preview:showhiddenfiles": true })
                        );
                    },
                },
                {
                    label: "Off",
                    type: "checkbox",
                    checked: !showHiddenFiles,
                    click: () => {
                        globalStore.set(model.showHiddenFiles, false);
                        fireAndForget(() =>
                            model.env.rpc.SetConfigCommand(TabRpcClient, { "preview:showhiddenfiles": false })
                        );
                    },
                },
            ],
        },
    ];
}
