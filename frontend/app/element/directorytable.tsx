// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import React from "react";
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable, Table } from "@tanstack/react-table";
import { FileInfo } from "@/bindings/fileservice";

import "./directorytable.less";

interface DirectoryTableProps {
    data: FileInfo[];
}

const columnHelper = createColumnHelper<FileInfo>();

const defaultColumns = [
    columnHelper.accessor("path", {
        cell: (info) => info.getValue(),
        header: () => <span>Name</span>,
    }),
    columnHelper.accessor("size", {
        cell: (info) => info.getValue(),
        header: () => <span>Size</span>,
    }),
    columnHelper.accessor("mimetype", {
        cell: (info) => info.getValue(),
        header: () => <span>Mimetype</span>,
    }),
];

function DirectoryTable<T, U>({ data }: DirectoryTableProps) {
    const [columns] = React.useState<typeof defaultColumns>(() => [...defaultColumns]);
    const table = useReactTable({
        data,
        columns,
        columnResizeMode: "onChange",
        getCoreRowModel: getCoreRowModel(),
    });

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
                                {header.isPlaceholder
                                    ? null
                                    : flexRender(header.column.columnDef.header, header.getContext())}
                                <div
                                    className="dir-table-head-resize"
                                    onMouseDown={header.getResizeHandler()}
                                    onTouchStart={header.getResizeHandler()}
                                />
                            </div>
                        ))}
                    </div>
                ))}
            </div>
            {table.getState().columnSizingInfo.isResizingColumn ? (
                <MemoizedTableBody table={table} />
            ) : (
                <TableBody table={table} />
            )}
        </div>
    );
}

function TableBody({ table }: { table: Table<FileInfo> }) {
    return (
        <div className="dir-table-body">
            {table.getRowModel().rows.map((row) => (
                <div className="dir-table-body-row" key={row.id} tabIndex={0}>
                    {row.getVisibleCells().map((cell) => (
                        <div
                            className="dir-table-body-cell"
                            key={cell.id}
                            style={{ width: `calc(var(--col-${cell.column.id}-size) * 1px)` }}
                        >
                            {cell.renderValue<any>()}
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
}

const MemoizedTableBody = React.memo(
    TableBody,
    (prev, next) => prev.table.options.data == next.table.options.data
) as typeof TableBody;

export { DirectoryTable };
