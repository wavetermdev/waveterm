// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobx from "mobx";
import * as mobxReact from "mobx-preact";

import "./pdf.less";

@mobxReact.observer
class SimplePdfRenderer extends React.PureComponent<
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
            const pdfBlob = new File([dataBlob], dataBlob.name ?? "file.pdf", { type: "application/pdf" });
            this.objUrl = URL.createObjectURL(pdfBlob);
        }
        const opts = this.props.opts;
        const maxHeight = opts.maxSize.height - 10;
        const maxWidth = opts.maxSize.width - 10;
        return (
            <div className="pdf-renderer">
                <iframe src={this.objUrl} width={maxWidth} height={maxHeight} name="pdfview" />
            </div>
        );
    }
}

export { SimplePdfRenderer };
