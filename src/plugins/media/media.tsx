// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobx from "mobx";
import * as mobxReact from "mobx-react";
import { GlobalModel } from "@/models";

import "./media.less";

@mobxReact.observer
class SimpleMediaRenderer extends React.Component<
    { data: ExtBlob; context: RendererContext; opts: RendererOpts; savedHeight: number; lineState: LineStateType },
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
                <div className="media-renderer" style={{ fontSize: this.props.opts.termFontSize }}>
                    <div className="load-error-text">
                        ERROR: file {dataBlob && dataBlob.name ? JSON.stringify(dataBlob.name) : ""} not found
                    </div>
                </div>
            );
        }
        let videoUrl = GlobalModel.getBaseHostPort() + this.props.lineState["wave:fileurl"];
        const opts = this.props.opts;
        const maxHeight = opts.maxSize.height - 10;
        const maxWidth = opts.maxSize.width - 10;
        return (
            <div className="media-renderer">
                <video width="320" height="240" controls>
                    <source src={videoUrl} />
                </video>
            </div>
        );
    }
}

export { SimpleMediaRenderer };
