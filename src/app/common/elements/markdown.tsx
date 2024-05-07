// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { clsx } from "clsx";
import { GlobalModel } from "@/models";
import { v4 as uuidv4 } from "uuid";

import "./markdown.less";
import { boundMethod } from "autobind-decorator";

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

function CodeRenderer(props: any): any {
    return <code>{props.children}</code>;
}

@mobxReact.observer
class CodeBlockMarkdown extends React.Component<
    { children: React.ReactNode; codeSelectSelectedIndex?: number; uuid: string },
    {}
> {
    blockIndex: number;
    blockRef: React.RefObject<HTMLPreElement>;

    constructor(props) {
        super(props);
        this.blockRef = React.createRef();
        this.blockIndex = GlobalModel.inputModel.addCodeBlockToCodeSelect(this.blockRef, this.props.uuid);
    }

    render() {
        let clickHandler: (e: React.MouseEvent<HTMLElement>, blockIndex: number) => void;
        let inputModel = GlobalModel.inputModel;
        clickHandler = (e: React.MouseEvent<HTMLElement>, blockIndex: number) => {
            const sel = window.getSelection();
            if (sel?.toString().length == 0) {
                inputModel.setCodeSelectSelectedCodeBlock(blockIndex);
            }
        };
        let selected = this.blockIndex == this.props.codeSelectSelectedIndex;
        return (
            <pre
                ref={this.blockRef}
                className={clsx({ selected: selected })}
                onClick={(event) => clickHandler(event, this.blockIndex)}
            >
                {this.props.children}
            </pre>
        );
    }
}

@mobxReact.observer
class Markdown extends React.Component<
    { text: string; style?: any; extraClassName?: string; codeSelect?: boolean },
    {}
> {
    curUuid: string;

    constructor(props) {
        super(props);
        this.curUuid = uuidv4();
    }

    @boundMethod
    CodeBlockRenderer(props: any, codeSelect: boolean, codeSelectIndex: number, curUuid: string): any {
        if (codeSelect) {
            return (
                <CodeBlockMarkdown codeSelectSelectedIndex={codeSelectIndex} uuid={curUuid}>
                    {props.children}
                </CodeBlockMarkdown>
            );
        } else {
            const clickHandler = (e: React.MouseEvent<HTMLElement>) => {
                let blockText = (e.target as HTMLElement).innerText;
                if (blockText) {
                    blockText = blockText.replace(/\n$/, ""); // remove trailing newline
                    navigator.clipboard.writeText(blockText);
                }
            };
            return <pre onClick={(event) => clickHandler(event)}>{props.children}</pre>;
        }
    }

    render() {
        let text = this.props.text;
        let codeSelect = this.props.codeSelect;
        let curCodeSelectIndex = GlobalModel.inputModel.getCodeSelectSelectedIndex();
        let markdownComponents = {
            a: LinkRenderer,
            h1: (props) => HeaderRenderer(props, 1),
            h2: (props) => HeaderRenderer(props, 2),
            h3: (props) => HeaderRenderer(props, 3),
            h4: (props) => HeaderRenderer(props, 4),
            h5: (props) => HeaderRenderer(props, 5),
            h6: (props) => HeaderRenderer(props, 6),
            code: (props) => CodeRenderer(props),
            pre: (props) => this.CodeBlockRenderer(props, codeSelect, curCodeSelectIndex, this.curUuid),
        };
        return (
            <div className={clsx("markdown content", this.props.extraClassName)} style={this.props.style}>
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {text}
                </ReactMarkdown>
            </div>
        );
    }
}

export { Markdown };
