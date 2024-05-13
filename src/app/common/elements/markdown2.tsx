// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { clsx } from "clsx";

import "./markdown.less";
import { boundMethod } from "autobind-decorator";

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

function CodeBlock(props: any): JSX.Element {
    console.log("props.children", props.children);
    return <pre>{props.children}</pre>;
}

@mobxReact.observer
class Markdown2 extends React.Component<{ text: string; style?: any; className?: string }, {}> {
    @boundMethod
    handleClick(e: React.MouseEvent<HTMLElement>) {
        let blockText = (e.target as HTMLElement).innerText;
        if (blockText) {
            blockText = blockText.replace(/\n$/, ""); // remove trailing newline
            navigator.clipboard.writeText(blockText);
        }
    }

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
            pre: CodeBlock,
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
