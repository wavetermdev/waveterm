// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { Input } from "@/app/element/input";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { PLATFORM, atoms, createBlock, getApi, globalStore } from "@/app/store/global";
import { FileService } from "@/app/store/services";
import type { PreviewModel } from "@/app/view/preview/preview";
import { checkKeyPressed, isCharacterKeyEvent } from "@/util/keyutil";
import { base64ToString, fireAndForget, isBlank } from "@/util/util";
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
import { quote as shellQuote } from "shell-quote";
import { debounce } from "throttle-debounce";
import "./directorypreview.scss";

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
    if (bytes < 0) {
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

function getIconClass(icon: string): string {
    if (!isIconValid(icon)) {
        return "fa fa-solid fa-question fa-fw";
    }
    return `fa fa-solid fa-${icon} fa-fw`;
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
                    newPath = path.replace(fileName, newName);
                    console.log(`replacing ${fileName} with ${newName}: ${path}`);
                    fireAndForget(async () => {
                        const connection = await globalStore.get(model.connection);
                        await FileService.Rename(connection, path, newPath);
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
        setSelectedPath((table.getSortedRowModel()?.flatRows[focusIndex]?.getValue("path") as string) ?? null);
    }, [table, focusIndex, data]);

    useEffect(() => {
        const rows = table.getRowModel()?.flatRows;
        for (const row of rows) {
            if (row.getValue("name") == "..") {
                row.pin("top");
                return;
            }
        }
    }, [data]);
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

function getNormFilePath(finfo: FileInfo): string {
    if (finfo.isdir) {
        return finfo.dir;
    }
    return finfo.dir + "/" + finfo.name;
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
            const parentRect = bodyRef.current.getBoundingClientRect();
            const viewportScrollTop = viewport.scrollTop;

            const rowTopRelativeToViewport = rowRect.top - parentRect.top;
            const rowBottomRelativeToViewport = rowRect.bottom - parentRect.top;

            if (rowTopRelativeToViewport < viewportScrollTop) {
                // Row is above the visible area
                viewport.scrollTo({ top: rowTopRelativeToViewport });
            } else if (rowBottomRelativeToViewport > viewportScrollTop + viewportHeight) {
                // Row is below the visible area
                viewport.scrollTo({ top: rowBottomRelativeToViewport - viewportHeight });
            }
        }
        // setIndexChangedFromClick(false);
    }, [focusIndex]);

    const handleFileContextMenu = useCallback(
        (e: any, finfo: FileInfo) => {
            e.preventDefault();
            e.stopPropagation();
            if (finfo == null) {
                return;
            }
            const normPath = getNormFilePath(finfo);
            const fileName = finfo.path.split("/").pop();
            let openNativeLabel = "Open File";
            if (finfo.isdir) {
                openNativeLabel = "Open Directory in File Manager";
                if (PLATFORM == "darwin") {
                    openNativeLabel = "Open Directory in Finder";
                } else if (PLATFORM == "win32") {
                    openNativeLabel = "Open Directory in Explorer";
                }
            } else {
                openNativeLabel = "Open File in Default Application";
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
                        getApi().downloadFile(normPath);
                    },
                },
                {
                    type: "separator",
                },
                // TODO: Only show this option for local files, resolve correct host path if connection is WSL
                {
                    label: openNativeLabel,
                    click: () => {
                        getApi().openNativePath(normPath);
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
                                },
                            };
                            await createBlock(blockDef);
                        }),
                },
            ];
            if (finfo.mimetype == "directory") {
                menu.push({
                    label: "Open Terminal in New Block",
                    click: () =>
                        fireAndForget(async () => {
                            const termBlockDef: BlockDef = {
                                meta: {
                                    controller: "shell",
                                    view: "term",
                                    "cmd:cwd": finfo.path,
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
                            await FileService.DeleteFile(conn, finfo.path).catch((e) => console.log(e));
                            setRefreshVersion((current) => current + 1);
                        });
                    },
                }
            );
            ContextMenuModel.showContextMenu(menu, e);
        },
        [setRefreshVersion, conn]
    );

    const displayRow = useCallback(
        (row: Row<FileInfo>, idx: number) => (
            <div
                ref={(el) => (rowRefs.current[idx] = el)}
                className={clsx("dir-table-body-row", { focused: focusIndex === idx })}
                key={row.id}
                onDoubleClick={() => {
                    const newFileName = row.getValue("path") as string;
                    model.goHistory(newFileName);
                    setSearch("");
                }}
                onClick={() => setFocusIndex(idx)}
                onContextMenu={(e) => handleFileContextMenu(e, row.original)}
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
        ),
        [setSearch, handleFileContextMenu, setFocusIndex, focusIndex]
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
                {table.getTopRows().map(displayRow)}
                {table.getCenterRows().map((row, idx) => displayRow(row, idx + table.getTopRows().length))}
            </div>
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
            const file = await FileService.ReadFile(conn, dirPath);
            const serializedContent = base64ToString(file?.data64);
            const content: FileInfo[] = JSON.parse(serializedContent);
            setUnfilteredData(content);
        };
        getContent();
    }, [conn, dirPath, refreshVersion]);

    useEffect(() => {
        const filtered = unfilteredData.filter((fileInfo) => {
            if (!showHiddenFiles && fileInfo.name.startsWith(".") && fileInfo.name != "..") {
                return false;
            }
            return fileInfo.name.toLowerCase().includes(searchText);
        });
        setFilteredData(filtered);
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
                console.log(selectedPath);
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

    const dismiss = useDismiss(context);
    const { getReferenceProps, getFloatingProps } = useInteractions([dismiss]);

    const newFile = useCallback(() => {
        setEntryManagerProps({
            entryManagerType: EntryManagerType.NewFile,
            onSave: (newName: string) => {
                console.log(`newFile: ${newName}`);
                fireAndForget(async () => {
                    const connection = await globalStore.get(model.connection);
                    await FileService.TouchFile(connection, `${dirPath}/${newName}`);
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
                    const connection = await globalStore.get(model.connection);
                    await FileService.Mkdir(connection, `${dirPath}/${newName}`);
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
            let openNativeLabel = "Open Directory in File Manager";
            if (PLATFORM == "darwin") {
                openNativeLabel = "Open Directory in Finder";
            } else if (PLATFORM == "win32") {
                openNativeLabel = "Open Directory in Explorer";
            }
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
                // TODO: Only show this option for local files, resolve correct host path if connection is WSL
                {
                    label: openNativeLabel,
                    click: () => {
                        console.log(`opening ${dirPath}`);
                        getApi().openNativePath(dirPath);
                    },
                },
            ];
            menu.push({
                label: "Open Terminal in New Block",
                click: async () => {
                    const termBlockDef: BlockDef = {
                        meta: {
                            controller: "shell",
                            view: "term",
                            "cmd:cwd": dirPath,
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

export { DirectoryPreview };
