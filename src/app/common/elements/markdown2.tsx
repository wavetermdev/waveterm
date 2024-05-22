// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CopyButton } from "@/elements";
import { clsx } from "clsx";
import * as mobx from "mobx";
import { If } from "tsx-control-statements/components";

import "./markdown.less";

function Link(props: any): JSX.Element {
    let newUrl = "https://extern?" + encodeURIComponent(props.href);
    return (
        <a href={newUrl} target="_blank" rel={"noopener"}>
            {props.children}
        </a>
    );
}

function Header(props: any, hnum: number): JSX.Element {
    return <div className={clsx("title", "is-" + hnum)}>{props.children}</div>;
}

function Code(props: any): JSX.Element {
    return <code>{props.children}</code>;
}

const CodeBlock = mobxReact.observer(
    (props: { children: React.ReactNode; onClickExecute?: (cmd: string) => void }): JSX.Element => {
        const copied: OV<boolean> = mobx.observable.box(false, { name: "copied" });

        const getTextContent = (children: any) => {
            if (typeof children === "string") {
                return children;
            } else if (Array.isArray(children)) {
                return children.map(getTextContent).join("");
            } else if (children.props && children.props.children) {
                return getTextContent(children.props.children);
            }
            return "";
        };

        const handleCopy = async (e: React.MouseEvent) => {
            let textToCopy = getTextContent(props.children);
            textToCopy = textToCopy.replace(/\n$/, ""); // remove trailing newline
            await navigator.clipboard.writeText(textToCopy);
            copied.set(true);
            setTimeout(() => copied.set(false), 2000); // Reset copied state after 2 seconds
        };

        const handleExecute = (e: React.MouseEvent) => {
            let textToCopy = getTextContent(props.children);
            textToCopy = textToCopy.replace(/\n$/, ""); // remove trailing newline
            if (props.onClickExecute) {
                props.onClickExecute(textToCopy);
                return;
            }
        };

        return (
            <pre className="codeblock">
                {props.children}
                <div className="codeblock-actions">
                    <CopyButton className="copy-button" onClick={handleCopy} title="Copy" />
                    <If condition={props.onClickExecute}>
                        <i className="fa-regular fa-square-terminal" onClick={handleExecute}></i>
                    </If>
                </div>
            </pre>
        );
    }
);

@mobxReact.observer
class Markdown2 extends React.Component<
    { text: string; style?: any; className?: string; onClickExecute?: (cmd: string) => void },
    {}
> {
    render() {
        let { text, className } = this.props;
        let markdownComponents = {
            a: Link,
            h1: (props) => <Header {...props} hnum={1} />,
            h2: (props) => <Header {...props} hnum={2} />,
            h3: (props) => <Header {...props} hnum={3} />,
            h4: (props) => <Header {...props} hnum={4} />,
            h5: (props) => <Header {...props} hnum={5} />,
            h6: (props) => <Header {...props} hnum={6} />,
            code: Code,
            pre: (props) => <CodeBlock {...props} onClickExecute={this.props.onClickExecute} />,
        };

        return (
            <div className={clsx("markdown content", className)} style={this.props.style}>
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {text}
                </ReactMarkdown>
            </div>
        );
    }
}

export { Markdown2 };
