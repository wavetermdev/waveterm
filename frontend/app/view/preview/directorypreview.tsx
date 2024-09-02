// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useHeight } from "@/app/hook/useHeight";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { atoms, createBlock, getApi } from "@/app/store/global";
import type { PreviewModel } from "@/app/view/preview/preview";
import * as services from "@/store/services";
import * as keyutil from "@/util/keyutil";
import * as util from "@/util/util";
import {
    Column,
    Row,
    Table,
    createColumnHelper,
    flexRender,
    getCoreRowModel,
    getSortedRowModel,
    useReactTable,
} from "@tanstack/react-table";
import clsx from "clsx";
import dayjs from "dayjs";
import * as jotai from "jotai";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { quote as shellQuote } from "shell-quote";

import { OverlayScrollbars } from "overlayscrollbars";

import "./directorypreview.less";

interface DirectoryTableProps {
    model: PreviewModel;
    data: FileInfo[];
    search: string;
    focusIndex: number;
    setFocusIndex: (_: number) => void;
    setSearch: (_: string) => void;
    setSelectedPath: (_: string) => void;
    setRefreshVersion: React.Dispatch<React.SetStateAction<number>>;
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
    if (util.isBlank(icon)) {
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

function DirectoryTable({
    model,
    data,
    search,
    focusIndex,
    setFocusIndex,
    setSearch,
    setSelectedPath,
    setRefreshVersion,
}: DirectoryTableProps) {
    const fullConfig = jotai.useAtomValue(atoms.fullConfigAtom);
    const getIconFromMimeType = useCallback(
        (mimeType: string): string => {
            while (mimeType.length > 0) {
                let icon = fullConfig.mimetypes?.[mimeType]?.icon ?? null;
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
        (mimeType: string): string => {
            let iconColor = fullConfig.mimetypes?.[mimeType]?.color ?? "inherit";
            return iconColor;
        },
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

    return (
        <div className="dir-table" style={{ ...columnSizeVars }}>
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
                    model={model}
                    data={data}
                    table={table}
                    search={search}
                    focusIndex={focusIndex}
                    setFocusIndex={setFocusIndex}
                    setSearch={setSearch}
                    setSelectedPath={setSelectedPath}
                    setRefreshVersion={setRefreshVersion}
                />
            ) : (
                <TableBody
                    model={model}
                    data={data}
                    table={table}
                    search={search}
                    focusIndex={focusIndex}
                    setFocusIndex={setFocusIndex}
                    setSearch={setSearch}
                    setSelectedPath={setSelectedPath}
                    setRefreshVersion={setRefreshVersion}
                />
            )}
        </div>
    );
}

interface TableBodyProps {
    model: PreviewModel;
    data: Array<FileInfo>;
    table: Table<FileInfo>;
    search: string;
    focusIndex: number;
    setFocusIndex: (_: number) => void;
    setSearch: (_: string) => void;
    setSelectedPath: (_: string) => void;
    setRefreshVersion: React.Dispatch<React.SetStateAction<number>>;
}

function TableBody({
    model,
    data,
    table,
    search,
    focusIndex,
    setFocusIndex,
    setSearch,
    setSelectedPath,
    setRefreshVersion,
}: TableBodyProps) {
    const [bodyHeight, setBodyHeight] = useState(0);

    const dummyLineRef = useRef<HTMLDivElement>(null);
    const parentRef = useRef<HTMLDivElement>(null);
    const warningBoxRef = useRef<HTMLDivElement>(null);
    const osInstanceRef = useRef<OverlayScrollbars>(null);
    const rowRefs = useRef<HTMLDivElement[]>([]);

    const parentHeight = useHeight(parentRef);
    const conn = jotai.useAtomValue(model.connection);

    useEffect(() => {
        if (dummyLineRef.current && data && parentRef.current) {
            const rowHeight = dummyLineRef.current.offsetHeight;
            const fullTBodyHeight = rowHeight * data.length;
            const warningBoxHeight = warningBoxRef.current?.offsetHeight ?? 0;
            const maxHeightLessHeader = parentHeight - warningBoxHeight;
            const tbodyHeight = Math.min(maxHeightLessHeader, fullTBodyHeight);

            setBodyHeight(tbodyHeight);
        }
    }, [data, parentHeight]);

    useEffect(() => {
        if (focusIndex !== null && rowRefs.current[focusIndex] && parentRef.current) {
            const viewport = osInstanceRef.current.elements().viewport;
            const viewportHeight = viewport.offsetHeight;
            const rowElement = rowRefs.current[focusIndex];
            const rowRect = rowElement.getBoundingClientRect();
            const parentRect = parentRef.current.getBoundingClientRect();
            const viewportScrollTop = viewport.scrollTop;

            const rowTopRelativeToViewport = rowRect.top - parentRect.top + viewportScrollTop;
            const rowBottomRelativeToViewport = rowRect.bottom - parentRect.top + viewportScrollTop;

            if (rowTopRelativeToViewport < viewportScrollTop) {
                // Row is above the visible area
                viewport.scrollTo({ top: rowTopRelativeToViewport });
            } else if (rowBottomRelativeToViewport > viewportScrollTop + viewportHeight) {
                // Row is below the visible area
                viewport.scrollTo({ top: rowBottomRelativeToViewport - viewportHeight });
            }
        }
    }, [focusIndex, parentHeight]);

    const handleFileContextMenu = useCallback(
        (e: any, path: string, mimetype: string) => {
            e.preventDefault();
            e.stopPropagation();
            const fileName = path.split("/").pop();
            const menu: ContextMenuItem[] = [
                {
                    label: "Copy File Name",
                    click: () => navigator.clipboard.writeText(fileName),
                },
                {
                    label: "Copy Full File Name",
                    click: () => navigator.clipboard.writeText(path),
                },
                {
                    label: "Copy File Name (Shell Quoted)",
                    click: () => navigator.clipboard.writeText(shellQuote([fileName])),
                },
                {
                    label: "Copy Full File Name (Shell Quoted)",
                    click: () => navigator.clipboard.writeText(shellQuote([path])),
                },
                {
                    type: "separator",
                },
                {
                    label: "Download File",
                    click: async () => {
                        getApi().downloadFile(path);
                    },
                },
                {
                    type: "separator",
                },
                {
                    label: "Open Preview in New Block",
                    click: async () => {
                        const blockDef: BlockDef = {
                            meta: {
                                view: "preview",
                                file: path,
                            },
                        };
                        await createBlock(blockDef);
                    },
                },
            ];
            if (mimetype == "directory") {
                menu.push({
                    label: "Open Terminal in New Block",
                    click: async () => {
                        const termBlockDef: BlockDef = {
                            meta: {
                                controller: "shell",
                                view: "term",
                                "cmd:cwd": path,
                            },
                        };
                        await createBlock(termBlockDef);
                    },
                });
            }
            menu.push({ type: "separator" });
            menu.push({
                label: "Delete File",
                click: async () => {
                    await services.FileService.DeleteFile(conn, path).catch((e) => console.log(e));
                    setRefreshVersion((current) => current + 1);
                },
            });
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
                onContextMenu={(e) => handleFileContextMenu(e, row.getValue("path"), row.getValue("mimetype"))}
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

    const handleScrollbarInitialized = (instance) => {
        osInstanceRef.current = instance;
    };

    return (
        <div className="dir-table-body" ref={parentRef}>
            {search !== "" && (
                <div className="dir-table-body-search-display" ref={warningBoxRef}>
                    <span>Searching for "{search}"</span>
                    <div className="search-display-close-button dir-table-button" onClick={() => setSearch("")}>
                        <i className="fa-solid fa-xmark" />
                        <input type="text" value={search} onChange={() => {}} />
                    </div>
                </div>
            )}
            <OverlayScrollbarsComponent
                options={{ scrollbars: { autoHide: "leave" } }}
                events={{ initialized: handleScrollbarInitialized }}
            >
                <div className="dir-table-body-scroll-box" style={{ height: bodyHeight }}>
                    <div className="dummy dir-table-body-row" ref={dummyLineRef}>
                        <div className="dir-table-body-cell">dummy-data</div>
                    </div>
                    {table.getTopRows().map(displayRow)}
                    {table.getCenterRows().map((row, idx) => displayRow(row, idx + table.getTopRows().length))}
                </div>
            </OverlayScrollbarsComponent>
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
    const fileName = jotai.useAtomValue(model.metaFilePath);
    const showHiddenFiles = jotai.useAtomValue(model.showHiddenFiles);
    const [selectedPath, setSelectedPath] = useState("");
    const [refreshVersion, setRefreshVersion] = jotai.useAtom(model.refreshVersion);
    const conn = jotai.useAtomValue(model.connection);

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
            const file = await services.FileService.ReadFile(conn, fileName);
            const serializedContent = util.base64ToString(file?.data64);
            const content: FileInfo[] = JSON.parse(serializedContent);
            setUnfilteredData(content);
        };
        getContent();
    }, [conn, fileName, refreshVersion]);

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
            if (keyutil.checkKeyPressed(waveEvent, "Escape")) {
                setSearchText("");
                return;
            }
            if (keyutil.checkKeyPressed(waveEvent, "ArrowUp")) {
                setFocusIndex((idx) => Math.max(idx - 1, 0));
                return true;
            }
            if (keyutil.checkKeyPressed(waveEvent, "ArrowDown")) {
                setFocusIndex((idx) => Math.min(idx + 1, filteredData.length - 1));
                return true;
            }
            if (keyutil.checkKeyPressed(waveEvent, "Enter")) {
                if (filteredData.length == 0) {
                    return;
                }
                model.goHistory(selectedPath);
                setSearchText("");
                return true;
            }
            if (keyutil.checkKeyPressed(waveEvent, "Backspace")) {
                if (searchText.length == 0) {
                    return true;
                }
                setSearchText((current) => current.slice(0, -1));
                return true;
            }
            if (keyutil.isCharacterKeyEvent(waveEvent)) {
                setSearchText((current) => current + waveEvent.key);
                return true;
            }
            return false;
        };
        return () => {
            model.directoryKeyDownHandler = null;
        };
    }, [filteredData, selectedPath]);

    useEffect(() => {
        if (filteredData.length != 0 && focusIndex > filteredData.length - 1) {
            setFocusIndex(filteredData.length - 1);
        }
    }, [filteredData]);

    return (
        <div
            className="dir-table-container"
            onChangeCapture={(e) => {
                const event = e as React.ChangeEvent<HTMLInputElement>;
                setSearchText(event.target.value.toLowerCase());
            }}
            // onFocusCapture={() => document.getSelection().collapseToEnd()}
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
            />
        </div>
    );
}

export { DirectoryPreview };
