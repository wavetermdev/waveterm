import * as React from "react";
import * as mobx from "mobx";
import * as mobxReact from "mobx-react";
import cn from "classnames";
import { If, For, When, Otherwise, Choose } from "tsx-control-statements/components";
import * as T from "../types";
import { sprintf } from "sprintf-js";
import { isBlank } from "../util";
import mustache from "mustache";
import * as DOMPurify from 'dompurify';

type OV<V> = mobx.IObservableValue<V>;

const MaxMustacheSize = 200000;

@mobxReact.observer
class SimpleMustacheRenderer extends React.Component<
    { data: Blob; context: T.RendererContext; opts: T.RendererOpts; savedHeight: number, lineState: T.LineStateType },
    {}
> {
    templateLoading: OV<string> = mobx.observable.box(true, { name: "templateLoading" });
    errorMessage: OV<string> = mobx.observable.box(null, { name: "errorMessage" });
    mustacheTemplateText: OV<string> = mobx.observable.box(null, { name: "mustacheTemplateText" });
    parsedData: OV<any> = mobx.observable.box(null, {name: "parsedData"});
    
    componentDidMount() {
        let dataBlob = this.props.data;
        if (dataBlob == null || dataBlob.notFound) {
            return;
        }
        if (!isBlank(this.props.lineState.template)) {
            let context = this.props.context;
            let lineState = this.props.lineState;
            let quotedTemplateName = JSON.stringify(lineState.template);
            let rtnp = GlobalModel.readRemoteFile(context.screenId, context.lineId, lineState.template);
            rtnp.then((file) => {
                if (file.notFound) {
                    this.trySetErrorMessage(`ERROR: mustache template ${quotedTemplateName} not found`);
                    return null;
                }
                return file.text();
            }).then((text) => {
                if (isBlank(text)) {
                    this.trySetErrorMessage(`ERROR: blank mustache template ${quotedTemplateName}`);
                    return;
                }
                mobx.action(() => {
                    this.mustacheTemplateText.set(text);
                    this.templateLoading.set(false);
                })();
                return;
            }).catch((e) => {
                this.trySetErrorMessage(`ERROR loading mustache template ${quotedTemplateName}: ${e}`);
            });
        }

        // load json content
        let rtnp = dataBlob.text();
        let quotedDataName = dataBlob.name || "\"terminal output\"";
        rtnp.then((text) => {
            mobx.action(() => {
                try {
                    this.parsedData.set(JSON.parse(text));
                }
                catch(e) {
                    this.trySetErrorMessage(`ERROR parsing json data from ${quotedDataName}: ${e}`);
                }
            })();
        }).catch((e) => {
            this.trySetErrorMessage(`ERROR loading json data ${quotedDataName}: ${e}`);
        });
    }

    trySetErrorMessage(msg: string) {
        if (this.errorMessage.get() == null) {
            mobx.action(() => {
                this.errorMessage.set(msg);
            })();
        }
    }
    
    render() {
        let dataBlob = this.props.data;
        if (dataBlob == null || dataBlob.notFound) {
            return (
                <div className="renderer-container mustache-renderer" style={{ fontSize: this.props.opts.termFontSize }}>
                    <div className="load-error-text">
                        ERROR: file {dataBlob && dataBlob.name ? JSON.stringify(dataBlob.name) : ""} not found
                    </div>
                </div>
            );
        }
        let lineState = this.props.lineState;
        let errorMessage = this.errorMessage.get();
        if (errorMessage == null) {
            if (isBlank(lineState.template)) {
                errorMessage = "ERROR: no 'template' specified";
            }
        }
        if (errorMessage != null) {
            return (
                <div className="renderer-container mustache-renderer" style={{ fontSize: this.props.opts.termFontSize }}>
                    <div className="load-error-text">{errorMessage}</div>
                </div>
            );
        }
        if (this.templateLoading.get()) {
            return (
                <div className="renderer-container mustache-renderer" style={{ fontSize: this.props.opts.termFontSize }}>
                    <div className="renderer-loading">loading content <i className="fa fa-ellipsis fa-fade" /></div>
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
            renderedText = mustache.render(templateText, templateData)
            renderedText = DOMPurify.sanitize(renderedText);
        }
        catch(e) {
            return (
                <div className="renderer-container mustache-renderer" style={{ fontSize: this.props.opts.termFontSize }}>
                    <div className="load-error-text">ERROR running template: {e.message}</div>
                </div>
            );
        }
        // TODO non-term content font-size (default to 16)
        return (
            <div className="renderer-container mustache-renderer" style={{fontSize: 16}}>
                <div
                    className="scroller"
                    style={{
                        maxHeight: opts.maxSize.height,
                        minWidth: minWidth,
                        width: "min-content",
                        maxWidth: maxWidth,
                    }}
                >
                    <div className="mustache content" style={{maxHeight: opts.maxSize.height}} dangerouslySetInnerHTML={{__html: renderedText}}/>
                </div>
            </div>
        );
    }
}

export { SimpleMustacheRenderer };
