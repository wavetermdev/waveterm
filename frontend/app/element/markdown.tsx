// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { clsx } from "clsx";

import "./markdown.less";

function LinkRenderer(props: any): any {
    let newUrl = "https://extern?" + encodeURIComponent(props.href);
    return (
        <a href={newUrl} target="_blank" rel={"noopener"}>
            {props.children}
        </a>
    );
}

function HeaderRenderer(props: any, hnum: number): any {
    return <div className={clsx("title", "is-" + hnum)}>{props.children}</div>;
}

function Markdown(props: { text: string; style?: any; extraClassName?: string; codeSelect?: boolean }) {
    let text = props.text;
    let markdownComponents = {
        a: LinkRenderer,
        h1: (props) => HeaderRenderer(props, 1),
        h2: (props) => HeaderRenderer(props, 2),
        h3: (props) => HeaderRenderer(props, 3),
        h4: (props) => HeaderRenderer(props, 4),
        h5: (props) => HeaderRenderer(props, 5),
        h6: (props) => HeaderRenderer(props, 6),
    };
    return (
        <div className={clsx("markdown", props.extraClassName)} style={props.style}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {text}
            </ReactMarkdown>
        </div>
    );
}

export { Markdown };
