import React from "react";
import { GlobalModel } from "../../model/model";
import * as T from "../../types/types";

class FileViewRenderer extends React.Component<{
    data: T.ExtBlob;
    cmdstr: string;
    cwd: string;
    readOnly: boolean;
    notFound: boolean;
    exitcode: number;
    context: T.RendererContext;
    opts: T.RendererOpts;
    savedHeight: number;
    scrollToBringIntoViewport: () => void;
    lineState: T.LineStateType;
    isSelected: boolean;
    shouldFocus: boolean;
    rendererApi: T.RendererModelContainerApi;
}> {
    constructor(props) {
        super(props);
    }

    render() {
        return (
            <div>
                <h1>Test File View Text</h1>
            </div>
        );
    }
}

export { FileViewRenderer };
