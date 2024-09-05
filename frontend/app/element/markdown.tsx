// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { CopyButton } from "@/app/element/copybutton";
import { clsx } from "clsx";
import React, { CSSProperties, useCallback, useMemo, useRef } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";

import { Atom, useAtomValue } from "jotai";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import RemarkFlexibleToc, { TocItem } from "remark-flexible-toc";
import { useHeight } from "../hook/useHeight";
import "./markdown.less";

const Link = ({ href, children }: { href: string; children: React.ReactNode }) => {
    const newUrl = "https://extern?" + encodeURIComponent(href);
    return (
        <a href={newUrl} target="_blank" rel="noopener">
            {children}
        </a>
    );
};

const Heading = ({ children, hnum }: { children: React.ReactNode; hnum: number }) => {
    return <div className={clsx("heading", `is-${hnum}`)}>{children}</div>;
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
    textAtom: Atom<string> | Atom<Promise<string>>;
    showTocAtom: Atom<boolean>;
    style?: React.CSSProperties;
    className?: string;
    onClickExecute?: (cmd: string) => void;
};

const Markdown = ({ textAtom, showTocAtom, style, className, onClickExecute }: MarkdownProps) => {
    const text = useAtomValue(textAtom);
    const tocRef = useRef<TocItem[]>([]);
    const showToc = useAtomValue(showTocAtom);
    const contentsRef = useRef<HTMLDivElement>(null);
    const contentsHeight = useHeight(contentsRef, 200);

    const halfContentsHeight = useMemo(() => {
        return `${contentsHeight / 2}px`;
    }, [contentsHeight]);

    const onTocClick = useCallback((data: string) => {
        if (contentsRef.current) {
            const headings = contentsRef.current.getElementsByClassName("heading");
            for (const heading of headings) {
                if (heading.textContent === data) {
                    heading.scrollIntoView({ inline: "nearest", block: "end" });
                }
            }
        }
    }, []);

    const markdownComponents = {
        a: Link,
        h1: (props: any) => <Heading {...props} hnum={1} />,
        h2: (props: any) => <Heading {...props} hnum={2} />,
        h3: (props: any) => <Heading {...props} hnum={3} />,
        h4: (props: any) => <Heading {...props} hnum={4} />,
        h5: (props: any) => <Heading {...props} hnum={5} />,
        h6: (props: any) => <Heading {...props} hnum={6} />,
        code: Code,
        pre: (props: any) => <CodeBlock {...props} onClickExecute={onClickExecute} />,
    };

    const toc = useMemo(() => {
        if (showToc && tocRef.current.length > 0) {
            return tocRef.current.map((item) => {
                return (
                    <a
                        key={item.href}
                        className="toc-item"
                        style={{ "--indent-factor": item.depth } as CSSProperties}
                        onClick={() => onTocClick(item.value)}
                    >
                        {item.value}
                    </a>
                );
            });
        }
    }, [showToc, tocRef]);

    return (
        <div className={clsx("markdown", className)} style={style} ref={contentsRef}>
            <OverlayScrollbarsComponent
                className="content"
                style={{ "--half-contents-height": halfContentsHeight } as CSSProperties}
                options={{ scrollbars: { autoHide: "leave" } }}
            >
                <ReactMarkdown
                    remarkPlugins={[remarkGfm, [RemarkFlexibleToc, { tocRef: tocRef.current }]]}
                    rehypePlugins={[rehypeRaw]}
                    components={markdownComponents}
                >
                    {text}
                </ReactMarkdown>
            </OverlayScrollbarsComponent>
            {showToc && (
                <OverlayScrollbarsComponent className="toc" options={{ scrollbars: { autoHide: "leave" } }}>
                    <div className="toc-inner">
                        <h4>Table of Contents</h4>
                        {toc}
                    </div>
                </OverlayScrollbarsComponent>
            )}
        </div>
    );
};

export { Markdown };
