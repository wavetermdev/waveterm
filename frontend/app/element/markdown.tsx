// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { CopyButton } from "@/app/element/copybutton";
import { clsx } from "clsx";
import React from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";

import "./markdown.less";

const Link = ({ href, children }: { href: string; children: React.ReactNode }) => {
    const newUrl = "https://extern?" + encodeURIComponent(href);
    return (
        <a href={newUrl} target="_blank" rel="noopener">
            {children}
        </a>
    );
};

const Header = ({ children, hnum }: { children: React.ReactNode; hnum: number }) => {
    return <div className={clsx("title", `is-${hnum}`)}>{children}</div>;
};

const Code = ({ children }: { children: React.ReactNode }) => {
    return <code>{children}</code>;
};

type CodeBlockProps = {
    children: React.ReactNode;
    onClickExecute?: (cmd: string) => void;
};

const CodeBlock = ({ children, onClickExecute }: CodeBlockProps) => {
    const getTextContent = (children: any): string => {
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
        let textToCopy = getTextContent(children);
        textToCopy = textToCopy.replace(/\n$/, ""); // remove trailing newline
        await navigator.clipboard.writeText(textToCopy);
    };

    const handleExecute = (e: React.MouseEvent) => {
        let textToCopy = getTextContent(children);
        textToCopy = textToCopy.replace(/\n$/, ""); // remove trailing newline
        if (onClickExecute) {
            onClickExecute(textToCopy);
            return;
        }
    };

    return (
        <pre className="codeblock">
            {children}
            <div className="codeblock-actions">
                <CopyButton className="copy-button" onClick={handleCopy} title="Copy" />
                {onClickExecute && <i className="fa-regular fa-square-terminal" onClick={handleExecute}></i>}
            </div>
        </pre>
    );
};

type MarkdownProps = {
    text: string;
    style?: React.CSSProperties;
    className?: string;
    onClickExecute?: (cmd: string) => void;
};

const Markdown = ({ text, style, className, onClickExecute }: MarkdownProps) => {
    const markdownComponents = {
        a: Link,
        h1: (props: any) => <Header {...props} hnum={1} />,
        h2: (props: any) => <Header {...props} hnum={2} />,
        h3: (props: any) => <Header {...props} hnum={3} />,
        h4: (props: any) => <Header {...props} hnum={4} />,
        h5: (props: any) => <Header {...props} hnum={5} />,
        h6: (props: any) => <Header {...props} hnum={6} />,
        code: Code,
        pre: (props: any) => <CodeBlock {...props} onClickExecute={onClickExecute} />,
    };

    return (
        <div className={clsx("markdown content", className)} style={style}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={markdownComponents}>
                {text}
            </ReactMarkdown>
        </div>
    );
};

export { Markdown };
