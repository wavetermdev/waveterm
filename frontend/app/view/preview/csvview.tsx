// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useTableNav } from "@table-nav/react";
import {
    createColumnHelper,
    flexRender,
    getCoreRowModel,
    getSortedRowModel,
    useReactTable,
} from "@tanstack/react-table";
import { clsx } from "clsx";
import Papa from "papaparse";
import { useEffect, useMemo, useRef, useState } from "react";

import { useDimensionsWithExistingRef } from "@/app/hook/useDimensions";
import "./csvview.scss";

const MAX_DATA_SIZE = 10 * 1024 * 1024; // 10MB in bytes

type CSVRow = {
    [key: string]: string | number;
};

interface CSVViewProps {
    parentRef: React.MutableRefObject<HTMLDivElement>;
    content: string;
    filename: string;
    readonly: boolean;
}

interface State {
    content: string | null;
    showReadonly: boolean;
    tbodyHeight: number;
}

const columnHelper = createColumnHelper<any>();

// TODO remove parentRef dependency -- use own height
const CSVView = ({ parentRef, filename, content }: CSVViewProps) => {
    const csvCacheRef = useRef(new Map<string, string>());
    const rowRef = useRef<(HTMLTableRowElement | null)[]>([]);
    const headerRef = useRef<HTMLTableRowElement | null>(null);
    const probeRef = useRef<HTMLTableRowElement | null>(null);
    const tbodyRef = useRef<HTMLTableSectionElement | null>(null);

    const [state, setState] = useState<State>({
        content,
        showReadonly: true,
        tbodyHeight: 0,
    });

    const [tableLoaded, setTableLoaded] = useState(false);

    const { listeners } = useTableNav();
    const domRect = useDimensionsWithExistingRef(parentRef, 30);
    const parentHeight = domRect?.height ?? 0;

    const cacheKey = `${filename}`;
    csvCacheRef.current.set(cacheKey, content);

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
        if (probeRef.current && headerRef.current && parsedData.length && parentRef.current) {
            const rowHeight = probeRef.current.offsetHeight;
            const fullTBodyHeight = rowHeight * parsedData.length;
            const headerHeight = headerRef.current.offsetHeight;
            const maxHeightLessHeader = parentHeight - headerHeight;
            const tbodyHeight = Math.min(maxHeightLessHeader, fullTBodyHeight) - 3; // 3 for the borders

            setState((prevState) => ({ ...prevState, tbodyHeight }));
        }
    }, [parentHeight, parsedData]);

    // Makes sure rows are rendered before setting the renderer as loaded
    useEffect(() => {
        let tid: NodeJS.Timeout;

        if (rowRef.current.length === parsedData.length) {
            tid = setTimeout(() => {
                setTableLoaded(true);
            }, 50); // Delay a bit to make sure the rows are rendered
        }

        return () => clearTimeout(tid);
    }, [rowRef, parsedData]);

    const table = useReactTable({
        manualPagination: true,
        data: parsedData,
        columns,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
    });

    return (
        <div className={clsx("csv-view", { show: tableLoaded })} style={{ height: "auto" }}>
            <table className="probe">
                <tbody>
                    <tr ref={probeRef}>
                        <td>dummy data</td>
                    </tr>
                </tbody>
            </table>
            <table {...listeners}>
                <thead>
                    {table.getHeaderGroups().map((headerGroup, index) => (
                        <tr key={headerGroup.id} ref={headerRef} id={headerGroup.id} tabIndex={index}>
                            {headerGroup.headers.map((header, index) => (
                                <th
                                    key={header.id}
                                    colSpan={header.colSpan}
                                    id={header.id}
                                    tabIndex={index}
                                    style={{ width: header.getSize() }}
                                >
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
                                                <i className="sort-icon fa-sharp fa-solid fa-sort-up"></i>
                                            ) : header.column.getIsSorted() === "desc" ? (
                                                <i className="sort-icon fa-sharp fa-solid fa-sort-down"></i>
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
                        <tr key={row.id} ref={(el) => { rowRef.current[index] = el; }} id={row.id} tabIndex={index}>
                            {row.getVisibleCells().map((cell) => (
                                <td key={cell.id} id={cell.id} tabIndex={index}>
                                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

export { CSVView };
