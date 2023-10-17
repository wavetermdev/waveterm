// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobx from "mobx";
import * as mobxReact from "mobx-react";
import { boundMethod } from "autobind-decorator";
import * as T from "../../types/types";
import { isBlank } from "../../util/util";
import mustache from "mustache";
import * as DOMPurify from "dompurify";
import { GlobalModel } from "../../model/model";

import "./mustache.less";

type OV<V> = mobx.IObservableValue<V>;

@mobxReact.observer
class SimpleMustacheRenderer extends React.Component<
    { data: Blob; context: T.RendererContext; opts: T.RendererOpts; savedHeight: number; lineState: T.LineStateType },
    {}
> {
    templateLoading: OV<boolean> = mobx.observable.box(true, { name: "templateLoading" });
    templateLoadError: OV<string> = mobx.observable.box(null, { name: "templateLoadError" });
    dataLoading: OV<boolean> = mobx.observable.box(true, { name: "dataLoading" });
    dataLoadError: OV<string> = mobx.observable.box(null, { name: "dataLoadError" });
    mustacheTemplateText: OV<string> = mobx.observable.box(null, { name: "mustacheTemplateText" });
    parsedData: OV<any> = mobx.observable.box(null, { name: "parsedData" });

    componentDidMount() {
        this.reloadTemplate();
        this.reloadData();
    }

    reloadTemplate() {
        if (isBlank(this.props.lineState.template)) {
            mobx.action(() => {
                this.templateLoading.set(false);
                this.templateLoadError.set(`no 'template' specified`);
            })();
            return;
        }
        mobx.action(() => {
            this.templateLoading.set(true);
            this.templateLoadError.set(null);
        })();
        let context = this.props.context;
        let lineState = this.props.lineState;
        let quotedTemplateName = JSON.stringify(lineState.template);
        let rtnp = GlobalModel.readRemoteFile(context.screenId, context.lineId, lineState.template);
        rtnp.then((file) => {
            if (file.notFound) {
                this.trySetTemplateLoadError(`mustache template ${quotedTemplateName} not found`);
                return null;
            }
            return file.text();
        })
            .then((text) => {
                if (isBlank(text)) {
                    this.trySetTemplateLoadError(`blank mustache template ${quotedTemplateName}`);
                    return;
                }
                mobx.action(() => {
                    this.mustacheTemplateText.set(text);
                    this.templateLoading.set(false);
                })();
                return;
            })
            .catch((e) => {
                this.trySetTemplateLoadError(`loading mustache template ${quotedTemplateName}: ${e}`);
            });
    }

    reloadData() {
        // load json content
        let dataBlob = this.props.data;
        if (dataBlob == null || dataBlob.notFound) {
            mobx.action(() => {
                this.dataLoading.set(false);
                this.dataLoadError.set(
                    `file {dataBlob && dataBlob.name ? JSON.stringify(dataBlob.name) : ""} not found`
                );
            })();
            return;
        }
        mobx.action(() => {
            this.dataLoading.set(true);
            this.dataLoadError.set(null);
        })();
        let rtnp = dataBlob.text();
        let quotedDataName = dataBlob.name || '"terminal output"';
        rtnp.then((text) => {
            mobx.action(() => {
                try {
                    this.parsedData.set(JSON.parse(text));
                    this.dataLoading.set(false);
                } catch (e) {
                    this.trySetDataLoadError(`parsing json data from ${quotedDataName}: ${e}`);
                }
            })();
        }).catch((e) => {
            this.trySetDataLoadError(`loading json data ${quotedDataName}: ${e}`);
        });
    }

    trySetTemplateLoadError(msg: string) {
        if (this.templateLoadError.get() != null) {
            return;
        }
        mobx.action(() => {
            this.templateLoadError.set(msg);
        })();
    }

    trySetDataLoadError(msg: string) {
        if (this.dataLoadError.get() != null) {
            return;
        }
        mobx.action(() => {
            this.dataLoadError.set(msg);
        })();
    }

    @boundMethod
    doRefresh() {
        this.reloadTemplate();
    }

    renderCmdHints() {
        return (
            <div style={{ position: "absolute", bottom: "-3px", right: 0 }}>
                <div className="cmd-hints" style={{ minWidth: "6rem", maxWidth: "6rem", marginLeft: "-18px" }}>
                    <div
                        onClick={this.doRefresh}
                        className={`hint-item refresh-button`}
                        title="reload template and re-render content"
                    >
                        refresh
                    </div>
                </div>
            </div>
        );
    }

    render() {
        let errorMessage = this.dataLoadError.get() ?? this.templateLoadError.get();
        if (errorMessage != null) {
            return (
                <div className="mustache-renderer" style={{ fontSize: this.props.opts.termFontSize }}>
                    <div className="load-error-text">ERROR: {errorMessage}</div>
                    {this.renderCmdHints()}
                </div>
            );
        }
        if (this.templateLoading.get() || this.dataLoading.get()) {
            return (
                <div
                    className="mustache-renderer"
                    style={{ fontSize: this.props.opts.termFontSize, height: this.props.savedHeight }}
                >
                    <div className="renderer-loading">
                        loading content <i className="fa fa-ellipsis fa-fade" />
                    </div>
                    {this.renderCmdHints()}
                </div>
            );
        }
        let opts = this.props.opts;
        let maxWidth = opts.maxSize.width;
        let minWidth = opts.maxSize.width;
        if (minWidth > 1000) {
            minWidth = 1000;
        }
        let templateText = this.mustacheTemplateText.get();
        let templateData = this.parsedData.get() || {};
        let renderedText = null;
        try {
            renderedText = mustache.render(templateText, templateData);
            renderedText = DOMPurify.sanitize(renderedText);
        } catch (e) {
            return (
                <div className="mustache-renderer" style={{ fontSize: this.props.opts.termFontSize }}>
                    <div className="load-error-text">ERROR running template: {e.message}</div>
                    {this.renderCmdHints()}
                </div>
            );
        }
        // TODO non-term content font-size (default to 16)
        return (
            <div className="mustache-renderer" style={{ fontSize: 16 }}>
                <div
                    className="scroller"
                    style={{
                        maxHeight: opts.maxSize.height,
                        minWidth: minWidth,
                        width: "min-content",
                        maxWidth: maxWidth,
                    }}
                >
                    <div
                        className="mustache content"
                        style={{ maxHeight: opts.maxSize.height }}
                        dangerouslySetInnerHTML={{ __html: renderedText }}
                    />
                </div>
                {this.renderCmdHints()}
            </div>
        );
    }
}

export { SimpleMustacheRenderer };
