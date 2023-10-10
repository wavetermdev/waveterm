import React, { FC, useEffect, useState, useRef, useMemo } from "react";
import { RendererContext, RendererOpts, LineStateType, RendererModelContainerApi } from "../../types/types";
import { GlobalModel } from "../../model/model";
import Papa from 'papaparse';
import {
    createColumnHelper,
    flexRender,
    useReactTable,
    getCoreRowModel,
    getFilteredRowModel,
    getFacetedRowModel,
    getFacetedUniqueValues,
    getFacetedMinMaxValues,
    getPaginationRowModel,
    sortingFns,
    getSortedRowModel,
    FilterFn,
  } from '@tanstack/react-table'
  import {
    RankingInfo,
    rankItem,
  } from '@tanstack/match-sorter-utils'
import DebouncedInput from "./search";
  
import "./csv.less";

declare module '@tanstack/table-core' {
    interface FilterFns {
      fuzzy: FilterFn<unknown>
    }
    interface FilterMeta {
      itemRank: RankingInfo
    }
}

type CSVRow = {
    [key: string]: string | number;
};

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
    totalHeight: number;
}

const columnHelper = createColumnHelper<any>();

const CSVRenderer: FC<Props> = (props: Props) => {
    const csvCacheRef = useRef(new Map<string, string>());
    const rowRef = useRef<(HTMLTableRowElement | null)[]>([]);
    const headerRef = useRef<HTMLTableRowElement | null>(null);
    const [state, setState] = useState<State>({
        content: null,
        message: null,
        isPreviewerAvailable: false,
        showReadonly: true,
        totalHeight: 0,
    });
    const [globalFilter, setGlobalFilter] = React.useState('')

    const filePath = props.lineState["prompt:file"];
    const { screenId, lineId } = props.context;
    const cacheKey = `${screenId}-${lineId}-${filePath}`;

    // Parse the CSV data
    const parsedData = useMemo<CSVRow[]>(() => {
        if (!state.content) return [];
    
        const results = Papa.parse(state.content, { header: true });
    
        return results.data.map(row => {
            return Object.fromEntries(
                Object.entries(row as CSVRow).map(([key, value]) => {
                    if (typeof value === 'string') {
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

    // Effect to compute height after rendering
    useEffect(() => {
        if (headerRef.current && rowRef.current && rowRef.current[0]) {
            const headerHeight = headerRef.current.offsetHeight;
            const rowHeight = rowRef.current[0]?.offsetHeight ?? 0; // Using optional chaining
            const totalHeight = headerHeight + rowHeight * parsedData.length;

            setState((prevState) => ({ ...prevState, totalHeight }));
    
            // Do something with totalHeight here
            console.log(headerHeight, rowHeight, parsedData.length, totalHeight);
        }
    }, [parsedData]);
    

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
            globalFilter,
        },
        onGlobalFilterChange: setGlobalFilter,
        globalFilterFn: fuzzyFilter,
        getCoreRowModel: getCoreRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        getFacetedRowModel: getFacetedRowModel(),
        getFacetedUniqueValues: getFacetedUniqueValues(),
        getFacetedMinMaxValues: getFacetedMinMaxValues(),
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
        <div className="csv-renderer" style={{"height": `${state.totalHeight}px`}}>
            <div className="global-search-render">
                <DebouncedInput
                value={globalFilter ?? ''}
                onChange={value => setGlobalFilter(String(value))}
                className="global-search"
                placeholder="Search all columns..."
                />
            </div>
            <table>
                <thead>
                    {table.getHeaderGroups().map(headerGroup => (
                        <tr key={headerGroup.id} ref={headerRef}>
                            {headerGroup.headers.map(header => (
                                <th key={header.id}>
                                    {header.isPlaceholder
                                        ? null
                                        : (
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
                                        )}
                                </th>
                            ))}
                        </tr>
                    ))}
                </thead>
                <tbody>
                    {table.getRowModel().rows.map((row, index) => (
                        <tr key={row.id} ref={el => rowRef.current[index] = el}>
                            {row.getVisibleCells().map(cell => (
                                <td key={cell.id}>
                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
            {message && getMessage()}
        </div>
    );
}

export { CSVRenderer };
