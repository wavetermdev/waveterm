// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as util from "@/util/util";
import { GlobalModel } from "@/models";

import "./media.less";

@mobxReact.observer
class SimpleMediaRenderer extends React.PureComponent<
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
        let fileUrl = this.props.lineState["wave:fileurl"];
        if (util.isBlank(fileUrl)) {
            return (
                <div className="media-renderer" style={{ fontSize: this.props.opts.termFontSize }}>
                    <div className="load-error-text">
                        ERROR: no fileurl found (please use `mediaview` to view media files)
                    </div>
                </div>
            );
        }
        let fullVideoUrl = GlobalModel.getBaseHostPort() + fileUrl;
        const opts = this.props.opts;
        const height = opts.idealSize.height - 10;
        const width = opts.maxSize.width - 10;
        return (
            <div className="media-renderer" style={{ height: height, width: width }}>
                <video controls>
                    <source src={fullVideoUrl} />
                </video>
            </div>
        );
    }
}

export { SimpleMediaRenderer };
