// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { DirectoryDropdown } from "@/app/element/directorydropdown";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { globalStore } from "@/app/store/jotaiStore";
import { getApi } from "@/store/global";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import { checkKeyPressed, isCharacterKeyEvent } from "@/util/keyutil";
import { PLATFORM, PlatformMacOS } from "@/util/platformutil";
import { addOpenMenuItems } from "@/util/previewutil";
import { fireAndForget } from "@/util/util";
import { offset, useDismiss, useFloating, useInteractions } from "@floating-ui/react";
import {
    Header,
    Row,
    RowData,
    Table,
    createColumnHelper,
    flexRender,
    getCoreRowModel,
    getSortedRowModel,
    useReactTable,
} from "@tanstack/react-table";
import clsx from "clsx";
import { PrimitiveAtom, atom, useAtom, useAtomValue, useSetAtom } from "jotai";
import { OverlayScrollbarsComponent, OverlayScrollbarsComponentRef } from "overlayscrollbars-react";
import React, { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { quote as shellQuote } from "shell-quote";
import { debounce } from "throttle-debounce";
import "./directorypreview.scss";
import { EntryManagerOverlay, EntryManagerOverlayProps, EntryManagerType } from "./entry-manager";
import {
    applyClearSelection,
    applySelectAll,
    applySelectionClick,
    buildDropFileCopyOpts,
    buildDragFileItems,
    buildSelectionItems,
    cleanMimetype,
    decideNativeDropRoute,
    getBestUnit,
    getDragChipText,
    getDropBannerText,
    getLastModifiedTime,
    getSortIcon,
    handleFileDeleteBatch,
    handleRename,
    resolveDeleteItems,
    isIconValid,
    joinRemoteDir,
    makeDirectoryDefaultMenuItems,
    mergeError,
    moveFocusIndex,
    osDraggableItems,
    overwriteError,
} from "./preview-directory-utils";
import { ErrorOverlay } from "./preview-error-overlay";
import { type PreviewModel } from "./preview-model";
import { downloadPercent, formatDownloadDoneText, formatSpeed, isDownloadFailure, uploadPercent } from "./preview-model-upload";
import type { PreviewEnv } from "./previewenv";

interface DirectoryTableHeaderCellProps {
    header: Header<FileInfo, unknown>;
}

function DirectoryTableHeaderCell({ header }: DirectoryTableHeaderCellProps) {
    return (
        <div
            className="dir-table-head-cell"
            key={header.id}
            style={{ width: `calc(var(--header-${header.id}-size) * 1px)` }}
        >
            <div className="dir-table-head-cell-content" onClick={() => header.column.toggleSorting()}>
                {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                {getSortIcon(header.column.getIsSorted())}
            </div>
            <div className="dir-table-head-resize-box">
                <div
                    className="dir-table-head-resize"
                    onMouseDown={header.getResizeHandler()}
                    onTouchStart={header.getResizeHandler()}
                />
            </div>
        </div>
    );
}

declare module "@tanstack/react-table" {
    interface TableMeta<TData extends RowData> {
        updateName: (path: string, isDir: boolean) => void;
        newFile: () => void;
        newDirectory: () => void;
    }
}

interface DirectoryTableProps {
    model: PreviewModel;
    data: FileInfo[];
    search: string;
    focusIndex: number;
    setFocusIndex: (_: number) => void;
    setSearch: (_: string) => void;
    setSelectedPath: (_: string) => void;
    setRefreshVersion: React.Dispatch<React.SetStateAction<number>>;
    entryManagerOverlayPropsAtom: PrimitiveAtom<EntryManagerOverlayProps>;
    newFile: () => void;
    newDirectory: () => void;
    onRowDrop: (rowDirPath: string) => void;
    onCleanupDragState: () => void;
    confirmDelete: (msg: ErrorMsg) => void;
}

const columnHelper = createColumnHelper<FileInfo>();

function DirectoryTable({
    model,
    data,
    search,
    focusIndex,
    setFocusIndex,
    setSearch,
    setSelectedPath,
    setRefreshVersion,
    entryManagerOverlayPropsAtom,
    newFile,
    newDirectory,
    onRowDrop,
    onCleanupDragState,
    confirmDelete,
}: DirectoryTableProps) {
    const env = useWaveEnv<PreviewEnv>();
    const fullConfig = useAtomValue(env.atoms.fullConfigAtom);
    const setErrorMsg = useSetAtom(model.errorMsgAtom);
    const getIconFromMimeType = useCallback(
        (mimeType: string): string => {
            while (mimeType.length > 0) {
                const icon = fullConfig.mimetypes?.[mimeType]?.icon ?? null;
                if (isIconValid(icon)) {
                    return `fa fa-solid fa-${icon} fa-fw`;
                }
                mimeType = mimeType.slice(0, -1);
            }
            return "fa fa-solid fa-file fa-fw";
        },
        [fullConfig.mimetypes]
    );
    const getIconColor = useCallback(
        (mimeType: string): string => fullConfig.mimetypes?.[mimeType]?.color ?? "inherit",
        [fullConfig.mimetypes]
    );
    const columns = useMemo(
        () => [
            columnHelper.accessor("mimetype", {
                cell: (info) => (
                    <i
                        className={getIconFromMimeType(info.getValue() ?? "")}
                        style={{ color: getIconColor(info.getValue() ?? "") }}
                    ></i>
                ),
                header: () => <span></span>,
                id: "logo",
                size: 25,
                enableSorting: false,
            }),
            columnHelper.accessor("name", {
                cell: (info) => <span className="dir-table-name ellipsis">{info.getValue()}</span>,
                header: () => <span className="dir-table-head-name">Name</span>,
                sortingFn: "alphanumeric",
                size: 200,
                minSize: 90,
            }),
            columnHelper.accessor("modestr", {
                cell: (info) => <span className="dir-table-modestr">{info.getValue()}</span>,
                header: () => <span>Perm</span>,
                size: 91,
                minSize: 90,
                sortingFn: "alphanumeric",
            }),
            columnHelper.accessor("modtime", {
                cell: (info) => <span className="dir-table-lastmod">{getLastModifiedTime(info.getValue())}</span>,
                header: () => <span>Last Modified</span>,
                size: 91,
                minSize: 65,
                sortingFn: "datetime",
            }),
            columnHelper.accessor("size", {
                cell: (info) => <span className="dir-table-size">{getBestUnit(info.getValue())}</span>,
                header: () => <span className="dir-table-head-size">Size</span>,
                size: 55,
                minSize: 50,
                sortingFn: "auto",
            }),
            columnHelper.accessor("mimetype", {
                cell: (info) => <span className="dir-table-type ellipsis">{cleanMimetype(info.getValue() ?? "")}</span>,
                header: () => <span className="dir-table-head-type">Type</span>,
                size: 97,
                minSize: 97,
                sortingFn: "alphanumeric",
            }),
            columnHelper.accessor("path", {}),
        ],
        [fullConfig]
    );

    const setEntryManagerProps = useSetAtom(entryManagerOverlayPropsAtom);

    const updateName = useCallback(
        (path: string, isDir: boolean) => {
            const fileName = path.split("/").at(-1);
            setEntryManagerProps({
                entryManagerType: EntryManagerType.EditName,
                startingValue: fileName,
                onSave: (newName: string) => {
                    let newPath: string;
                    if (newName !== fileName) {
                        const lastInstance = path.lastIndexOf(fileName);
                        newPath = path.substring(0, lastInstance) + newName;
                        console.log(`replacing ${fileName} with ${newName}: ${path}`);
                        handleRename(model, path, newPath, isDir, setErrorMsg);
                    }
                    setEntryManagerProps(undefined);
                },
            });
        },
        [model, setErrorMsg]
    );

    const sorting = useAtomValue(model.directorySorting);
    const setSorting = useSetAtom(model.directorySorting);
    const columnSizing = useAtomValue(model.directoryColumnSizing);
    const setColumnSizing = useSetAtom(model.directoryColumnSizing);
    const columnVisibility = useAtomValue(model.directoryColumnVisibility);
    const setColumnVisibility = useSetAtom(model.directoryColumnVisibility);

    const table = useReactTable({
        data,
        columns,
        columnResizeMode: "onChange",
        getSortedRowModel: getSortedRowModel(),
        getCoreRowModel: getCoreRowModel(),

        state: {
            sorting,
            columnSizing,
            columnVisibility,
        },
        onSortingChange: setSorting,
        onColumnSizingChange: setColumnSizing,
        onColumnVisibilityChange: setColumnVisibility,
        enableMultiSort: false,
        enableSortingRemoval: false,
        meta: {
            updateName,
            newFile,
            newDirectory,
        },
    });
    const sortingState = table.getState().sorting;
    useEffect(() => {
        const allRows = table.getRowModel()?.flatRows || [];
        setSelectedPath((allRows[focusIndex]?.getValue("path") as string) ?? null);
        const selectablePaths = allRows
            .filter((row) => row.getValue("name") !== "..")
            .map((row) => row.getValue("path") as string);
        globalStore.set(model.directorySelectablePaths, selectablePaths);
    }, [focusIndex, data, setSelectedPath, sortingState, model]);

    const columnSizeVars = useMemo(() => {
        const headers = table.getFlatHeaders();
        const colSizes: { [key: string]: number } = {};
        for (let i = 0; i < headers.length; i++) {
            const header = headers[i]!;
            colSizes[`--header-${header.id}-size`] = header.getSize();
            colSizes[`--col-${header.column.id}-size`] = header.column.getSize();
        }
        return colSizes;
    }, [table.getState().columnSizingInfo]);

    const osRef = useRef<OverlayScrollbarsComponentRef>(null);
    const bodyRef = useRef<HTMLDivElement>(null);
    const [scrollHeight, setScrollHeight] = useState(0);

    const onScroll = useCallback(
        debounce(2, () => {
            setScrollHeight(osRef.current.osInstance().elements().viewport.scrollTop);
        }),
        []
    );

    const TableComponent = table.getState().columnSizingInfo.isResizingColumn ? MemoizedTableBody : TableBody;

    return (
        <OverlayScrollbarsComponent
            options={{ scrollbars: { autoHide: "leave" } }}
            events={{ scroll: onScroll }}
            className="dir-table"
            style={{ ...columnSizeVars }}
            ref={osRef}
            data-scroll-height={scrollHeight}
        >
            <div className="dir-table-head">
                {table.getHeaderGroups().map((headerGroup) => (
                    <div className="dir-table-head-row" key={headerGroup.id}>
                        {headerGroup.headers.map((header) => (
                            <DirectoryTableHeaderCell key={header.id} header={header} />
                        ))}
                    </div>
                ))}
            </div>
            <TableComponent
                bodyRef={bodyRef}
                model={model}
                data={data}
                table={table}
                search={search}
                focusIndex={focusIndex}
                setFocusIndex={setFocusIndex}
                setSearch={setSearch}
                setSelectedPath={setSelectedPath}
                setRefreshVersion={setRefreshVersion}
                osRef={osRef.current}
                onRowDrop={onRowDrop}
                onCleanupDragState={onCleanupDragState}
                confirmDelete={confirmDelete}
            />
        </OverlayScrollbarsComponent>
    );
}

interface TableBodyProps {
    bodyRef: React.RefObject<HTMLDivElement>;
    model: PreviewModel;
    data: Array<FileInfo>;
    table: Table<FileInfo>;
    search: string;
    focusIndex: number;
    setFocusIndex: (_: number) => void;
    setSearch: (_: string) => void;
    setSelectedPath: (_: string) => void;
    setRefreshVersion: React.Dispatch<React.SetStateAction<number>>;
    osRef: OverlayScrollbarsComponentRef;
    onRowDrop: (rowDirPath: string) => void;
    onCleanupDragState: () => void;
    confirmDelete: (msg: ErrorMsg) => void;
}

function TableBody({
    bodyRef,
    model,
    table,
    search,
    focusIndex,
    setFocusIndex,
    setSearch,
    setRefreshVersion,
    osRef,
    onRowDrop,
    onCleanupDragState,
    confirmDelete,
}: TableBodyProps) {
    const searchActive = useAtomValue(model.directorySearchActive);
    const dummyLineRef = useRef<HTMLDivElement>(null);
    const warningBoxRef = useRef<HTMLDivElement>(null);
    const conn = useAtomValue(model.connection);
    const dirPath = useAtomValue(model.statFilePath);
    const connName = useAtomValue(model.connectionImmediate);
    const setErrorMsg = useSetAtom(model.errorMsgAtom);

    useEffect(() => {
        if (focusIndex === null || !bodyRef.current || !osRef) {
            return;
        }

        const rowElement = bodyRef.current.querySelector(`[data-rowindex="${focusIndex}"]`) as HTMLDivElement;
        if (!rowElement) {
            return;
        }

        const viewport = osRef.osInstance().elements().viewport;
        const viewportHeight = viewport.offsetHeight;
        const rowRect = rowElement.getBoundingClientRect();
        const parentRect = viewport.getBoundingClientRect();
        const viewportScrollTop = viewport.scrollTop;
        const rowTopRelativeToViewport = rowRect.top - parentRect.top + viewport.scrollTop;
        const rowBottomRelativeToViewport = rowRect.bottom - parentRect.top + viewport.scrollTop;

        if (rowTopRelativeToViewport - 30 < viewportScrollTop) {
            // Row is above the visible area
            let topVal = rowTopRelativeToViewport - 30;
            if (topVal < 0) {
                topVal = 0;
            }
            viewport.scrollTo({ top: topVal });
        } else if (rowBottomRelativeToViewport + 5 > viewportScrollTop + viewportHeight) {
            // Row is below the visible area
            const topVal = rowBottomRelativeToViewport - viewportHeight + 5;
            viewport.scrollTo({ top: topVal });
        }
    }, [focusIndex]);

    const allRows = table.getRowModel().flatRows;

    const handleFileContextMenu = useCallback(
        async (e: any, finfo: FileInfo) => {
            e.preventDefault();
            e.stopPropagation();
            if (finfo == null) {
                return;
            }
            const selectedPaths = globalStore.get(model.selectedPaths);
            const selectedCount = selectedPaths.size;
            const fileName = finfo.path.split("/").pop();
            const menu: ContextMenuItem[] = [
                {
                    label: "New File",
                    click: () => {
                        table.options.meta.newFile();
                    },
                },
                {
                    label: "New Folder",
                    click: () => {
                        table.options.meta.newDirectory();
                    },
                },
                {
                    label: "Rename",
                    click: () => {
                        table.options.meta.updateName(finfo.path, finfo.isdir);
                    },
                },
                {
                    label: "Copy",
                    click: () => {
                        const selected = globalStore.get(model.selectedPaths);
                        if (!selected.has(finfo.path)) {
                            globalStore.set(model.selectedPaths, new Set([finfo.path]));
                            globalStore.set(model.selectionAnchor, finfo.path);
                        }
                        const entries = allRows.map((r) => ({
                            path: r.getValue("path") as string,
                            name: r.getValue("name") as string,
                            isdir: Boolean(r.original.isdir),
                        }));
                        globalStore.set(model.fileClipboard, {
                            sources: buildSelectionItems(globalStore.get(model.selectedPaths), entries, dirPath, connName),
                            cut: false,
                        });
                    },
                },
                {
                    label: "Cut",
                    click: () => {
                        const selected = globalStore.get(model.selectedPaths);
                        if (!selected.has(finfo.path)) {
                            globalStore.set(model.selectedPaths, new Set([finfo.path]));
                            globalStore.set(model.selectionAnchor, finfo.path);
                        }
                        const entries = allRows.map((r) => ({
                            path: r.getValue("path") as string,
                            name: r.getValue("name") as string,
                            isdir: Boolean(r.original.isdir),
                        }));
                        globalStore.set(model.fileClipboard, {
                            sources: buildSelectionItems(globalStore.get(model.selectedPaths), entries, dirPath, connName),
                            cut: true,
                        });
                    },
                },
                {
                    type: "separator",
                },
                {
                    label: "Copy File Name",
                    click: () => fireAndForget(() => navigator.clipboard.writeText(fileName)),
                },
                {
                    label: "Copy Full File Name",
                    click: () => fireAndForget(() => navigator.clipboard.writeText(finfo.path)),
                },
                {
                    label: "Copy File Name (Shell Quoted)",
                    click: () => fireAndForget(() => navigator.clipboard.writeText(shellQuote([fileName]))),
                },
                {
                    label: "Copy Full File Name (Shell Quoted)",
                    click: () => fireAndForget(() => navigator.clipboard.writeText(shellQuote([finfo.path]))),
                },
            ];
            addOpenMenuItems(menu, conn, finfo, (remoteUri) => model.downloadFile(remoteUri));
            menu.push(
                {
                    type: "separator",
                },
                {
                    label: "Default Settings",
                    submenu: makeDirectoryDefaultMenuItems(model),
                },
                {
                    type: "separator",
                },
                {
                    label:
                        finfo != null && selectedPaths.has(finfo.path) && selectedCount > 1
                            ? `Delete ${selectedCount} Items`
                            : "Delete",
                    click: () => {
                        const selected = globalStore.get(model.selectedPaths);
                        const entries = allRows.map((r) => ({
                            path: r.getValue("path") as string,
                            name: r.getValue("name") as string,
                            isdir: Boolean(r.original.isdir),
                        }));
                        const items = resolveDeleteItems(selected, finfo.path, entries);
                        handleFileDeleteBatch(model, items, confirmDelete, setErrorMsg);
                    },
                }
            );
            ContextMenuModel.getInstance().showContextMenu(menu, e);
        },
        [setRefreshVersion, conn, allRows, dirPath, connName, model, table, setErrorMsg, confirmDelete]
    );

    const dotdotRow = allRows.find((row) => row.getValue("name") === "..");
    const otherRows = allRows.filter((row) => row.getValue("name") !== "..");

    const handleRowClick = useCallback(
        (path: string, idx: number, opts: { cmd: boolean; shift: boolean }) => {
            setFocusIndex(idx);
            const selectablePaths = globalStore.get(model.directorySelectablePaths);
            if (!selectablePaths.includes(path)) {
                // The ".." row is never selectable.
                return;
            }
            const prev = {
                selectedPaths: globalStore.get(model.selectedPaths),
                anchor: globalStore.get(model.selectionAnchor),
            };
            const next = applySelectionClick(prev, path, opts, selectablePaths);
            globalStore.set(model.selectedPaths, next.selectedPaths);
            globalStore.set(model.selectionAnchor, next.anchor);
        },
        [model, setFocusIndex]
    );

    const handleDragStart = useCallback(
        (draggedPath: string, move: boolean) => {
            // Dragging an unselected row selects it (standard file-manager behavior).
            if (!globalStore.get(model.selectedPaths).has(draggedPath)) {
                globalStore.set(model.selectedPaths, new Set([draggedPath]));
                globalStore.set(model.selectionAnchor, draggedPath);
            }
            const entries = allRows.map((r) => ({
                path: r.getValue("path") as string,
                name: r.getValue("name") as string,
                isdir: Boolean(r.original.isdir),
            }));
            const files = buildDragFileItems(globalStore.get(model.selectedPaths), draggedPath, entries, dirPath, connName);
            if (files.length === 0) {
                return;
            }
            const osFiles = osDraggableItems(files);
            if (osFiles.length === 0) {
                // Directory-only selection: the Electron native drag requires at
                // least one file (OS folder drag-out is files-only by product
                // decision), so no drag can start. Directories still participate
                // in in-app drops when dragged alongside at least one file.
                return;
            }
            globalStore.set(model.dragSource, { files, move });
            getApi().startFileDrag(osFiles.map((f) => ({ remoteUri: f.uri, fileName: f.relName })));
        },
        [allRows, dirPath, connName, model]
    );

    return (
        <div className="dir-table-body" ref={bodyRef}>
            {(searchActive || search !== "") && (
                <div className="dir-search-banner flex rounded-[3px] py-1 px-2 bg-warning text-black" ref={warningBoxRef}>
                    <span>{search === "" ? "Type to search (Esc to cancel)" : `Searching for "${search}"`}</span>
                    <div
                        className="ml-auto bg-transparent flex justify-center items-center flex-col p-0.5 rounded-md hover:bg-hoverbg focus:bg-hoverbg focus-within:bg-hoverbg cursor-pointer"
                        onClick={() => {
                            setSearch("");
                            globalStore.set(model.directorySearchActive, false);
                        }}
                    >
                        <i className="fa-solid fa-xmark" />
                        <input
                            type="text"
                            value={search}
                            onChange={() => {}}
                            className="w-0 h-0 opacity-0 p-0 border-none pointer-events-none"
                        />
                    </div>
                </div>
            )}
            <div className="dir-table-body-scroll-box">
                <div className="dummy dir-table-body-row" ref={dummyLineRef}>
                    <div className="dir-table-body-cell">dummy-data</div>
                </div>
                {dotdotRow && (
                    <TableRow
                        model={model}
                        row={dotdotRow}
                        focusIndex={focusIndex}
                        handleRowClick={handleRowClick}
                        onDragStartSelection={handleDragStart}
                        onRowDrop={onRowDrop}
                        onCleanupDragState={onCleanupDragState}
                        setSearch={setSearch}
                        idx={0}
                        handleFileContextMenu={handleFileContextMenu}
                        key="dotdot"
                    />
                )}
                {otherRows.map((row, idx) => (
                    <TableRow
                        model={model}
                        row={row}
                        focusIndex={focusIndex}
                        handleRowClick={handleRowClick}
                        onDragStartSelection={handleDragStart}
                        onRowDrop={onRowDrop}
                        onCleanupDragState={onCleanupDragState}
                        setSearch={setSearch}
                        idx={dotdotRow ? idx + 1 : idx}
                        handleFileContextMenu={handleFileContextMenu}
                        key={idx}
                    />
                ))}
            </div>
        </div>
    );
}

type TableRowProps = {
    model: PreviewModel;
    row: Row<FileInfo>;
    focusIndex: number;
    handleRowClick: (path: string, idx: number, opts: { cmd: boolean; shift: boolean }) => void;
    onDragStartSelection: (path: string, move: boolean) => void;
    onRowDrop: (rowDirPath: string) => void;
    onCleanupDragState: () => void;
    setSearch: (_: string) => void;
    idx: number;
    handleFileContextMenu: (e: any, finfo: FileInfo) => Promise<void>;
};

function TableRow({ model, row, focusIndex, handleRowClick, onDragStartSelection, onRowDrop, onCleanupDragState, setSearch, idx, handleFileContextMenu }: TableRowProps) {
    const selectedPaths = useAtomValue(model.selectedPaths);
    const isSelected = selectedPaths.has(row.getValue("path") as string);

    const handleDragStart = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault();
            onDragStartSelection(row.getValue("path") as string, e.metaKey || e.ctrlKey);
        },
        [onDragStartSelection, row]
    );
    const handleDragEnd = useCallback(() => {
        // A drag that ends without a drop (cancelled/aborted) must clear the
        // same state a real drop clears, so no residue survives.
        onCleanupDragState();
    }, [onCleanupDragState]);

    // Only directory rows (excluding the ".." row) are drop targets for our own
    // in-app drags. File rows and ".." have no row-level drop handlers, so their
    // drag events fall through to the container's upload/same-dir logic.
    const isDirRow = row.getValue("name") !== ".." && Boolean(row.original.isdir);

    // Drop-target highlight, driven by a local enter/leave counter so moving
    // across a row's child cells doesn't flicker it off. dragenter fires on each
    // child boundary (balanced by a matching dragleave); dragover fires
    // continuously with no matching leave, so it only re-affirms the highlight.
    const dropEnterCountRef = useRef(0);
    const [isDropTarget, setIsDropTarget] = useState(false);

    const handleRowDragEnterOrOver = useCallback(
        (e: React.DragEvent) => {
            // External OS drag (no internal dragSource): defer to the container.
            if (globalStore.get(model.dragSource) == null) {
                return;
            }
            e.preventDefault();
            if (e.type === "dragenter") {
                dropEnterCountRef.current++;
            }
            setIsDropTarget(true);
        },
        [model]
    );

    const handleRowDragLeave = useCallback(
        (e: React.DragEvent) => {
            if (globalStore.get(model.dragSource) == null) {
                return;
            }
            dropEnterCountRef.current--;
            if (dropEnterCountRef.current <= 0) {
                dropEnterCountRef.current = 0;
                setIsDropTarget(false);
            }
        },
        [model]
    );

    const handleRowDrop = useCallback(
        (e: React.DragEvent) => {
            if (globalStore.get(model.dragSource) == null) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            dropEnterCountRef.current = 0;
            setIsDropTarget(false);
            onRowDrop(row.getValue("path") as string);
        },
        [model, onRowDrop, row]
    );

    return (
        <div
            className={clsx("dir-table-body-row", {
                focused: focusIndex === idx,
                selected: isSelected,
                "dir-drop-target": isDropTarget,
            })}
            data-rowindex={idx}
            draggable
            onDoubleClick={() => {
                const newFileName = row.getValue("path") as string;
                model.goHistory(newFileName);
                setSearch("");
                globalStore.set(model.directorySearchActive, false);
            }}
            onClick={(e) =>
                handleRowClick(row.getValue("path") as string, idx, { cmd: e.metaKey || e.ctrlKey, shift: e.shiftKey })
            }
            onContextMenu={(e) => handleFileContextMenu(e, row.original)}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragEnter={isDirRow ? handleRowDragEnterOrOver : undefined}
            onDragOver={isDirRow ? handleRowDragEnterOrOver : undefined}
            onDragLeave={isDirRow ? handleRowDragLeave : undefined}
            onDrop={isDirRow ? handleRowDrop : undefined}
        >
            {row.getVisibleCells().map((cell) => (
                <div
                    className={clsx("dir-table-body-cell", "col-" + cell.column.id)}
                    key={cell.id}
                    style={{ width: `calc(var(--col-${cell.column.id}-size) * 1px)` }}
                >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </div>
            ))}
        </div>
    );
}

