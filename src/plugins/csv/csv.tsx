// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import React, { FC, useEffect, useState, useRef, useMemo } from "react";
import { RendererContext, RendererOpts, LineStateType, RendererModelContainerApi } from "../../types/types";
import { GlobalModel } from "../../model/model";
import Papa from "papaparse";
import {
    createColumnHelper,
    flexRender,
    useReactTable,
    getCoreRowModel,
    getFilteredRowModel,
    getSortedRowModel,
    FilterFn,
} from "@tanstack/react-table";
import { rankItem } from "@tanstack/match-sorter-utils";
import SortUpIcon from "./img/sort-up-solid.svg";
import SortDownIcon from "./img/sort-down-solid.svg";
import cn from "classnames";

import "./csv.less";

const MAX_DATA_SIZE = 10 * 1024 * 1024; // 10MB in bytes

type CSVRow = {
    [key: string]: string | number;
};

const fuzzyFilter: FilterFn<any> = (row, columnId, value, addMeta) => {
    // Rank the item
    const itemRank = rankItem(row.getValue(columnId), value);

    // Store the itemRank info
    addMeta({
        itemRank,
    });

    // Return if the item should be filtered in/out
    return itemRank.passed;
};

interface Props {
    data: Blob;
    readOnly: boolean;
    context: RendererContext;
    opts: RendererOpts;
    savedHeight: number;
    scrollToBringIntoViewport: () => void;
    lineState: LineStateType;
}

interface State {
    content: string | null;
    showReadonly: boolean;
    tbodyHeight: number;
}

const columnHelper = createColumnHelper<any>();

