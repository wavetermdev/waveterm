// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobx from "mobx";
import * as mobxReact from "mobx-react";

import "./pdf.less";

@mobxReact.observer
class SimplePdfRenderer extends React.Component<
    { data: ExtBlob; context: RendererContext; opts: RendererOpts; savedHeight: number },
    {}
> {
    objUrl: string = null;

    componentWillUnmount() {
        if (this.objUrl != null) {
            URL.revokeObjectURL(this.objUrl);
        }
    }

    render() {
        let dataBlob = this.props.data;
        if (dataBlob == null || dataBlob.notFound) {
            return (
                <div className="pdf-renderer" style={{ fontSize: this.props.opts.termFontSize }}>
                    <div className="load-error-text">
                        ERROR: file {dataBlob && dataBlob.name ? JSON.stringify(dataBlob.name) : ""} not found
                    </div>
                </div>
            );
        }
        if (this.objUrl == null) {
            let pdfBlob = new Blob([dataBlob], { type: "application/pdf" });
            this.objUrl = URL.createObjectURL(pdfBlob);
        }
        let opts = this.props.opts;
        let maxHeight = opts.maxSize.height - 10;
        let maxWidth = opts.maxSize.width - 10;
        return (
            <div className="pdf-renderer">
                <embed height={maxHeight} width={maxWidth} type="application/pdf" src={this.objUrl} />
            </div>
        );
    }
}

export { SimplePdfRenderer };
