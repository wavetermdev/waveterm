// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { makeMockWaveEnv } from "@/preview/mock/mockwaveenv";
import { ColumnDef, SortingState, Table, createTable, getCoreRowModel, getSortedRowModel } from "@tanstack/react-table";
import { atom } from "jotai";
import { describe, expect, it, vi } from "vitest";
import {
    DirsFirstColumnId,
    getDirsFirstSortValue,
    getNextColumnSorting,
    makeDirectoryDefaultMenuItems,
    makeDirectorySorting,
} from "./preview-directory-utils";
import { type PreviewModel } from "./preview-model";

const Entries: FileInfo[] = [
    { name: "b.txt", path: "/d/b.txt", isdir: false, size: 30 },
    { name: "zdir", path: "/d/zdir", isdir: true, size: 0 },
    { name: "a.txt", path: "/d/a.txt", isdir: false, size: 10 },
    { name: "..", path: "/", isdir: true, size: 0 },
    { name: "adir", path: "/d/adir", isdir: true, size: 0 },
];

const Columns: ColumnDef<FileInfo, any>[] = [
    { accessorKey: "name", sortingFn: "alphanumeric" },
    { accessorKey: "size", sortingFn: "auto" },
    { id: DirsFirstColumnId, accessorFn: getDirsFirstSortValue, sortingFn: "basic" },
];

// mirrors how DirectoryTable wires the controlled sorting state into the table
function makeTable(dirsFirst: boolean, initialSorting: SortingState): Table<FileInfo> {
    let columnSorting = initialSorting;
    const table = createTable<FileInfo>({
        data: Entries,
        columns: Columns,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        enableMultiSort: false,
        enableSortingRemoval: false,
        state: {},
        onStateChange: () => {},
        renderFallbackValue: null,
    });
    const applySorting = () => {
        table.setOptions((prev) => ({
            ...prev,
            state: { ...table.initialState, sorting: makeDirectorySorting(columnSorting, dirsFirst) },
            onSortingChange: (updater) => {
                columnSorting = getNextColumnSorting(updater, table.getState().sorting);
                applySorting();
            },
        }));
    };
    applySorting();
    return table;
}

function getNames(table: Table<FileInfo>): string[] {
    return table.getRowModel().rows.map((row) => row.original.name);
}

describe("directory sorting", () => {
    it("mixes folders and files when dirsfirst is off", () => {
        const table = makeTable(false, [{ id: "name", desc: false }]);
        expect(getNames(table)).toEqual(["..", "a.txt", "adir", "b.txt", "zdir"]);
    });

    it("lists '..' then folders then files when dirsfirst is on", () => {
        const table = makeTable(true, [{ id: "name", desc: false }]);
        expect(getNames(table)).toEqual(["..", "adir", "zdir", "a.txt", "b.txt"]);
    });

    it("keeps folders on top when the column sort is descending", () => {
        const table = makeTable(true, [{ id: "name", desc: true }]);
        expect(getNames(table)).toEqual(["..", "zdir", "adir", "b.txt", "a.txt"]);
    });

    it("keeps folders on top when toggling the sorted column", () => {
        const table = makeTable(true, [{ id: "name", desc: false }]);
        table.getColumn("name").toggleSorting();
        expect(table.getState().sorting).toEqual([
            { id: DirsFirstColumnId, desc: true },
            { id: "name", desc: true },
        ]);
        expect(getNames(table)).toEqual(["..", "zdir", "adir", "b.txt", "a.txt"]);
    });

    it("keeps folders on top when switching to another column", () => {
        const table = makeTable(true, [{ id: "name", desc: false }]);
        table.getColumn("size").toggleSorting(true);
        expect(table.getState().sorting).toEqual([
            { id: DirsFirstColumnId, desc: true },
            { id: "size", desc: true },
        ]);
        expect(getNames(table)).toEqual(["..", "zdir", "adir", "b.txt", "a.txt"]);
    });
});

function makeMenuModel(dirsFirst: boolean) {
    const setConfig = vi.fn(async (_client: any, _data: any) => null);
    const model = {
        env: makeMockWaveEnv({ rpc: { SetConfigCommand: setConfig } }),
        dirsFirst: atom(dirsFirst),
        showHiddenFiles: atom(true),
    };
    return { model, setConfig, menuItems: makeDirectoryDefaultMenuItems(model as unknown as PreviewModel) };
}

function getFolderSubmenu(menuItems: ContextMenuItem[]): ContextMenuItem[] {
    return menuItems.find((item) => item.label == "Show Folders First")?.submenu;
}

describe("directory context menu", () => {
    it("checks On when dirsfirst is enabled", () => {
        const { menuItems } = makeMenuModel(true);
        const submenu = getFolderSubmenu(menuItems);
        expect(submenu.map((item) => [item.label, item.checked])).toEqual([
            ["On", true],
            ["Off", false],
        ]);
    });

    it("checks Off when dirsfirst is disabled", () => {
        const { menuItems } = makeMenuModel(false);
        const submenu = getFolderSubmenu(menuItems);
        expect(submenu.map((item) => [item.label, item.checked])).toEqual([
            ["On", false],
            ["Off", true],
        ]);
    });

    it("persists the choice when clicking Off and On", () => {
        const { model, setConfig, menuItems } = makeMenuModel(true);
        const submenu = getFolderSubmenu(menuItems);
        submenu[1].click();
        expect(globalStore.get(model.dirsFirst)).toBe(false);
        expect(setConfig.mock.lastCall[1]).toEqual({ "preview:dirsfirst": false });
        submenu[0].click();
        expect(globalStore.get(model.dirsFirst)).toBe(true);
        expect(setConfig.mock.lastCall[1]).toEqual({ "preview:dirsfirst": true });
    });
});