const CSVRenderer: FC<Props> = (props: Props) => {
    const { data, opts, lineState, context, savedHeight } = props;
    const { height: maxHeight } = opts.maxSize;

    const csvCacheRef = useRef(new Map<string, string>());
    const rowRef = useRef<(HTMLTableRowElement | null)[]>([]);
    const headerRef = useRef<HTMLTableRowElement | null>(null);
    const probeRef = useRef<HTMLTableRowElement | null>(null);
    const tbodyRef = useRef<HTMLTableSectionElement | null>(null);
    const [state, setState] = useState<State>({
        content: null,
        showReadonly: true,
        tbodyHeight: maxHeight,
    });
    const [globalFilter, setGlobalFilter] = useState("");
    const [isFileTooLarge, setIsFileTooLarge] = useState<boolean>(false);
    const [isRendererLoaded, setRendererLoaded] = useState(false);

    const filePath = lineState["prompt:file"];
    const { screenId, lineId } = context;
    const cacheKey = `${screenId}-${lineId}-${filePath}`;

    // Parse the CSV data
    const parsedData = useMemo<CSVRow[]>(() => {
        if (!state.content) return [];

        // Trim the content and then check for headers based on the first row's content.
        const trimmedContent = state.content.trim();
        const firstRow = trimmedContent.split("\n")[0];

        // This checks if the first row starts with a letter or a quote
        const hasHeaders = !!firstRow.match(/^[a-zA-Z"]/);

        const results = Papa.parse(trimmedContent, { header: hasHeaders });

        // Check for non-header CSVs
        if (!hasHeaders && Array.isArray(results.data) && Array.isArray(results.data[0])) {
            const dataArray = results.data as string[][]; // Asserting the type
            const headers = Array.from({ length: dataArray[0].length }, (_, i) => `Column ${i + 1}`);
            results.data = dataArray.map((row) => {
                const newRow: CSVRow = {};
                row.forEach((value, index) => {
                    newRow[headers[index]] = value;
                });
                return newRow;
            });
        }

        return results.data.map((row) => {
            return Object.fromEntries(
                Object.entries(row as CSVRow).map(([key, value]) => {
                    if (typeof value === "string") {
                        const numberValue = parseFloat(value);
                        if (!isNaN(numberValue) && String(numberValue) === value) {
                            return [key, numberValue];
                        }
                    }
                    return [key, value];
                })
            ) as CSVRow;
        });
    }, [state.content]);

    // Column Definitions
    const columns = useMemo(() => {
        if (parsedData.length === 0) {
            return [];
        }
        const headers = Object.keys(parsedData[0]);
        return headers.map((header) =>
            columnHelper.accessor(header, {
                header: () => header,
                cell: (info) => info.renderValue(),
            })
        );
    }, [parsedData]);

    useEffect(() => {
        const content = csvCacheRef.current.get(cacheKey);
        if (content) {
            setState((prevState) => ({ ...prevState, content }));
        } else {
            // Check if the file size exceeds 10MB
            if (data.size > MAX_DATA_SIZE) {
                // 10MB in bytes
                setIsFileTooLarge(true);
                return;
            }

            data.text().then((content: string) => {
                setState((prevState) => ({ ...prevState, content }));
                csvCacheRef.current.set(cacheKey, content);
            });
        }
    }, []);

    useEffect(() => {
        if (probeRef.current && headerRef.current && parsedData.length) {
            const rowHeight = probeRef.current.offsetHeight;
            const tbodyHeight = rowHeight * parsedData.length - rowHeight;
            const headerHeight = headerRef.current.offsetHeight;
            const maxHeightLessHeader = maxHeight - headerHeight;
            const tbodyHeightLessHeader = tbodyHeight - headerHeight;
            const maxTbodyHeight = Math.min(maxHeightLessHeader, tbodyHeightLessHeader);

            setState((prevState) => ({ ...prevState, tbodyHeight: maxTbodyHeight }));
        }
    }, [probeRef, headerRef, maxHeight, parsedData]);

    // Makes sure rows are rendered before setting the renderer as loaded
    useEffect(() => {
        let timer: any;

        if (rowRef.current.length === parsedData.length) {
            timer = setTimeout(() => {
                setRendererLoaded(true);
            }, 100); // Delay a bit to make sure the rows are rendered
        }

        return () => clearTimeout(timer);
    }, [rowRef, parsedData]);

    const table = useReactTable({
        manualPagination: true,
        data: parsedData,
        columns,
        filterFns: {
            fuzzy: fuzzyFilter,
        },
        state: {
            globalFilter,
        },
        globalFilterFn: fuzzyFilter,
        onGlobalFilterChange: setGlobalFilter,
        getCoreRowModel: getCoreRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        getSortedRowModel: getSortedRowModel(),
    });

    if (isFileTooLarge) {
        return (
            <div className="csv-renderer" style={{ fontSize: GlobalModel.termFontSize.get() }}>
                <div className="load-error-text">The file size exceeds 10MB and cannot be displayed.</div>
            </div>
        );
    }

    return (
        <div className={cn("csv-renderer", { loaded: isRendererLoaded })}>
            <table className="probe">
                <tbody>
                    <tr ref={probeRef}>
                        <td>dummy data</td>
                    </tr>
                </tbody>
            </table>
            <table>
                <thead>
                    {table.getHeaderGroups().map((headerGroup) => (
                        <tr key={headerGroup.id} ref={headerRef}>
                            {headerGroup.headers.map((header) => (
                                <th key={header.id} colSpan={header.colSpan} style={{ width: header.getSize() }}>
                                    {header.isPlaceholder ? null : (
                                        <div
                                            {...{
                                                className: header.column.getCanSort()
                                                    ? "inner cursor-pointer select-none"
                                                    : "",
                                                onClick: header.column.getToggleSortingHandler(),
                                            }}
                                        >
                                            {flexRender(header.column.columnDef.header, header.getContext())}
                                            {header.column.getIsSorted() === "asc" ? (
                                                <img
                                                    src={SortUpIcon}
                                                    className="sort-icon sort-up-icon"
                                                    alt="Ascending"
                                                />
                                            ) : header.column.getIsSorted() === "desc" ? (
                                                <img
                                                    src={SortDownIcon}
                                                    className="sort-icon sort-down-icon"
                                                    alt="Descending"
                                                />
                                            ) : null}
                                        </div>
                                    )}
                                </th>
                            ))}
                        </tr>
                    ))}
                </thead>
                <tbody style={{ height: `${state.tbodyHeight}px` }} ref={tbodyRef}>
                    {table.getRowModel().rows.map((row, index) => (
                        <tr key={row.id} ref={(el) => (rowRef.current[index] = el)}>
                            {row.getVisibleCells().map((cell) => (
                                <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

export { CSVRenderer };
