import React, { FC, useEffect, useState, useRef, useMemo } from "react";
import { RendererContext, RendererOpts, LineStateType, RendererModelContainerApi } from "../../types/types";
import { GlobalModel } from "../../model/model";
import Papa from 'papaparse';
import {
    createColumnHelper,
    flexRender,
    getCoreRowModel,
    useReactTable,
    ColumnFiltersState,
    FilterFn,
    sortingFns,
    SortingFn,
    getFilteredRowModel,
    getSortedRowModel,
  } from '@tanstack/react-table'
  import {
    RankingInfo,
    rankItem,
    compareItems,
  } from '@tanstack/match-sorter-utils'
import Filter from "./filter";
import DebouncedInput from "./search";
import Pagination from "./pagination";
  
import "./csv.less";

declare module '@tanstack/table-core' {
    interface FilterFns {
      fuzzy: FilterFn<unknown>
    }
    interface FilterMeta {
      itemRank: RankingInfo
    }
}

const fuzzyFilter: FilterFn<any> = (row, columnId, value, addMeta) => {
    // Rank the item
    const itemRank = rankItem(row.getValue(columnId), value)
  
    // Store the itemRank info
    addMeta({
      itemRank,
    })
  
    // Return if the item should be filtered in/out
    return itemRank.passed
  }
  
  const fuzzySort: SortingFn<any> = (rowA, rowB, columnId) => {
    let dir = 0
  
    // Only sort by rank if the column has ranking information
    if (rowA.columnFiltersMeta[columnId]) {
      dir = compareItems(
        rowA.columnFiltersMeta[columnId]?.itemRank!,
        rowB.columnFiltersMeta[columnId]?.itemRank!
      )
    }
  
    // Provide an alphanumeric fallback for when the item ranks are equal
    return dir === 0 ? sortingFns.alphanumeric(rowA, rowB, columnId) : dir
}
  

interface DataColumn {
    Header: string;
    accessor: string;
}

interface Props {
    data: Blob;
    cmdstr: string;
    cwd: string;
    readOnly: boolean;
    notFound: boolean;
    exitcode: number;
    context: RendererContext;
    opts: RendererOpts;
    savedHeight: number;
    scrollToBringIntoViewport: () => void;
    lineState: LineStateType;
    isSelected: boolean;
    shouldFocus: boolean;
    rendererApi: RendererModelContainerApi;
}

interface State {
    content: string | null;
    message: { status: string; text: string } | null;
    isPreviewerAvailable: boolean;
    showReadonly: boolean;
}

const columnHelper = createColumnHelper<any>();

const CSVRenderer: FC<Props> = (props: Props) => {
    const csvCacheRef = useRef(new Map<string, string>());
    const [state, setState] = useState<State>({
        content: null,
        message: null,
        isPreviewerAvailable: false,
        showReadonly: true,
    });
    const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
        []
      )
    const [globalFilter, setGlobalFilter] = React.useState('')

    const filePath = props.lineState["prompt:file"];
    const { screenId, lineId } = props.context;
    const cacheKey = `${screenId}-${lineId}-${filePath}`;

    // Parse the CSV data
    const parsedData = useMemo(() => {
        if (state.content) {
            const results = Papa.parse(state.content, { header: true });
            return results.data as any[];  // 'any' can be replaced by a type fitting your CSV structure
        }
        return [];
    }, [state.content]);

    // Column Definitions
    const columns = useMemo(() => {
        if (parsedData.length === 0) {
            return [];
        }
        const headers = Object.keys(parsedData[0]);
        return headers.map(header =>
            columnHelper.accessor(header, {
                header: () => header,
                cell: info => info.renderValue(),
            })
        );
    }, [parsedData]);

    useEffect(() => {
        const content = csvCacheRef.current.get(cacheKey);
        if (content) {
            setState((prevState) => ({ ...prevState, content }));
        } else {
            props.data.text().then((content: string) => {
                setState((prevState) => ({ ...prevState, content }));
                csvCacheRef.current.set(cacheKey, content);
            });
        }
    }, []);

    const getMessage = () => (
        <div style={{ position: "absolute", bottom: "-3px", left: "14px" }}>
            <div
                className="message"
                style={{
                    fontSize: GlobalModel.termFontSize.get(),
                    background: `${state.message?.status === "error" ? "red" : "#4e9a06"}`,
                }}
            >
                {state.message?.text}
            </div>
        </div>
    );

    const { exitcode } = props;
    const { content, message } = state;

    const table = useReactTable({
        data: parsedData,
        columns,
        filterFns: {
            fuzzy: fuzzyFilter,
        },
          state: {
            columnFilters,
            globalFilter,
        },
        onColumnFiltersChange: setColumnFilters,
        onGlobalFilterChange: setGlobalFilter,
        globalFilterFn: fuzzyFilter,
        getCoreRowModel: getCoreRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        getSortedRowModel: getSortedRowModel(),
    });

    if (content == null) return <div className="csv-renderer" style={{ height: props.savedHeight }} />;

    if (exitcode === 1)
        return (
            <div
                className="csv-renderer"
                style={{
                    fontSize: GlobalModel.termFontSize.get(),
                    color: "white",
                }}
            >
                {content}
            </div>
        );

    return (
        <div className="csv-renderer">
            <div>
                <DebouncedInput
                value={globalFilter ?? ''}
                onChange={value => setGlobalFilter(String(value))}
                className="global-search"
                placeholder="Search all columns..."
                />
            </div>
            <div>
                <table>
                    <thead>
                    {table.getHeaderGroups().map(headerGroup => (
                        <tr key={headerGroup.id}>
                            {headerGroup.headers.map(header => (
                                <th key={header.id}>
                                    {header.isPlaceholder
                                        ? null
                                        : (
                                            <>
                                                <div
                                                    {...{
                                                        className: header.column.getCanSort()
                                                        ? 'cursor-pointer select-none'
                                                        : '',
                                                        onClick: header.column.getToggleSortingHandler(),
                                                    }}
                                                >
                                                    {flexRender(
                                                        header.column.columnDef.header,
                                                        header.getContext()
                                                    )}
                                                    {{
                                                        asc: ' 🔼',
                                                        desc: ' 🔽',
                                                    }[header.column.getIsSorted() as string] ?? null}
                                                </div>
                                                {header.column.getCanFilter() ? (
                                                    <div>
                                                        <Filter column={header.column} table={table} />
                                                    </div>
                                                ) : null}
                                            </>
                                        )}
                                </th>
                            ))}
                        </tr>
                    ))}
                    </thead>
                    <tbody>
                        {table.getRowModel().rows.map(row => (
                            <tr key={row.id}>
                            {row.getVisibleCells().map(cell => (
                                <td key={cell.id}>
                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                </td>
                            ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
                <Pagination table={table} />
            </div>
            {message && getMessage()}
        </div>
    );
}

export { CSVRenderer };
