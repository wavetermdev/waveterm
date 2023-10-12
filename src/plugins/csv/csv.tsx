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
    getSortedRowModel,
    FilterFn,
  } from '@tanstack/react-table'
  import {
    rankItem,
  } from '@tanstack/match-sorter-utils'
import SortUpIcon from './img/sort-up-solid.svg';
import SortDownIcon from './img/sort-down-solid.svg';
  
import "./csv.less";

const MAX_HEIGHT = 600
const MAX_DATA_SIZE = 10 * 1024 * 1024 // 10MB in bytes

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
    const [globalFilter, setGlobalFilter] = useState('')
    const [isFileTooLarge, setIsFileTooLarge] = useState<boolean>(false);

    const filePath = props.lineState["prompt:file"];
    const { screenId, lineId } = props.context;
    const cacheKey = `${screenId}-${lineId}-${filePath}`;

    // Parse the CSV data
    const parsedData = useMemo<CSVRow[]>(() => {
        if (!state.content) return [];

        // Trim the content and then check for headers based on the first row's content.
        const trimmedContent = state.content.trim();
        const firstRow = trimmedContent.split('\n')[0];

        // This checks if the first row starts with a letter or a quote
        const hasHeaders = !!firstRow.match(/^[a-zA-Z"]/);

        const results = Papa.parse(trimmedContent, { header: hasHeaders });

        // Check for non-header CSVs
        if (!hasHeaders && Array.isArray(results.data) && Array.isArray(results.data[0])) {
            const dataArray = results.data as string[][];  // Asserting the type
            const headers = Array.from({ length: dataArray[0].length }, (_, i) => `Column ${i + 1}`);
            results.data = dataArray.map(row => {
                const newRow: CSVRow = {};
                row.forEach((value, index) => {
                    newRow[headers[index]] = value;
                });
                return newRow;
            });
        }
        
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
            console.log("props.data.size", props.data.size)
            // Check if the file size exceeds 10MB
            if (props.data.size > MAX_DATA_SIZE) { // 10MB in bytes
                setIsFileTooLarge(true);
                return;
            }
            
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
            const totalHeight = (headerHeight + rowHeight * parsedData.length) + 22; // 22 is the height of the global search bar
            const th = Math.min(totalHeight, MAX_HEIGHT);

            setState((prevState) => ({ ...prevState, totalHeight: th }));
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
        return <div className="csv-renderer" style={{ fontSize: GlobalModel.termFontSize.get(), color: "white" }}>The file size exceeds 10MB and cannot be displayed.</div>;
    }

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
            {/* <div className="global-search-render">
                <DebouncedInput
                value={globalFilter ?? ''}
                onChange={value => setGlobalFilter(String(value))}
                className="global-search"
                placeholder="Search all columns..."
                />
            </div> */}
            <table>
                <thead>
                    {table.getHeaderGroups().map(headerGroup => (
                        <tr key={headerGroup.id} ref={headerRef}>
                            {headerGroup.headers.map(header => (
                                <th 
                                    key={header.id}
                                    colSpan={header.colSpan}
                                    style={{ width: header.getSize() }}
                                >
                                    {header.isPlaceholder
                                        ? null
                                        : (
                                            <div
                                                {...{
                                                    className: header.column.getCanSort()
                                                    ? 'inner cursor-pointer select-none'
                                                    : '',
                                                    onClick: header.column.getToggleSortingHandler(),
                                                }}
                                            >
                                                {flexRender(
                                                    header.column.columnDef.header,
                                                    header.getContext()
                                                )}
                                                {
                                                    header.column.getIsSorted() === 'asc' ? <img src={SortUpIcon} className="sort-icon sort-up-icon" alt="Ascending"  /> :
                                                    header.column.getIsSorted() === 'desc' ? <img src={SortDownIcon} className="sort-icon sort-down-icon" alt="Descending"  /> : null
                                                }
                                            </div>
                                        )}
                                </th>
                            ))}
                        </tr>
                    ))}
                </thead>
                <tbody style={{"height": `${state.totalHeight}px`}}>
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