const MemoizedTableBody = React.memo(
    TableBody,
    (prev, next) => prev.table.options.data == next.table.options.data
) as typeof TableBody;

interface DirectoryPreviewProps {
    model: PreviewModel;
}

function DirectoryPreview({ model }: DirectoryPreviewProps) {
    const env = useWaveEnv<PreviewEnv>();
    const [searchText, setSearchText] = useState("");
    const [focusIndex, setFocusIndex] = useState(-1);
    const [unfilteredData, setUnfilteredData] = useState<FileInfo[]>([]);
    const showHiddenFiles = useAtomValue(model.showHiddenFiles);
    const [selectedPath, setSelectedPath] = useState("");
    const [refreshVersion, setRefreshVersion] = useAtom(model.refreshVersion);
    const conn = useAtomValue(model.connectionImmediate);
    const blockData = useAtomValue(model.blockAtom);
    const finfo = useAtomValue(model.statFile);
    const dirPath = finfo?.path;
    const activeDragSource = useAtomValue(model.dragSource);
    const setErrorMsg = useSetAtom(model.errorMsgAtom);
    const activeErrorMsg = useAtomValue(model.errorMsgAtom);
    const [confirmDeleteMsg, setConfirmDeleteMsg] = useState<ErrorMsg | null>(null);
    const confirmDelete = useCallback((msg: ErrorMsg) => setConfirmDeleteMsg(msg), []);
    const uploadCancel = useAtomValue(model.uploadCancel);
    const uploadStatus = useAtomValue(model.uploadStatus);
    const handleCancelUpload = useCallback(
        (e: React.MouseEvent<HTMLButtonElement>) => {
            // Keep the click inside the banner from reaching the container's
            // background-click handler (which would clear the selection).
            e.stopPropagation();
            uploadCancel?.cancel();
        },
        [uploadCancel]
    );
    const setUploadStatus = useSetAtom(model.uploadStatus);
    const setDownloadProgress = useSetAtom(model.downloadProgress);
    const dismissUploadStatus = useCallback(
        (e: React.MouseEvent<HTMLButtonElement>) => {
            // Dismiss (X) for persistent upload failures. stopPropagation keeps
            // the click from reaching the container's background-click handler.
            e.stopPropagation();
            setUploadStatus(null);
        },
        [setUploadStatus]
    );
    const dismissDownloadStatus = useCallback(
        (e: React.MouseEvent<HTMLButtonElement>) => {
            // Dismiss (X) for persistent download failures.
            e.stopPropagation();
            setDownloadProgress(null);
        },
        [setDownloadProgress]
    );
    const [isDragOver, setIsDragOver] = useState(false);
    const dragCounterRef = useRef(0);
    const directoryDropdownOpen = useAtomValue(model.directoryDropdownOpen);
    const uploadProgress = useAtomValue(model.uploadProgress);
    const downloadProgress = useAtomValue(model.downloadProgress);

    // Single shared drag cleanup, invoked by every path that can end a drag:
    // container drops (in-app + reject) AND row drops. It resets the
    // container's drag-enter counter and overlay state, clears the internal
    // drag source, and releases any native temp files staged for OS drag-out.
    // Without this, a row drop (which stops propagation before the container's
    // onDrop fires) would leave the container overlay showing stale text.
    const cleanupDragState = useCallback(() => {
        dragCounterRef.current = 0;
        setIsDragOver(false);
        globalStore.set(model.dragSource, null);
        getApi().cleanupDragTemp();
    }, [model]);

    const handleDropCopyOrMove = useCallback(
        async (data: CommandFileCopyData, isDir: boolean, move: boolean) => {
            if (isDir && !move) {
                // Directory copy is unsupported backend-side (no recursive copy
                // RPC exists). Surface a clean message instead of a raw RPC error.
                setErrorMsg({
                    status: "Copy Failed",
                    text: "Copying directories is not supported.",
                    level: "error",
                });
                return;
            }
            try {
                if (move) {
                    await env.rpc.FileMoveCommand(TabRpcClient, data, { timeout: data.opts.timeout });
                } else {
                    await env.rpc.FileCopyCommand(TabRpcClient, data, { timeout: data.opts.timeout });
                }
            } catch (e) {
                console.warn(`${move ? "Move" : "Copy"} failed:`, e);
                const copyError = `${e}`;
                const allowRetry = copyError.includes(overwriteError) || copyError.includes(mergeError);
                let errorMsg: ErrorMsg;
                if (allowRetry) {
                    // Directory conflicts offer both merge and replace; file
                    // conflicts only offer overwrite. `merge=true` preserves and
                    // merges contents; `overwrite=true` (replace) deletes the
                    // existing content first. The destructive affirmative is
                    // flagged so the confirm overlay focuses it by default.
                    const retry = (opts: { overwrite?: boolean; merge?: boolean }) => async () => {
                        if (opts.overwrite) {
                            data.opts.overwrite = true;
                        }
                        if (opts.merge) {
                            data.opts.merge = true;
                        }
                        await handleDropCopyOrMove(data, isDir, move);
                    };
                    errorMsg = {
                        status: "Confirm Overwrite",
                        text: isDir
                            ? `This ${move ? "move" : "copy"} operation conflicts with an existing directory. Would you like to merge or replace it?`
                            : `This ${move ? "move" : "copy"} operation will overwrite an existing file. Would you like to continue?`,
                        level: "warning",
                        buttons: isDir
                            ? [
                                  { text: "Merge", onClick: retry({ merge: true }) },
                                  { text: "Replace", onClick: retry({ overwrite: true }), destructive: true },
                                  { text: "Cancel", onClick: () => {} },
                              ]
                            : [
                                  { text: "Overwrite", onClick: retry({ overwrite: true }), destructive: true },
                                  { text: "Cancel", onClick: () => {} },
                              ],
                    };
                } else {
                    errorMsg = {
                        status: `${move ? "Move" : "Copy"} Failed`,
                        text: copyError,
                        level: "error",
                    };
                }
                setErrorMsg(errorMsg);
            }
            model.refresh();
        },
        [model.refresh, setErrorMsg]
    );

    const handleRowDrop = useCallback(
        async (rowDirPath: string) => {
            const dragSource = globalStore.get(model.dragSource);
            if (dragSource == null) {
                return; // external drop: let the container's upload logic handle it
            }
            try {
                const rowDirUri = await model.formatRemoteUri(rowDirPath, globalStore.get);
                for (const f of dragSource.files) {
                    await handleDropCopyOrMove(
                        {
                            srcuri: f.uri,
                            desturi: joinRemoteDir(rowDirUri, f.relName),
                            opts: buildDropFileCopyOpts(f.isDir, dragSource.move),
                        },
                        f.isDir,
                        dragSource.move
                    );
                }
            } finally {
                cleanupDragState();
            }
        },
        [model, handleDropCopyOrMove, cleanupDragState]
    );

    const pasteClipboard = useCallback(
        (targetDir: string) => {
            const clipboard = globalStore.get(model.fileClipboard);
            if (clipboard == null || clipboard.sources.length === 0) {
                return;
            }
            if (clipboard.sources[0].absParent === targetDir) {
                return; // pasting into the source directory is a no-op
            }
            fireAndForget(async () => {
                const destDirUri = await model.formatRemoteUri(targetDir, globalStore.get);
                for (const s of clipboard.sources) {
                    await handleDropCopyOrMove(
                        { srcuri: s.uri, desturi: joinRemoteDir(destDirUri, s.relName), opts: buildDropFileCopyOpts(s.isDir, clipboard.cut) },
                        s.isDir,
                        clipboard.cut
                    );
                }
                if (clipboard.cut) {
                    globalStore.set(model.fileClipboard, null); // move consumes the source
                }
            });
        },
        [model, handleDropCopyOrMove]
    );

    useEffect(
        () =>
            fireAndForget(async () => {
                const entries: FileInfo[] = [];
                try {
                    const remotePath = await model.formatRemoteUri(dirPath, globalStore.get);
                    const stream = env.rpc.FileListStreamCommand(TabRpcClient, { path: remotePath }, null);
                    for await (const chunk of stream) {
                        if (chunk?.fileinfo) {
                            entries.push(...chunk.fileinfo);
                        }
                    }
                    if (finfo?.dir && finfo?.path !== finfo?.dir) {
                        entries.unshift({
                            name: "..",
                            path: finfo.dir,
                            isdir: true,
                            modtime: new Date().getTime(),
                            mimetype: "directory",
                        });
                    }
                } catch (e) {
                    console.error("Directory Read Error", e);
                    setErrorMsg({
                        status: "Cannot Read Directory",
                        text: `${e}`,
                    });
                }
                setUnfilteredData(entries);
                globalStore.set(model.selectedPaths, new Set());
                globalStore.set(model.selectionAnchor, null);
            }),
        [conn, dirPath, refreshVersion]
    );

    const filteredData = useMemo(
        () =>
            unfilteredData?.filter((fileInfo) => {
                if (fileInfo.name == null) {
                    console.log("fileInfo.name is null", fileInfo);
                    return false;
                }
                if (!showHiddenFiles && fileInfo.name.startsWith(".") && fileInfo.name != "..") {
                    return false;
                }
                return fileInfo.name.toLowerCase().includes(searchText);
            }) ?? [],
        [unfilteredData, showHiddenFiles, searchText]
    );

    useEffect(() => {
        model.directoryKeyDownHandler = (waveEvent: WaveKeyboardEvent): boolean => {
            // While a confirm dialog (delete confirm or copy-overwrite prompt) is
            // open, swallow every widget key so nothing leaks through to the
            // directory handlers below (Enter opening a file, Cmd+F/A, arrows,
            // search, delete, etc.). The dialog itself handles Tab/Enter/Space/Esc.
            if (confirmDeleteMsg != null || (activeErrorMsg?.buttons?.length ?? 0) > 0) {
                return true;
            }
            if (checkKeyPressed(waveEvent, "Cmd:r")) {
                model.refresh();
                return true;
            }
            if (checkKeyPressed(waveEvent, "Cmd:f")) {
                globalStore.set(model.directorySearchActive, true);
                return true;
            }
            if (checkKeyPressed(waveEvent, "Cmd:a")) {
                const selectablePaths = globalStore.get(model.directorySelectablePaths);
                const next = applySelectAll(selectablePaths);
                globalStore.set(model.selectedPaths, next.selectedPaths);
                globalStore.set(model.selectionAnchor, next.anchor);
                return true;
            }
            if (checkKeyPressed(waveEvent, "Escape")) {
                setSearchText("");
                globalStore.set(model.directorySearchActive, false);
                const cleared = applyClearSelection();
                globalStore.set(model.selectedPaths, cleared.selectedPaths);
                globalStore.set(model.selectionAnchor, cleared.anchor);
                setFocusIndex(-1);
                return;
            }
            if (checkKeyPressed(waveEvent, "Shift:ArrowUp")) {
                const dotdotPresent = filteredData.some((f) => f.name === "..");
                const newFocusIndex = moveFocusIndex(focusIndex, filteredData.length, dotdotPresent, "up");
                setFocusIndex(newFocusIndex);
                const selectablePaths = globalStore.get(model.directorySelectablePaths);
                const selectableIdx = dotdotPresent ? newFocusIndex - 1 : newFocusIndex;
                const focusedPath = selectablePaths[selectableIdx];
                if (focusedPath != null) {
                    const prev = {
                        selectedPaths: globalStore.get(model.selectedPaths),
                        anchor: globalStore.get(model.selectionAnchor),
                    };
                    const next = applySelectionClick(prev, focusedPath, { cmd: false, shift: true }, selectablePaths);
                    globalStore.set(model.selectedPaths, next.selectedPaths);
                    globalStore.set(model.selectionAnchor, next.anchor);
                }
                return true;
            }
            if (checkKeyPressed(waveEvent, "Shift:ArrowDown")) {
                const dotdotPresent = filteredData.some((f) => f.name === "..");
                const newFocusIndex = moveFocusIndex(focusIndex, filteredData.length, dotdotPresent, "down");
                setFocusIndex(newFocusIndex);
                const selectablePaths = globalStore.get(model.directorySelectablePaths);
                const selectableIdx = dotdotPresent ? newFocusIndex - 1 : newFocusIndex;
                const focusedPath = selectablePaths[selectableIdx];
                if (focusedPath != null) {
                    const prev = {
                        selectedPaths: globalStore.get(model.selectedPaths),
                        anchor: globalStore.get(model.selectionAnchor),
                    };
                    const next = applySelectionClick(prev, focusedPath, { cmd: false, shift: true }, selectablePaths);
                    globalStore.set(model.selectedPaths, next.selectedPaths);
                    globalStore.set(model.selectionAnchor, next.anchor);
                }
                return true;
            }
            if (checkKeyPressed(waveEvent, "ArrowUp")) {
                const dotdotPresent = filteredData.some((f) => f.name === "..");
                setFocusIndex(moveFocusIndex(focusIndex, filteredData.length, dotdotPresent, "up"));
                return true;
            }
            if (checkKeyPressed(waveEvent, "ArrowDown")) {
                const dotdotPresent = filteredData.some((f) => f.name === "..");
                setFocusIndex(moveFocusIndex(focusIndex, filteredData.length, dotdotPresent, "down"));
                return true;
            }
            if (checkKeyPressed(waveEvent, "PageUp")) {
                const dotdotPresent = filteredData.some((f) => f.name === "..");
                setFocusIndex(moveFocusIndex(focusIndex, filteredData.length, dotdotPresent, "pageup"));
                return true;
            }
            if (checkKeyPressed(waveEvent, "PageDown")) {
                const dotdotPresent = filteredData.some((f) => f.name === "..");
                setFocusIndex(moveFocusIndex(focusIndex, filteredData.length, dotdotPresent, "pagedown"));
                return true;
            }
            if (checkKeyPressed(waveEvent, "Enter")) {
                if (filteredData.length == 0) {
                    return;
                }
                if (selectedPath == null || selectedPath == "") {
                    // No focused row (e.g. after an off-grid click or Escape).
                    return true;
                }
                model.goHistory(selectedPath);
                setSearchText("");
                globalStore.set(model.directorySearchActive, false);
                return true;
            }
            if (checkKeyPressed(waveEvent, "Delete") || checkKeyPressed(waveEvent, "Cmd:Backspace")) {
                const selected = globalStore.get(model.selectedPaths);
                if (selected.size === 0) {
                    return true;
                }
                const entries = filteredData.map((f) => ({ path: f.path, name: f.name, isdir: Boolean(f.isdir) }));
                const items = resolveDeleteItems(selected, null, entries);
                handleFileDeleteBatch(model, items, confirmDelete, setErrorMsg);
                return true;
            }
            if (checkKeyPressed(waveEvent, "Cmd:c")) {
                const selected = globalStore.get(model.selectedPaths);
                if (selected.size > 0) {
                    const entries = filteredData.map((f) => ({ path: f.path, name: f.name, isdir: Boolean(f.isdir) }));
                    globalStore.set(model.fileClipboard, {
                        sources: buildSelectionItems(selected, entries, dirPath, conn),
                        cut: false,
                    });
                }
                return true;
            }
            if (checkKeyPressed(waveEvent, "Cmd:x")) {
                const selected = globalStore.get(model.selectedPaths);
                if (selected.size > 0) {
                    const entries = filteredData.map((f) => ({ path: f.path, name: f.name, isdir: Boolean(f.isdir) }));
                    globalStore.set(model.fileClipboard, {
                        sources: buildSelectionItems(selected, entries, dirPath, conn),
                        cut: true,
                    });
                }
                return true;
            }
            if (checkKeyPressed(waveEvent, "Cmd:v")) {
                pasteClipboard(dirPath);
                return true;
            }
            if (checkKeyPressed(waveEvent, "Backspace")) {
                if (searchText.length == 0) {
                    return true;
                }
                setSearchText((current) => current.slice(0, -1));
                return true;
            }
            if (
                checkKeyPressed(waveEvent, "Space") &&
                searchText == "" &&
                PLATFORM == PlatformMacOS &&
                !blockData?.meta?.connection
            ) {
                env.electron.onQuicklook(selectedPath);
                return true;
            }
            if (isCharacterKeyEvent(waveEvent)) {
                setSearchText((current) => current + waveEvent.key);
                return true;
            }
            return false;
        };
        return () => {
            model.directoryKeyDownHandler = null;
        };
    }, [filteredData, selectedPath, searchText, focusIndex, pasteClipboard, conn, dirPath, model, setErrorMsg, blockData, env, confirmDelete, activeErrorMsg]);

    useEffect(() => {
        if (filteredData.length != 0 && focusIndex > filteredData.length - 1) {
            setFocusIndex(filteredData.length - 1);
        }
    }, [filteredData]);

    const entryManagerPropsAtom = useState(
        atom<EntryManagerOverlayProps>(null) as PrimitiveAtom<EntryManagerOverlayProps>
    )[0];
    const [entryManagerProps, setEntryManagerProps] = useAtom(entryManagerPropsAtom);

    const { refs, floatingStyles, context } = useFloating({
        open: !!entryManagerProps,
        onOpenChange: () => setEntryManagerProps(undefined),
        middleware: [offset(({ rects }) => -rects.reference.height / 2 - rects.floating.height / 2)],
    });

    const dismiss = useDismiss(context);
    const { getReferenceProps, getFloatingProps } = useInteractions([dismiss]);

    const newFile = useCallback(() => {
        setEntryManagerProps({
            entryManagerType: EntryManagerType.NewFile,
            onSave: (newName: string) => {
                console.log(`newFile: ${newName}`);
                fireAndForget(async () => {
                    await env.rpc.FileCreateCommand(
                        TabRpcClient,
                        {
                            info: {
                                path: await model.formatRemoteUri(`${dirPath}/${newName}`, globalStore.get),
                            },
                        },
                        null
                    );
                    model.refresh();
                });
                setEntryManagerProps(undefined);
            },
        });
    }, [dirPath]);
    const newDirectory = useCallback(() => {
        setEntryManagerProps({
            entryManagerType: EntryManagerType.NewDirectory,
            onSave: (newName: string) => {
                console.log(`newDirectory: ${newName}`);
                fireAndForget(async () => {
                    await env.rpc.FileMkdirCommand(TabRpcClient, {
                        info: {
                            path: await model.formatRemoteUri(`${dirPath}/${newName}`, globalStore.get),
                        },
                    });
                    model.refresh();
                });
                setEntryManagerProps(undefined);
            },
        });
    }, [dirPath]);

    const handleNativeDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
    }, []);

    const handleNativeDragEnter = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current++;
        if (e.dataTransfer.types.includes("Files")) {
            setIsDragOver(true);
        }
    }, []);

    const handleNativeDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current--;
        if (dragCounterRef.current === 0) {
            setIsDragOver(false);
        }
    }, []);

    const handleNativeDrop = useCallback(
        async (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();

            const dragSource = globalStore.get(model.dragSource);
            const route = decideNativeDropRoute(dragSource, dirPath);
            if (route === "inapp") {
                // In-app drop: our own drag from the directory widget to a different dir.
                try {
                    const destDirUri = await model.formatRemoteUri(dirPath, globalStore.get);
                    for (const f of dragSource.files) {
                        await handleDropCopyOrMove(
                            { srcuri: f.uri, desturi: joinRemoteDir(destDirUri, f.relName), opts: buildDropFileCopyOpts(f.isDir, dragSource.move) },
                            f.isDir,
                            dragSource.move
                        );
                    }
                } finally {
                    cleanupDragState();
                }
                return;
            }
            if (route === "upload") {
                // External drop (no internal drag source): the upload banner is
                // driven by the drag-enter/leave counter, so reset it here and let
                // uploadFiles drive the transfer banner instead. No drag source to
                // clear.
                dragCounterRef.current = 0;
                setIsDragOver(false);
                const files = Array.from(e.dataTransfer.files);
                if (files.length === 0) {
                    return;
                }
                await model.uploadFiles(files, dirPath);
                return;
            }
            // "reject": no-op (and clear any stale drag state for safety)
            cleanupDragState();
        },
        [dirPath, model, handleDropCopyOrMove, cleanupDragState]
    );

    const handleFileContextMenu = useCallback(
        (e: any) => {
            e.preventDefault();
            e.stopPropagation();
            const menu: ContextMenuItem[] = [
                {
                    label: "Paste",
                    enabled: (() => {
                        const cb = globalStore.get(model.fileClipboard);
                        return cb != null && cb.sources.length > 0 && cb.sources[0].absParent !== dirPath;
                    })(),
                    click: () => pasteClipboard(dirPath),
                },
                {
                    label: "New File",
                    click: () => {
                        newFile();
                    },
                },
                {
                    label: "New Folder",
                    click: () => {
                        newDirectory();
                    },
                },
                {
                    type: "separator",
                },
            ];
            addOpenMenuItems(menu, conn, finfo, (remoteUri) => model.downloadFile(remoteUri));

            ContextMenuModel.getInstance().showContextMenu(menu, e);
        },
        [setRefreshVersion, conn, newFile, newDirectory, dirPath, pasteClipboard]
    );

    const handleContainerClick = useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            setEntryManagerProps(undefined);
            // Only a primary-button click on the empty container background clears
            // the selection. Right-click (context menu) never fires onClick, and
            // clicks on rows/cells, the header, search banner, or drop overlay must
            // not clear — those are meaningful interactions.
            if (e.button !== 0) {
                return;
            }
            const target = e.target as HTMLElement;
            if (
                target.closest("[data-rowindex]") ||
                target.closest(".dir-table-head") ||
                target.closest(".dir-search-banner") ||
                target.closest(".dir-transfer-banner") ||
                target.closest(".dir-drop-overlay")
            ) {
                return;
            }
            const cleared = applyClearSelection();
            globalStore.set(model.selectedPaths, cleared.selectedPaths);
            globalStore.set(model.selectionAnchor, cleared.anchor);
            setFocusIndex(-1);
        },
        [model, setEntryManagerProps, setFocusIndex]
    );

    return (
        <Fragment>
            <div
                ref={refs.setReference}
                className={clsx("dir-table-container", { "drag-over": isDragOver && activeDragSource == null })}
                onChangeCapture={(e) => {
                    const event = e as React.ChangeEvent<HTMLInputElement>;
                    if (!entryManagerProps) {
                        setSearchText(event.target.value.toLowerCase());
                    }
                }}
                {...getReferenceProps()}
                onContextMenu={(e) => handleFileContextMenu(e)}
                onClick={handleContainerClick}
                onDragOver={handleNativeDragOver}
                onDragEnter={handleNativeDragEnter}
                onDragLeave={handleNativeDragLeave}
                onDrop={handleNativeDrop}
            >
                {isDragOver && activeDragSource == null && (
                    <div className="dir-drop-overlay">{getDropBannerText(activeDragSource)}</div>
                )}
                {activeDragSource != null && (
                    <div className="dir-drag-chip">{getDragChipText(activeDragSource)}</div>
                )}
                {(uploadProgress || uploadStatus) && (
                    <div className="dir-transfer-banner">
                        {uploadStatus ? (
                            <div className="dir-transfer-banner-top">
                                <div className="dir-transfer-banner-text">{uploadStatus.text}</div>
                                {uploadStatus.persist && (
                                    <button
                                        type="button"
                                        className="dir-transfer-dismiss"
                                        onClick={dismissUploadStatus}
                                        title="Dismiss"
                                    >
                                        <i className="fa-solid fa-xmark" />
                                    </button>
                                )}
                            </div>
                        ) : (
                            <>
                                <div className="dir-transfer-banner-top">
                                    <div className="dir-transfer-banner-text">
                                        Uploading {uploadProgress.fileName} —{" "}
                                        {uploadPercent(uploadProgress.sent, uploadProgress.total)}%
                                    </div>
                                </div>
                                <div className="dir-transfer-banner-bottom">
                                    <div className="dir-transfer-progress-bar">
                                        <div
                                            className="dir-transfer-progress-fill"
                                            style={{
                                                width: `${uploadPercent(uploadProgress.sent, uploadProgress.total)}%`,
                                            }}
                                        />
                                    </div>
                                    <span className="dir-transfer-speed">{formatSpeed(uploadProgress.speedBps)}</span>
                                    <button type="button" className="dir-transfer-cancel" onClick={handleCancelUpload}>
                                        Cancel
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                )}
                {downloadProgress && (
                    <div className="dir-transfer-banner">
                        {downloadProgress.done != null ? (
                            <div className="dir-transfer-banner-top">
                                <div className="dir-transfer-banner-text">
                                    {formatDownloadDoneText(downloadProgress.done)}
                                </div>
                                {isDownloadFailure(downloadProgress.done) && (
                                    <button
                                        type="button"
                                        className="dir-transfer-dismiss"
                                        onClick={dismissDownloadStatus}
                                        title="Dismiss"
                                    >
                                        <i className="fa-solid fa-xmark" />
                                    </button>
                                )}
                            </div>
                        ) : (
                            <>
                                <div className="dir-transfer-banner-top">
                                    <div className="dir-transfer-banner-text">
                                        Downloading {downloadProgress.fileName}
                                        {downloadProgress.total > 0
                                            ? ` — ${downloadPercent(downloadProgress.sent, downloadProgress.total)}%`
                                            : "…"}
                                    </div>
                                </div>
                                {downloadProgress.total > 0 && (
                                    <div className="dir-transfer-banner-bottom">
                                        <div className="dir-transfer-progress-bar">
                                            <div
                                                className="dir-transfer-progress-fill"
                                                style={{
                                                    width: `${downloadPercent(downloadProgress.sent, downloadProgress.total)}%`,
                                                }}
                                            />
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}
                <DirectoryTable
                    model={model}
                    data={filteredData}
                    search={searchText}
                    focusIndex={focusIndex}
                    setFocusIndex={setFocusIndex}
                    setSearch={setSearchText}
                    setSelectedPath={setSelectedPath}
                    setRefreshVersion={setRefreshVersion}
                    entryManagerOverlayPropsAtom={entryManagerPropsAtom}
                    newFile={newFile}
                    newDirectory={newDirectory}
                    onRowDrop={handleRowDrop}
                    onCleanupDragState={cleanupDragState}
                    confirmDelete={confirmDelete}
                />
                {confirmDeleteMsg && (
                    <div onClick={(e) => e.stopPropagation()}>
                        <ErrorOverlay
                            errorMsg={confirmDeleteMsg}
                            resetOverlay={() => setConfirmDeleteMsg(null)}
                            className="z-[100]"
                        />
                    </div>
                )}
            </div>
            {entryManagerProps && (
                <EntryManagerOverlay
                    {...entryManagerProps}
                    forwardRef={refs.setFloating}
                    style={floatingStyles}
                    getReferenceProps={getFloatingProps}
                    onCancel={() => setEntryManagerProps(undefined)}
                />
            )}
            {directoryDropdownOpen && (
                <DirectoryDropdown
                    currentPath={dirPath || "/"}
                    connection={conn === "local" ? "" : conn}
                    onSelect={(path) => model.goHistory(path)}
                    onClose={() => globalStore.set(model.directoryDropdownOpen, false)}
                    anchorRef={model.previewTextRef}
                    dirsOnly
                    showHidden={showHiddenFiles}
                />
            )}
        </Fragment>
    );
}

export { DirectoryPreview };
