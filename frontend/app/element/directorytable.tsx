// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import React from "react";
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";

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

    return (
        <table className="dir-table">
            <thead className="dir-table-head">
                {table.getHeaderGroups().map((headerGroup) => (
                    <tr className="dir-table-head-row" key={headerGroup.id}>
                        {headerGroup.headers.map((header) => (
                            <th className="dir-table-head-cell" key={header.id}>
                                {header.isPlaceholder
                                    ? null
                                    : flexRender(header.column.columnDef.header, header.getContext())}
                            </th>
                        ))}
                    </tr>
                ))}
            </thead>
            <tbody className="dir-table-body">
                {table.getRowModel().rows.map((row) => (
                    <tr className="dir-table-body-row" key={row.id} tabIndex={0}>
                        {row.getVisibleCells().map((cell) => (
                            <td className="dir-table-body-cell" key={cell.id}>
                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

export { DirectoryTable };
