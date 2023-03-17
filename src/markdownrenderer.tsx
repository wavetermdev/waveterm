import * as React from "react";
import * as mobx from "mobx";
import * as mobxReact from "mobx-react";
import cn from "classnames";
import {If, For, When, Otherwise, Choose} from "tsx-control-statements/components";
import {WindowSize, RendererContext, TermOptsType, LineType, RendererOpts} from "./types";
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {boundInt} from "./util";
import {sprintf} from "sprintf-js";

type OV<V> = mobx.IObservableValue<V>;

function LinkRenderer(props : any) : any {
    let newUrl = "https://extern?" + encodeURIComponent(props.href);
    return <a href={newUrl} target="_blank">{props.children}</a>
}

function HeaderRenderer(props : any, hnum : number) : any {
    return (
        <div className={cn("title", "is-" + hnum)}>{props.children}</div>
    );
}

function CodeRenderer(props : any) : any {
    return (
        <code className={cn({"inline": props.inline})}>{props.children}</code>
    );
}

const MaxMarkdownSize = 50000;

@mobxReact.observer
class SimpleMarkdownRenderer extends React.Component<{data : Blob, context : RendererContext, opts : RendererOpts, savedHeight : number}, {}> {
    markdownText : OV<string> = mobx.observable.box(null, {name: "markdownText"});
    markdownError : OV<string> = mobx.observable.box(null, {name: "markdownError"});

    componentDidMount() {
        let dataBlob = this.props.data;
        if (dataBlob.size > 50000) {
            this.markdownError.set(sprintf("error: markdown too large to render size=%d", dataBlob.size));
            return;
        }
        let prtn = dataBlob.text()
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
        if (this.markdownError.get() != null) {
            return <div className="markdown-renderer"><div className="markdown-error">{this.markdownError.get()}</div></div>;
        }
        if (this.markdownText.get() == null) {
            return <div className="markdown-renderer" style={{height: this.props.savedHeight}}/>
        }
        let markdownComponents = {
            a: LinkRenderer,
            h1: (props) => HeaderRenderer(props, 1),
            h2: (props) => HeaderRenderer(props, 2),
            h3: (props) => HeaderRenderer(props, 3),
            h4: (props) => HeaderRenderer(props, 4),
            h5: (props) => HeaderRenderer(props, 5),
            h6: (props) => HeaderRenderer(props, 6),
            code: CodeRenderer,
        };
        let opts = this.props.opts;
        let markdownText = this.markdownText.get();
        let maxWidth = opts.maxSize.width;
        let minWidth = opts.maxSize.width;
        if (minWidth > 1000) {
            minWidth = 1000;
        }
        return (
            <div className="markdown-renderer">
                <div className="markdown-scroller" style={{maxHeight: opts.maxSize.height}}>
                    <div className="markdown content" style={{maxWidth: maxWidth, minWidth: minWidth}}>
                        <ReactMarkdown children={this.markdownText.get()} remarkPlugins={[remarkGfm]} components={markdownComponents}/>
                    </div>
                </div>
            </div>
        );
    }
}

export {SimpleMarkdownRenderer};
