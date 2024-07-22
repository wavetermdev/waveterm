// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as services from "@/store/services";
import * as keyutil from "@/util/keyutil";
import * as util from "@/util/util";
import type { PreviewModel } from "@/view/preview";
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
import React from "react";
import { ContextMenuModel } from "../store/contextmenu";
import { atoms, createBlock, getApi } from "../store/global";

import "./directorypreview.less";

interface DirectoryTableProps {
    data: FileInfo[];
    search: string;
    focusIndex: number;
    setFocusIndex: (_: number) => void;
    setFileName: (_: string) => void;
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

function getSpecificUnit(bytes: number, suffix: string): string {
    if (bytes < 0) {
        return "-";
    }

    const divisors = new Map([
        ["B", 1],
        ["kB", 1e3],
        ["MB", 1e6],
        ["GB", 1e9],
        ["TB", 1e12],
        ["KiB", 0x400],
        ["MiB", 0x400 ** 2],
        ["GiB", 0x400 ** 3],
        ["TiB", 0x400 ** 4],
    ]);
    const divisor: number = divisors[suffix] ?? 1;

    return `${bytes / divisor} ${displaySuffixes[suffix]}`;
}

function getLastModifiedTime(unixMillis: number, column: Column<FileInfo, number>): string {
    let fileDatetime = dayjs(new Date(unixMillis));
    let nowDatetime = dayjs(new Date());

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
    if (input == "") {
        return "-";
    }
    const truncated = input.split(";")[0];
    return truncated.trim();
}

function DirectoryTable({
    data,
    search,
    focusIndex,
    setFocusIndex,
    setFileName,
    setSearch,
    setSelectedPath,
    setRefreshVersion,
}: DirectoryTableProps) {
    let settings = jotai.useAtomValue(atoms.settingsConfigAtom);
    const getIconFromMimeType = React.useCallback(
        (mimeType: string): string => {
            while (mimeType.length > 0) {
                let icon = settings.mimetypes[mimeType]?.icon ?? null;
                if (isIconValid(icon)) {
                    return `fa fa-solid fa-${icon} fa-fw`;
                }
                mimeType = mimeType.slice(0, -1);
            }
            return "fa fa-solid fa-file fa-fw";
        },
        [settings.mimetypes]
    );
    const getIconColor = React.useCallback(
        (mimeType: string): string => {
            let iconColor = settings.mimetypes[mimeType]?.color ?? "inherit";
            return iconColor;
        },
        [settings.mimetypes]
    );
    const columns = React.useMemo(
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
                size: 67,
                minSize: 67,
                sortingFn: "alphanumeric",
            }),
            columnHelper.accessor("path", {}),
        ],
        [settings]
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

    React.useEffect(() => {
        setSelectedPath((table.getSortedRowModel()?.flatRows[focusIndex]?.getValue("path") as string) ?? null);
    }, [table, focusIndex, data]);

    React.useEffect(() => {
        let rows = table.getRowModel()?.flatRows;
        for (const row of rows) {
            if (row.getValue("name") == "..") {
                row.pin("top");
                return;
            }
        }
    }, [data]);
    const columnSizeVars = React.useMemo(() => {
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
                    data={data}
                    table={table}
                    search={search}
                    focusIndex={focusIndex}
                    setFileName={setFileName}
                    setFocusIndex={setFocusIndex}
                    setSearch={setSearch}
                    setSelectedPath={setSelectedPath}
                    setRefreshVersion={setRefreshVersion}
                />
            ) : (
                <TableBody
                    data={data}
                    table={table}
                    search={search}
                    focusIndex={focusIndex}
                    setFileName={setFileName}
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
    data: Array<FileInfo>;
    table: Table<FileInfo>;
    search: string;
    focusIndex: number;
    setFocusIndex: (_: number) => void;
    setFileName: (_: string) => void;
    setSearch: (_: string) => void;
    setSelectedPath: (_: string) => void;
    setRefreshVersion: React.Dispatch<React.SetStateAction<number>>;
}

function TableBody({
    data,
    table,
    search,
    focusIndex,
    setFocusIndex,
    setFileName,
    setSearch,
    setSelectedPath,
    setRefreshVersion,
}: TableBodyProps) {
    const dummyLineRef = React.useRef<HTMLDivElement>(null);
    const parentRef = React.useRef<HTMLDivElement>(null);
    const warningBoxRef = React.useRef<HTMLDivElement>(null);
    const [bodyHeight, setBodyHeight] = React.useState(0);
    const [containerHeight, setContainerHeight] = React.useState(0);

    React.useEffect(() => {
        if (parentRef.current == null) {
            return;
        }
        const resizeObserver = new ResizeObserver(() => {
            setContainerHeight(parentRef.current.getBoundingClientRect().height); // 17 is height of breadcrumb
        });
        resizeObserver.observe(parentRef.current);

        return () => resizeObserver.disconnect();
    }, []);

    React.useEffect(() => {
        if (dummyLineRef.current && data && parentRef.current) {
            const rowHeight = dummyLineRef.current.offsetHeight;
            const fullTBodyHeight = rowHeight * data.length;
            const warningBoxHeight = warningBoxRef.current?.offsetHeight ?? 0;
            const maxHeight = containerHeight - 1; // i don't know why, but the -1 makes the resize work
            const maxHeightLessHeader = maxHeight - warningBoxHeight;
            const tbodyHeight = Math.min(maxHeightLessHeader, fullTBodyHeight);

            setBodyHeight(tbodyHeight);
        }
    }, [data, containerHeight]);

    const handleFileContextMenu = React.useCallback(
        (e: React.MouseEvent<HTMLDivElement>, path: string) => {
            e.preventDefault();
            e.stopPropagation();
            let menu: ContextMenuItem[] = [];
            menu.push({
                label: "Open in New Block",
                click: async () => {
                    const blockDef = {
                        view: "preview",
                        meta: { file: path },
                    };
                    await createBlock(blockDef);
                },
            });
            menu.push({
                label: "Delete File",
                click: async () => {
                    await services.FileService.DeleteFile(path).catch((e) => console.log(e)); //todo these errors need a popup
                    setRefreshVersion((current) => current + 1);
                },
            });
            menu.push({
                label: "Download File",
                click: async () => {
                    getApi().downloadFile(path);
                },
            });
            ContextMenuModel.showContextMenu(menu, e);
        },
        [setRefreshVersion]
    );

    const displayRow = React.useCallback(
        (row: Row<FileInfo>, idx: number) => (
            <div
                className={clsx("dir-table-body-row", { focused: focusIndex === idx })}
                key={row.id}
                onDoubleClick={() => {
                    const newFileName = row.getValue("path") as string;
                    setFileName(newFileName);
                    setSearch("");
                }}
                onClick={() => setFocusIndex(idx)}
                onContextMenu={(e) => handleFileContextMenu(e, row.getValue("path") as string)}
            >
                {row.getVisibleCells().map((cell) => {
                    return (
                        <div
                            className={clsx("dir-table-body-cell", "col-" + cell.column.id)}
                            key={cell.id}
                            style={{ width: `calc(var(--col-${cell.column.id}-size) * 1px)` }}
                        >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </div>
                    );
                })}
            </div>
        ),
        [setSearch, setFileName, handleFileContextMenu, setFocusIndex, focusIndex]
    );

    return (
        <div className="dir-table-body" ref={parentRef}>
            {search == "" || (
                <div className="dir-table-body-search-display" ref={warningBoxRef}>
                    <span>Searching for "{search}"</span>
                    <div className="search-display-close-button dir-table-button" onClick={() => setSearch("")}>
                        <i className="fa-solid fa-xmark" />
                        <input type="text" value={search} onChange={() => {}}></input>
                    </div>
                </div>
            )}
            <div className="dir-table-body-scroll-box" style={{ height: bodyHeight }}>
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
    fileNameAtom: jotai.WritableAtom<string, [string], void>;
    model: PreviewModel;
}

function DirectoryPreview({ fileNameAtom, model }: DirectoryPreviewProps) {
    const [searchText, setSearchText] = React.useState("");
    const [focusIndex, setFocusIndex] = React.useState(0);
    const [unfilteredData, setUnfilteredData] = React.useState<FileInfo[]>([]);
    const [filteredData, setFilteredData] = React.useState<FileInfo[]>([]);
    const [fileName, setFileName] = jotai.useAtom(fileNameAtom);
    const hideHiddenFiles = jotai.useAtomValue(model.showHiddenFiles);
    const [selectedPath, setSelectedPath] = React.useState("");
    const [refreshVersion, setRefreshVersion] = jotai.useAtom(model.refreshVersion);

    React.useEffect(() => {
        model.refreshCallback = () => {
            setRefreshVersion((refreshVersion) => refreshVersion + 1);
        };
        return () => {
            model.refreshCallback = null;
        };
    }, [setRefreshVersion]);

    React.useEffect(() => {
        const getContent = async () => {
            const file = await services.FileService.ReadFile(fileName);
            const serializedContent = util.base64ToString(file?.data64);
            let content: FileInfo[] = JSON.parse(serializedContent);
            setUnfilteredData(content);
        };
        getContent();
    }, [fileName, refreshVersion]);

    React.useEffect(() => {
        let filtered = unfilteredData.filter((fileInfo) => {
            if (hideHiddenFiles && fileInfo.name.startsWith(".") && fileInfo.name != "..") {
                return false;
            }
            return fileInfo.name.toLowerCase().includes(searchText);
        });
        setFilteredData(filtered);
    }, [unfilteredData, hideHiddenFiles, searchText]);

    const handleKeyDown = React.useCallback(
        (waveEvent: WaveKeyboardEvent): boolean => {
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
                setFileName(selectedPath);
                setSearchText("");
                return true;
            }
        },
        [filteredData, setFocusIndex, selectedPath]
    );

    React.useEffect(() => {
        if (filteredData.length != 0 && focusIndex > filteredData.length - 1) {
            setFocusIndex(filteredData.length - 1);
        }
    }, [filteredData]);

    const inputRef = React.useRef<HTMLInputElement>(null);
    React.useEffect(() => {
        model.directoryInputElem = inputRef.current;
        return () => {
            model.directoryInputElem = null;
        };
    }, []);

    return (
        <div
            className="dir-table-container"
            onChangeCapture={(e) => {
                const event = e as React.ChangeEvent<HTMLInputElement>;
                setSearchText(event.target.value.toLowerCase());
            }}
            onKeyDownCapture={(e) => keyutil.keydownWrapper(handleKeyDown)(e)}
            onFocusCapture={() => document.getSelection().collapseToEnd()}
        >
            <div className="dir-table-search-line">
                <input
                    type="text"
                    className="dir-table-search-box"
                    ref={inputRef}
                    onChange={() => {}} //for nuisance warnings
                    maxLength={400}
                    value={searchText}
                />
            </div>
            <DirectoryTable
                data={filteredData}
                search={searchText}
                focusIndex={focusIndex}
                setFileName={setFileName}
                setFocusIndex={setFocusIndex}
                setSearch={setSearchText}
                setSelectedPath={setSelectedPath}
                setRefreshVersion={setRefreshVersion}
            />
        </div>
    );
}

export { DirectoryPreview };
