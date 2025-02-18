// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { CopyButton } from "@/app/element/copybutton";
import { Input } from "@/app/element/input";
import { useDimensionsWithCallbackRef } from "@/app/hook/useDimensions";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { PLATFORM, atoms, createBlock, getApi, globalStore } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { type PreviewModel } from "@/app/view/preview/preview";
import { checkKeyPressed, isCharacterKeyEvent } from "@/util/keyutil";
import { fireAndForget, isBlank, makeNativeLabel } from "@/util/util";
import { formatRemoteUri } from "@/util/waveutil";
import { offset, useDismiss, useFloating, useInteractions } from "@floating-ui/react";
import {
    Column,
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
import dayjs from "dayjs";
import { PrimitiveAtom, atom, useAtom, useAtomValue, useSetAtom } from "jotai";
import { OverlayScrollbarsComponent, OverlayScrollbarsComponentRef } from "overlayscrollbars-react";
import React, { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDrag, useDrop } from "react-dnd";
import { quote as shellQuote } from "shell-quote";
import { debounce } from "throttle-debounce";
import "./directorypreview.scss";

const PageJumpSize = 20;

type FileCopyStatus = {
    copyData: CommandFileCopyData;
    copyError: string;
    allowRetry: boolean;
    isDir: boolean;
};

declare module "@tanstack/react-table" {
    interface TableMeta<TData extends RowData> {
        updateName: (path: string) => void;
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
}

const columnHelper = createColumnHelper<FileInfo>();

const displaySuffixes = {
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

function getBestUnit(bytes: number, si: boolean = false, sigfig: number = 3): string {
    if (bytes === undefined || bytes < 0) {
        return "-";
    }
    const units = si ? ["kB", "MB", "GB", "TB"] : ["KiB", "MiB", "GiB", "TiB"];
    const divisor = si ? 1000 : 1024;

    let currentUnit = "B";
    let currentValue = bytes;
    let idx = 0;
    while (currentValue > divisor && idx < units.length - 1) {
        currentUnit = units[idx];
        currentValue /= divisor;
        idx += 1;
    }

    return `${parseFloat(currentValue.toPrecision(sigfig))}${displaySuffixes[currentUnit]}`;
}

function getLastModifiedTime(unixMillis: number, column: Column<FileInfo, number>): string {
    const fileDatetime = dayjs(new Date(unixMillis));
    const nowDatetime = dayjs(new Date());

    let datePortion: string;
    if (nowDatetime.isSame(fileDatetime, "date")) {
        datePortion = "Today";
    } else if (nowDatetime.subtract(1, "day").isSame(fileDatetime, "date")) {
        datePortion = "Yesterday";
    } else {
        datePortion = dayjs(fileDatetime).format("M/D/YY");
    }

    if (column.getSize() > 120) {
        return `${datePortion}, ${dayjs(fileDatetime).format("h:mm A")}`;
    }
    return datePortion;
}

const iconRegex = /^[a-z0-9- ]+$/;

function isIconValid(icon: string): boolean {
    if (isBlank(icon)) {
        return false;
    }
    return icon.match(iconRegex) != null;
}

function getSortIcon(sortType: string | boolean): React.ReactNode {
    switch (sortType) {
        case "asc":
            return <i className="fa-solid fa-chevron-up dir-table-head-direction"></i>;
        case "desc":
            return <i className="fa-solid fa-chevron-down dir-table-head-direction"></i>;
        default:
            return null;
    }
}

function cleanMimetype(input: string): string {
    const truncated = input.split(";")[0];
    return truncated.trim();
}

enum EntryManagerType {
    NewFile = "New File",
    NewDirectory = "New Folder",
    EditName = "Rename",
}

type EntryManagerOverlayProps = {
    forwardRef?: React.Ref<HTMLDivElement>;
    entryManagerType: EntryManagerType;
    startingValue?: string;
    onSave: (newValue: string) => void;
    onCancel?: () => void;
    style?: React.CSSProperties;
    getReferenceProps?: () => any;
};

const EntryManagerOverlay = memo(
    ({
        entryManagerType,
        startingValue,
        onSave,
        onCancel,
        forwardRef,
        style,
        getReferenceProps,
    }: EntryManagerOverlayProps) => {
        const [value, setValue] = useState(startingValue);
        return (
            <div className="entry-manager-overlay" ref={forwardRef} style={style} {...getReferenceProps()}>
                <div className="entry-manager-type">{entryManagerType}</div>
                <div className="entry-manager-input">
                    <Input
                        value={value}
                        onChange={setValue}
                        autoFocus={true}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                e.stopPropagation();
                                onSave(value);
                            }
                        }}
                    />
                </div>
                <div className="entry-manager-buttons">
                    <Button className="vertical-padding-4" onClick={() => onSave(value)}>
                        Save
                    </Button>
                    <Button className="vertical-padding-4 red outlined" onClick={onCancel}>
                        Cancel
                    </Button>
                </div>
            </div>
        );
    }
);

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
}: DirectoryTableProps) {
    const fullConfig = useAtomValue(atoms.fullConfigAtom);
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
                cell: (info) => <span className="dir-table-name">{info.getValue()}</span>,
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
                cell: (info) => (
                    <span className="dir-table-lastmod">{getLastModifiedTime(info.getValue(), info.column)}</span>
                ),
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
                cell: (info) => <span className="dir-table-type">{cleanMimetype(info.getValue() ?? "")}</span>,
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

    const updateName = useCallback((path: string) => {
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
                    fireAndForget(async () => {
                        await RpcApi.FileMoveCommand(TabRpcClient, {
                            srcuri: await model.formatRemoteUri(path, globalStore.get),
                            desturi: await model.formatRemoteUri(newPath, globalStore.get),
                            opts: {
                                recursive: true,
                            },
                        });
                        model.refreshCallback();
                    });
                }
                setEntryManagerProps(undefined);
            },
        });
    }, []);

    const table = useReactTable({
        data,
        columns,
        columnResizeMode: "onChange",
        getSortedRowModel: getSortedRowModel(),
        getCoreRowModel: getCoreRowModel(),

        initialState: {
            sorting: [
                {
                    id: "name",
                    desc: false,
                },
            ],
            columnVisibility: {
                path: false,
            },
            rowPinning: {
                top: [],
                bottom: [],
            },
        },
        enableMultiSort: false,
        enableSortingRemoval: false,
        meta: {
            updateName,
            newFile,
            newDirectory,
        },
    });

    useEffect(() => {
        const topRows = table.getTopRows() || [];
        const centerRows = table.getCenterRows() || [];
        const allRows = [...topRows, ...centerRows];
        setSelectedPath((allRows[focusIndex]?.getValue("path") as string) ?? null);
    }, [table, focusIndex, data]);

    useEffect(() => {
        const rows = table.getRowModel()?.flatRows;
        for (const row of rows) {
            if (row.getValue("name") == "..") {
                row.pin("top");
                return;
            }
        }
    }, [table]);
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

    const osRef = useRef<OverlayScrollbarsComponentRef>();
    const bodyRef = useRef<HTMLDivElement>();
    const [scrollHeight, setScrollHeight] = useState(0);

    const onScroll = useCallback(
        debounce(2, () => {
            setScrollHeight(osRef.current.osInstance().elements().viewport.scrollTop);
        }),
        []
    );
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
                            <div
                                className="dir-table-head-cell"
                                key={header.id}
                                style={{ width: `calc(var(--header-${header.id}-size) * 1px)` }}
                            >
                                <div
                                    className="dir-table-head-cell-content"
                                    onClick={() => header.column.toggleSorting()}
                                >
                                    {header.isPlaceholder
                                        ? null
                                        : flexRender(header.column.columnDef.header, header.getContext())}
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
                        ))}
                    </div>
                ))}
            </div>
            {table.getState().columnSizingInfo.isResizingColumn ? (
                <MemoizedTableBody
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
                />
            ) : (
                <TableBody
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
                />
            )}
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
}: TableBodyProps) {
    const dummyLineRef = useRef<HTMLDivElement>();
    const warningBoxRef = useRef<HTMLDivElement>();
    const rowRefs = useRef<HTMLDivElement[]>([]);
    const conn = useAtomValue(model.connection);

    useEffect(() => {
        if (focusIndex !== null && rowRefs.current[focusIndex] && bodyRef.current && osRef) {
            const viewport = osRef.osInstance().elements().viewport;
            const viewportHeight = viewport.offsetHeight;
            const rowElement = rowRefs.current[focusIndex];
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
        }
        // setIndexChangedFromClick(false);
    }, [focusIndex]);

    const handleFileContextMenu = useCallback(
        async (e: any, finfo: FileInfo) => {
            e.preventDefault();
            e.stopPropagation();
            if (finfo == null) {
                return;
            }
            const normPath = finfo.path;
            const fileName = finfo.path.split("/").pop();
            let parentFileInfo: FileInfo;
            try {
                parentFileInfo = await RpcApi.FileInfoCommand(TabRpcClient, {
                    info: {
                        path: await model.formatRemoteUri(finfo.dir, globalStore.get),
                    },
                });
            } catch (e) {
                console.log("could not get parent file info. using child file info as fallback");
                parentFileInfo = finfo;
            }
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
                        table.options.meta.updateName(finfo.path);
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
                {
                    type: "separator",
                },
                {
                    label: "Download File",
                    click: () => {
                        const remoteUri = formatRemoteUri(finfo.path, conn);
                        getApi().downloadFile(remoteUri);
                    },
                },
                {
                    type: "separator",
                },
                {
                    label: "Open Preview in New Block",
                    click: () =>
                        fireAndForget(async () => {
                            const blockDef: BlockDef = {
                                meta: {
                                    view: "preview",
                                    file: finfo.path,
                                    connection: conn,
                                },
                            };
                            await createBlock(blockDef);
                        }),
                },
            ];
            if (!conn) {
                menu.push(
                    {
                        type: "separator",
                    },
                    // TODO: resolve correct host path if connection is WSL
                    {
                        label: makeNativeLabel(PLATFORM, finfo.isdir, false),
                        click: () => {
                            getApi().openNativePath(normPath);
                        },
                    },
                    {
                        label: makeNativeLabel(PLATFORM, true, true),
                        click: () => {
                            getApi().openNativePath(parentFileInfo.path);
                        },
                    }
                );
            }
            if (finfo.mimetype == "directory") {
                menu.push({
                    label: "Open Terminal in New Block",
                    click: () =>
                        fireAndForget(async () => {
                            const termBlockDef: BlockDef = {
                                meta: {
                                    controller: "shell",
                                    view: "term",
                                    "cmd:cwd": await model.formatRemoteUri(finfo.path, globalStore.get),
                                    connection: conn,
                                },
                            };
                            await createBlock(termBlockDef);
                        }),
                });
            }
            menu.push(
                {
                    type: "separator",
                },
                {
                    label: "Delete",
                    click: () => {
                        fireAndForget(async () => {
                            await RpcApi.FileDeleteCommand(TabRpcClient, {
                                path: await model.formatRemoteUri(finfo.path, globalStore.get),
                                recursive: false,
                            }).catch((e) => console.log(e));
                            setRefreshVersion((current) => current + 1);
                        });
                    },
                }
            );
            ContextMenuModel.showContextMenu(menu, e);
        },
        [setRefreshVersion, conn]
    );

    return (
        <div className="dir-table-body" ref={bodyRef}>
            {search !== "" && (
                <div className="dir-table-body-search-display" ref={warningBoxRef}>
                    <span>Searching for "{search}"</span>
                    <div className="search-display-close-button dir-table-button" onClick={() => setSearch("")}>
                        <i className="fa-solid fa-xmark" />
                        <input type="text" value={search} onChange={() => {}} />
                    </div>
                </div>
            )}
            <div className="dir-table-body-scroll-box">
                <div className="dummy dir-table-body-row" ref={dummyLineRef}>
                    <div className="dir-table-body-cell">dummy-data</div>
                </div>
                {table.getTopRows().map((row, idx) => (
                    <TableRow
                        model={model}
                        row={row}
                        focusIndex={focusIndex}
                        setFocusIndex={setFocusIndex}
                        setSearch={setSearch}
                        idx={idx}
                        handleFileContextMenu={handleFileContextMenu}
                        key={idx}
                    />
                ))}
                {table.getCenterRows().map((row, idx) => (
                    <TableRow
                        model={model}
                        row={row}
                        focusIndex={focusIndex}
                        setFocusIndex={setFocusIndex}
                        setSearch={setSearch}
                        idx={idx + table.getTopRows().length}
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
    setFocusIndex: (_: number) => void;
    setSearch: (_: string) => void;
    idx: number;
    handleFileContextMenu: (e: any, finfo: FileInfo) => Promise<void>;
};

const TableRow = React.forwardRef(function ({
    model,
    row,
    focusIndex,
    setFocusIndex,
    setSearch,
    idx,
    handleFileContextMenu,
}: TableRowProps) {
    const dirPath = useAtomValue(model.normFilePath);
    const connection = useAtomValue(model.connection);

    const dragItem: DraggedFile = {
        relName: row.getValue("name") as string,
        absParent: dirPath,
        uri: formatRemoteUri(row.getValue("path") as string, connection),
        isDir: row.original.isdir,
    };
    const [_, drag] = useDrag(
        () => ({
            type: "FILE_ITEM",
            canDrag: true,
            item: () => dragItem,
        }),
        [dragItem]
    );

    return (
        <div
            className={clsx("dir-table-body-row", { focused: focusIndex === idx })}
            onDoubleClick={() => {
                const newFileName = row.getValue("path") as string;
                model.goHistory(newFileName);
                setSearch("");
            }}
            onClick={() => setFocusIndex(idx)}
            onContextMenu={(e) => handleFileContextMenu(e, row.original)}
            ref={drag}
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
});

const MemoizedTableBody = React.memo(
    TableBody,
    (prev, next) => prev.table.options.data == next.table.options.data
) as typeof TableBody;

interface DirectoryPreviewProps {
    model: PreviewModel;
}

function DirectoryPreview({ model }: DirectoryPreviewProps) {
    const [searchText, setSearchText] = useState("");
    const [focusIndex, setFocusIndex] = useState(0);
    const [unfilteredData, setUnfilteredData] = useState<FileInfo[]>([]);
    const [filteredData, setFilteredData] = useState<FileInfo[]>([]);
    const showHiddenFiles = useAtomValue(model.showHiddenFiles);
    const [selectedPath, setSelectedPath] = useState("");
    const [refreshVersion, setRefreshVersion] = useAtom(model.refreshVersion);
    const conn = useAtomValue(model.connection);
    const blockData = useAtomValue(model.blockAtom);
    const dirPath = useAtomValue(model.normFilePath);
    const [copyStatus, setCopyStatus] = useState<FileCopyStatus>(null);

    useEffect(() => {
        model.refreshCallback = () => {
            setRefreshVersion((refreshVersion) => refreshVersion + 1);
        };
        return () => {
            model.refreshCallback = null;
        };
    }, [setRefreshVersion]);

    useEffect(() => {
        const getContent = async () => {
            const file = await RpcApi.FileReadCommand(
                TabRpcClient,
                {
                    info: {
                        path: await model.formatRemoteUri(dirPath, globalStore.get),
                    },
                },
                null
            );
            setUnfilteredData(file.entries);
        };
        getContent();
    }, [conn, dirPath, refreshVersion]);

    useEffect(() => {
        const filtered = unfilteredData?.filter((fileInfo) => {
            if (!showHiddenFiles && fileInfo.name.startsWith(".") && fileInfo.name != "..") {
                return false;
            }
            return fileInfo.name.toLowerCase().includes(searchText);
        });
        setFilteredData(filtered ?? []);
    }, [unfilteredData, showHiddenFiles, searchText]);

    useEffect(() => {
        model.directoryKeyDownHandler = (waveEvent: WaveKeyboardEvent): boolean => {
            if (checkKeyPressed(waveEvent, "Escape")) {
                setSearchText("");
                return;
            }
            if (checkKeyPressed(waveEvent, "ArrowUp")) {
                setFocusIndex((idx) => Math.max(idx - 1, 0));
                return true;
            }
            if (checkKeyPressed(waveEvent, "ArrowDown")) {
                setFocusIndex((idx) => Math.min(idx + 1, filteredData.length - 1));
                return true;
            }
            if (checkKeyPressed(waveEvent, "PageUp")) {
                setFocusIndex((idx) => Math.max(idx - PageJumpSize, 0));
                return true;
            }
            if (checkKeyPressed(waveEvent, "PageDown")) {
                setFocusIndex((idx) => Math.min(idx + PageJumpSize, filteredData.length - 1));
                return true;
            }
            if (checkKeyPressed(waveEvent, "Enter")) {
                if (filteredData.length == 0) {
                    return;
                }
                model.goHistory(selectedPath);
                setSearchText("");
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
                PLATFORM == "darwin" &&
                !blockData?.meta?.connection
            ) {
                getApi().onQuicklook(selectedPath);
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
    }, [filteredData, selectedPath, searchText]);

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

    const handleDropCopy = useCallback(
        async (data: CommandFileCopyData, isDir) => {
            try {
                await RpcApi.FileCopyCommand(TabRpcClient, data, { timeout: data.opts.timeout });
                setCopyStatus(null);
            } catch (e) {
                console.log("copy failed:", e);
                const copyError = `${e}`;
                const allowRetry =
                    copyError.endsWith("overwrite not specified") ||
                    copyError.endsWith("neither overwrite nor merge specified");
                const copyStatus: FileCopyStatus = {
                    copyError,
                    copyData: data,
                    allowRetry,
                    isDir: isDir,
                };
                setCopyStatus(copyStatus);
            }
            model.refreshCallback();
        },
        [setCopyStatus, model.refreshCallback]
    );

    const [, drop] = useDrop(
        () => ({
            accept: "FILE_ITEM", //a name of file drop type
            canDrop: (_, monitor) => {
                const dragItem = monitor.getItem<DraggedFile>();
                // drop if not current dir is the parent directory of the dragged item
                // requires absolute path
                if (monitor.isOver({ shallow: false }) && dragItem.absParent !== dirPath) {
                    return true;
                }
                return false;
            },
            drop: async (draggedFile: DraggedFile, monitor) => {
                if (!monitor.didDrop()) {
                    const timeoutYear = 31536000000; // one year
                    const opts: FileCopyOpts = {
                        timeout: timeoutYear,
                        recursive: true,
                    };
                    const desturi = await model.formatRemoteUri(dirPath, globalStore.get);
                    const data: CommandFileCopyData = {
                        srcuri: draggedFile.uri,
                        desturi,
                        opts,
                    };
                    await handleDropCopy(data, draggedFile.isDir);
                }
            },
            // TODO: mabe add a hover option?
        }),
        [dirPath, model.formatRemoteUri, model.refreshCallback, setCopyStatus]
    );

    useEffect(() => {
        drop(refs.reference);
    }, [refs.reference]);

    const dismiss = useDismiss(context);
    const { getReferenceProps, getFloatingProps } = useInteractions([dismiss]);

    const newFile = useCallback(() => {
        setEntryManagerProps({
            entryManagerType: EntryManagerType.NewFile,
            onSave: (newName: string) => {
                console.log(`newFile: ${newName}`);
                fireAndForget(async () => {
                    await RpcApi.FileCreateCommand(
                        TabRpcClient,
                        {
                            info: {
                                path: await model.formatRemoteUri(`${dirPath}/${newName}`, globalStore.get),
                            },
                        },
                        null
                    );
                    model.refreshCallback();
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
                    await RpcApi.FileMkdirCommand(TabRpcClient, {
                        info: {
                            path: await model.formatRemoteUri(`${dirPath}/${newName}`, globalStore.get),
                        },
                    });
                    model.refreshCallback();
                });
                setEntryManagerProps(undefined);
            },
        });
    }, [dirPath]);

    const handleFileContextMenu = useCallback(
        (e: any) => {
            e.preventDefault();
            e.stopPropagation();
            const menu: ContextMenuItem[] = [
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
            if (!conn) {
                // TODO:  resolve correct host path if connection is WSL
                menu.push({
                    label: makeNativeLabel(PLATFORM, true, true),
                    click: () => {
                        getApi().openNativePath(dirPath);
                    },
                });
            }
            menu.push({
                label: "Open Terminal in New Block",
                click: async () => {
                    const termBlockDef: BlockDef = {
                        meta: {
                            controller: "shell",
                            view: "term",
                            "cmd:cwd": dirPath,
                            connection: conn,
                        },
                    };
                    await createBlock(termBlockDef);
                },
            });

            ContextMenuModel.showContextMenu(menu, e);
        },
        [setRefreshVersion, conn, newFile, newDirectory, dirPath]
    );

    return (
        <Fragment>
            <div
                ref={refs.setReference}
                className="dir-table-container"
                onChangeCapture={(e) => {
                    const event = e as React.ChangeEvent<HTMLInputElement>;
                    if (!entryManagerProps) {
                        setSearchText(event.target.value.toLowerCase());
                    }
                }}
                {...getReferenceProps()}
                onContextMenu={(e) => handleFileContextMenu(e)}
                onClick={() => setEntryManagerProps(undefined)}
            >
                {copyStatus != null && (
                    <CopyErrorOverlay
                        copyStatus={copyStatus}
                        setCopyStatus={setCopyStatus}
                        handleDropCopy={handleDropCopy}
                    />
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
                />
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
        </Fragment>
    );
}

const CopyErrorOverlay = React.memo(
    ({
        copyStatus,
        setCopyStatus,
        handleDropCopy,
    }: {
        copyStatus: FileCopyStatus;
        setCopyStatus: (_: FileCopyStatus) => void;
        handleDropCopy: (data: CommandFileCopyData, isDir: boolean) => Promise<void>;
    }) => {
        const [overlayRefCallback, _, domRect] = useDimensionsWithCallbackRef(30);
        const width = domRect?.width;

        const handleRetryCopy = React.useCallback(
            async (copyOpt?: string) => {
                if (!copyStatus) {
                    return;
                }
                let overwrite = copyOpt == "overwrite";
                let merge = copyOpt == "merge";
                const updatedData = {
                    ...copyStatus.copyData,
                    opts: { ...copyStatus.copyData.opts, overwrite, merge },
                };
                await handleDropCopy(updatedData, copyStatus.isDir);
            },
            [copyStatus.copyData]
        );

        let statusText = "Copy Error";
        let errorMsg = `error: ${copyStatus?.copyError}`;
        if (copyStatus?.allowRetry) {
            statusText = "Confirm Overwrite File(s)";
            errorMsg = "This copy operation will overwrite an existing file. Would you like to continue?";
        }

        const buttonClassName = "outlined grey font-size-11 vertical-padding-3 horizontal-padding-7";

        const handleRemoveCopyError = React.useCallback(async () => {
            setCopyStatus(null);
        }, [setCopyStatus]);

        const handleCopyToClipboard = React.useCallback(async () => {
            await navigator.clipboard.writeText(errorMsg);
        }, [errorMsg]);

        return (
            <div
                ref={overlayRefCallback}
                className="absolute top-[0] left-1.5 right-1.5 z-[var(--zindex-block-mask-inner)] overflow-hidden bg-[var(--conn-status-overlay-bg-color)] backdrop-blur-[50px] rounded-md shadow-lg"
            >
                <div className="flex flex-row justify-between p-2.5 pl-3 font-[var(--base-font)] text-[var(--secondary-text-color)]">
                    <div
                        className={clsx("flex flex-row items-center gap-3 grow min-w-0", {
                            "items-start": true,
                        })}
                    >
                        <i className="fa-solid fa-triangle-exclamation text-[#e6ba1e] text-base"></i>

                        <div className="flex flex-col items-start gap-1 grow w-full">
                            <div className="max-w-full text-xs font-semibold leading-4 tracking-[0.11px] text-white">
                                {statusText}
                            </div>

                            <OverlayScrollbarsComponent
                                className="group text-xs font-normal leading-[15px] tracking-[0.11px] text-wrap max-h-20 rounded-lg py-1.5 pl-0 relative w-full"
                                options={{ scrollbars: { autoHide: "leave" } }}
                            >
                                <CopyButton
                                    className="invisible group-hover:visible flex absolute top-0 right-1 rounded backdrop-blur-lg p-1 items-center justify-end gap-1"
                                    onClick={handleCopyToClipboard}
                                    title="Copy"
                                />
                                <div>{errorMsg}</div>
                            </OverlayScrollbarsComponent>

                            {copyStatus?.allowRetry && (
                                <div className="flex flex-row gap-1.5">
                                    <Button className={buttonClassName} onClick={() => handleRetryCopy("overwrite")}>
                                        Delete Then Copy
                                    </Button>
                                    {copyStatus.isDir && (
                                        <Button className={buttonClassName} onClick={() => handleRetryCopy("merge")}>
                                            Sync
                                        </Button>
                                    )}
                                    <Button className={buttonClassName} onClick={handleRemoveCopyError}>
                                        Cancel
                                    </Button>
                                </div>
                            )}
                        </div>

                        {!copyStatus?.allowRetry && (
                            <div className="flex items-start">
                                <Button
                                    className={clsx(buttonClassName, "fa-xmark fa-solid")}
                                    onClick={handleRemoveCopyError}
                                />
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }
);

export { DirectoryPreview };
