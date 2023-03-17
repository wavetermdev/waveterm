import * as React from "react";
import * as mobx from "mobx";
import * as mobxReact from "mobx-react";
import cn from "classnames";
import {If, For, When, Otherwise, Choose} from "tsx-control-statements/components";
import {WindowSize, RendererContext, TermOptsType, LineType, RendererOpts} from "./types";
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

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

@mobxReact.observer
class SimpleMarkdownRenderer extends React.Component<{data : Blob, context : RendererContext, opts : RendererOpts}, {}> {
    markdownText : OV<string> = mobx.observable.box(null, {name: "markdownText"});

    componentDidMount() {
        let prtn = this.props.data.text()
        prtn.then((text) => {
            mobx.action(() => {
                this.markdownText.set(text);
            })();
        });
    }
    render() {
        if (this.markdownText.get() == null) {
            return null;
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
        let markdownText = this.markdownText.get();
        return (
            <div className="markdown-renderer markdown content">
                <ReactMarkdown children={this.markdownText.get()} remarkPlugins={[remarkGfm]} components={markdownComponents}/>
            </div>
        );
    }
}

export {SimpleMarkdownRenderer};
