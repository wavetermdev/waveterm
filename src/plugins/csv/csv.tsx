import React, { FC, useEffect, useState, useRef, useMemo } from "react";
import { RendererContext, RendererOpts, LineStateType, RendererModelContainerApi } from "../../types/types";
import { GlobalModel } from "../../model/model";
import Split from "react-split-it";
import Papa from 'papaparse';

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

    // Parse the CSV data
    const parsedData = useMemo(() => {
        if (state.content) {
            const results = Papa.parse(state.content, { header: true });
            return results.data as any[];  // 'any' can be replaced by a type fitting your CSV structure
        }
        return [];
    }, [state.content]);

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

    if (content == null) return <div className="csv-renderer" style={{ height: props.savedHeight }} />;

    if (exitcode === 1)
        return (
            <div
                className="code-renderer"
                style={{
                    fontSize: GlobalModel.termFontSize.get(),
                    color: "white",
                }}
            >
                {content}
            </div>
        );

    // Modify the rendering to include the parsed CSV data. You'd need to adapt this further to render the parsed CSV data effectively.
    return (
        <div className="code-renderer">
            <Split>
                <>{JSON.stringify(parsedData)}</> {/* This is just a placeholder to show the parsed data. You'd probably want a more sophisticated rendering. */}
            </Split>
            {message && getMessage()}
        </div>
    );
}

export { CSVRenderer };
