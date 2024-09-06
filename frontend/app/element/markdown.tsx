// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { CopyButton } from "@/app/element/copybutton";
import { WshServer } from "@/app/store/wshserver";
import { getWebServerEndpoint } from "@/util/endpoints";
import * as util from "@/util/util";
import { useAtomValueSafe } from "@/util/util";
import { clsx } from "clsx";
import { Atom } from "jotai";
import { OverlayScrollbarsComponent, OverlayScrollbarsComponentRef } from "overlayscrollbars-react";
import React, { CSSProperties, useRef } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import RemarkFlexibleToc, { TocItem } from "remark-flexible-toc";
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

const MarkdownSource = (props: any) => {
    return null;
};

const MarkdownImg = (props: any) => {
    const [resolvedSrc, setResolvedSrc] = React.useState<string>(props.src);
    const [resolvedStr, setResolvedStr] = React.useState<string>(null);
    const [resolving, setResolving] = React.useState<boolean>(true);
    const resolveOpts: MarkdownResolveOpts = props.resolveOpts;

    React.useEffect(() => {
        if (props.src.startsWith("http://") || props.src.startsWith("https://")) {
            setResolving(false);
            setResolvedSrc(props.src);
            setResolvedStr(null);
            return;
        }
        if (props.src.startsWith("data:image/")) {
            setResolving(false);
            setResolvedSrc(props.src);
            setResolvedStr(null);
            return;
        }
        if (resolveOpts == null) {
            setResolving(false);
            setResolvedSrc(null);
            setResolvedStr(`[img:${props.src}]`);
            return;
        }
        const resolveFn = async () => {
            const route = util.makeConnRoute(resolveOpts.connName);
            const fileInfo = await WshServer.RemoteFileJoinCommand([resolveOpts.baseDir, props.src], { route: route });
            const usp = new URLSearchParams();
            usp.set("path", fileInfo.path);
            if (!util.isBlank(resolveOpts.connName)) {
                usp.set("connection", resolveOpts.connName);
            }
            const streamingUrl = getWebServerEndpoint() + "/wave/stream-file?" + usp.toString();
            setResolvedSrc(streamingUrl);
            setResolvedStr(null);
            setResolving(false);
        };
        resolveFn();
    }, [props.src]);

    if (resolving) {
        return null;
    }
    if (resolvedStr != null) {
        return <span>{resolvedStr}</span>;
    }
    if (resolvedSrc != null) {
        return <img {...props} src={resolvedSrc} />;
    }
    return <span>[img]</span>;
};

type MarkdownProps = {
    text?: string;
    textAtom?: Atom<string> | Atom<Promise<string>>;
    showTocAtom?: Atom<boolean>;
    style?: React.CSSProperties;
    className?: string;
    onClickExecute?: (cmd: string) => void;
    resolveOpts?: MarkdownResolveOpts;
};

const Markdown = ({ text, textAtom, showTocAtom, style, className, resolveOpts, onClickExecute }: MarkdownProps) => {
    const textAtomValue = useAtomValueSafe(textAtom);
    const tocRef = useRef<TocItem[]>([]);
    const showToc = useAtomValueSafe(showTocAtom) ?? false;
    const contentsOsRef = useRef<OverlayScrollbarsComponentRef>(null);

    const onTocClick = (data: string) => {
        if (contentsOsRef.current && contentsOsRef.current.osInstance()) {
            const { viewport } = contentsOsRef.current.osInstance().elements();
            const headings = viewport.getElementsByClassName("heading");
            for (const heading of headings) {
                if (heading.textContent === data) {
                    const headingBoundingRect = heading.getBoundingClientRect();
                    const viewportBoundingRect = viewport.getBoundingClientRect();
                    const headingTop = headingBoundingRect.top - viewportBoundingRect.top;
                    viewport.scrollBy({ top: headingTop });
                    break;
                }
            }
        }
    };

    const markdownComponents = {
        a: Link,
        h1: (props: any) => <Heading {...props} hnum={1} />,
        h2: (props: any) => <Heading {...props} hnum={2} />,
        h3: (props: any) => <Heading {...props} hnum={3} />,
        h4: (props: any) => <Heading {...props} hnum={4} />,
        h5: (props: any) => <Heading {...props} hnum={5} />,
        h6: (props: any) => <Heading {...props} hnum={6} />,
        img: (props: any) => <MarkdownImg {...props} resolveOpts={resolveOpts} />,
        source: (props: any) => <MarkdownSource {...props} resolveOpts={resolveOpts} />,
        code: Code,
        pre: (props: any) => <CodeBlock {...props} onClickExecute={onClickExecute} />,
    };

    // const toc = useMemo(() => {
    //     if (showToc && tocRef.current.length > 0) {
    //         return
    //     }
    // }, [showToc, tocRef]);

    text = textAtomValue ?? text;

    return (
        <div className={clsx("markdown", className)} style={style}>
            <OverlayScrollbarsComponent
                ref={contentsOsRef}
                className="content"
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
                        {tocRef.current.map((item) => {
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
                        })}
                    </div>
                </OverlayScrollbarsComponent>
            )}
        </div>
    );
};

export { Markdown };
