import React, { FC, useEffect, useState, useRef, useMemo } from "react";
import { RendererContext, RendererOpts, LineStateType, RendererModelContainerApi } from "../../types/types";
import { GlobalModel } from "../../model/model";
import Split from "react-split-it";
import Papa from 'papaparse';
import {
    createColumnHelper,
    flexRender,
    getCoreRowModel,
    useReactTable,
  } from '@tanstack/react-table'
  import {
    RankingInfo,
    rankItem,
    compareItems,
  } from '@tanstack/match-sorter-utils'
  

import "./csv.less";

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

        console.log("content", content);
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
        getCoreRowModel: getCoreRowModel(),
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
            <Split>
                <table>
                    <thead>
                    {table.getHeaderGroups().map(headerGroup => (
                        <tr key={headerGroup.id}>
                        {headerGroup.headers.map(header => (
                            <th key={header.id}>
                            {header.isPlaceholder
                                ? null
                                : flexRender(
                                    header.column.columnDef.header,
                                    header.getContext()
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
            </Split>
            {message && getMessage()}
        </div>
    );
}

export { CSVRenderer };
