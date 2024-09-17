// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobx from "mobx";
import * as mobxReact from "mobx-react";
import { sprintf } from "sprintf-js";
import { Markdown } from "@/elements";

import "./markdown.less";

const MaxMarkdownSize = 200000;
const DefaultMaxMarkdownWidth = 1000;

@mobxReact.observer
class SimpleMarkdownRenderer extends React.Component<
    {
        data: ExtBlob;
        context: RendererContext;
        opts: RendererOpts;
        savedHeight: number;
        lineState: LineStateType;
    },
    {}
> {
    markdownText: OV<string> = mobx.observable.box(null, { name: "markdownText" });
    markdownError: OV<string> = mobx.observable.box(null, { name: "markdownError" });

    componentDidMount() {
        let dataBlob = this.props.data;
        if (dataBlob == null || dataBlob.notFound) {
            return;
        }
        if (dataBlob.size > MaxMarkdownSize) {
            this.markdownError.set(sprintf("error: markdown too large to render size=%d", dataBlob.size));
            return;
        }
        let prtn = dataBlob.text();
        prtn.then((text) => {
            if (/[\x00-\x08]/.test(text)) {
                this.markdownError.set(sprintf("error: not rendering markdown, binary characters detected"));
                return;
            }
            mobx.action(() => {
                this.markdownText.set(text);
            })();
        });
    }

    render() {
        let dataBlob = this.props.data;
        if (dataBlob == null || dataBlob.notFound) {
            return (
                <div className="markdown-renderer" style={{ fontSize: this.props.opts.termFontSize }}>
                    <div className="load-error-text">
                        ERROR: file {dataBlob && dataBlob.name ? JSON.stringify(dataBlob.name) : ""} not found
                    </div>
                </div>
            );
        }
        if (this.markdownError.get() != null) {
            return (
                <div className="markdown-renderer" style={{ fontSize: this.props.opts.termFontSize }}>
                    <div className="load-error-text">{this.markdownError.get()}</div>
                </div>
            );
        }
        if (this.markdownText.get() == null) {
            return <div className="markdown-renderer" style={{ height: this.props.savedHeight }} />;
        }
        let opts = this.props.opts;
        return (
            <div className="markdown-renderer">
                <div
                    className="scroller"
                    style={{
                        maxHeight: opts.maxSize.height,
                    }}
                >
                    <Markdown
                        text={this.markdownText.get()}
                        style={{ maxHeight: opts.maxSize.height, maxWidth: DefaultMaxMarkdownWidth }}
                    />
                </div>
            </div>
        );
    }
}

export { SimpleMarkdownRenderer };
