// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { CopyButton } from "@/app/element/copybutton";
import { WshServer } from "@/app/store/wshserver";
import { getWebServerEndpoint } from "@/util/endpoints";
import { isBlank, makeConnRoute, useAtomValueSafe } from "@/util/util";
import { clsx } from "clsx";
import { Atom } from "jotai";
import { OverlayScrollbarsComponent, OverlayScrollbarsComponentRef } from "overlayscrollbars-react";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import RemarkFlexibleToc, { TocItem } from "remark-flexible-toc";
import remarkGfm from "remark-gfm";
import { openLink } from "../store/global";
import { IconButton } from "./iconbutton";
import "./markdown.less";

const Link = ({
    setFocusedHeading,
    props,
}: {
    props: React.AnchorHTMLAttributes<HTMLAnchorElement>;
    setFocusedHeading: (href: string) => void;
}) => {
    const onClick = (e: React.MouseEvent) => {
        e.preventDefault();
        if (props.href.startsWith("#")) {
            setFocusedHeading(props.href);
        } else {
            openLink(props.href);
        }
    };
    return (
        <a href={props.href} onClick={onClick}>
            {props.children}
        </a>
    );
};

const Heading = ({ props, hnum }: { props: React.HTMLAttributes<HTMLHeadingElement>; hnum: number }) => {
    return (
        <div id={props.id} className={clsx("heading", `is-${hnum}`)}>
            {props.children}
        </div>
    );
};

const Code = ({ className, children }: { className: string; children: React.ReactNode }) => {
    return <code className={className}>{children}</code>;
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
                <CopyButton onClick={handleCopy} title="Copy" />
                {onClickExecute && (
                    <IconButton
                        decl={{
                            elemtype: "iconbutton",
                            icon: "regular@square-terminal",
                            click: handleExecute,
                        }}
                    />
                )}
            </div>
        </pre>
    );
};

const MarkdownSource = (props: React.HTMLAttributes<HTMLSourceElement>) => {
    return null;
};

const MarkdownImg = ({
    props,
    resolveOpts,
}: {
    props: React.ImgHTMLAttributes<HTMLImageElement>;
    resolveOpts: MarkdownResolveOpts;
}) => {
    const [resolvedSrc, setResolvedSrc] = useState<string>(props.src);
    const [resolvedStr, setResolvedStr] = useState<string>(null);
    const [resolving, setResolving] = useState<boolean>(true);

    useEffect(() => {
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
            const route = makeConnRoute(resolveOpts.connName);
            const fileInfo = await WshServer.RemoteFileJoinCommand([resolveOpts.baseDir, props.src], { route: route });
            const usp = new URLSearchParams();
            usp.set("path", fileInfo.path);
            if (!isBlank(resolveOpts.connName)) {
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
    const textAtomValue = useAtomValueSafe<string>(textAtom);
    const tocRef = useRef<TocItem[]>([]);
    const showToc = useAtomValueSafe(showTocAtom) ?? false;
    const contentsOsRef = useRef<OverlayScrollbarsComponentRef>(null);
    const [focusedHeading, setFocusedHeading] = useState<string>(null);

    // Ensure uniqueness of ids between MD preview instances.
    const [idPrefix] = useState<string>(crypto.randomUUID());

    useEffect(() => {
        if (focusedHeading && contentsOsRef.current && contentsOsRef.current.osInstance()) {
            const { viewport } = contentsOsRef.current.osInstance().elements();
            const heading = document.getElementById(idPrefix + focusedHeading.slice(1));
            if (heading) {
                const headingBoundingRect = heading.getBoundingClientRect();
                const viewportBoundingRect = viewport.getBoundingClientRect();
                const headingTop = headingBoundingRect.top - viewportBoundingRect.top;
                viewport.scrollBy({ top: headingTop });
            }
        }
    }, [focusedHeading]);

    const markdownComponents: Partial<Components> = {
        a: (props: React.HTMLAttributes<HTMLAnchorElement>) => (
            <Link props={props} setFocusedHeading={setFocusedHeading} />
        ),
        h1: (props: React.HTMLAttributes<HTMLHeadingElement>) => <Heading props={props} hnum={1} />,
        h2: (props: React.HTMLAttributes<HTMLHeadingElement>) => <Heading props={props} hnum={2} />,
        h3: (props: React.HTMLAttributes<HTMLHeadingElement>) => <Heading props={props} hnum={3} />,
        h4: (props: React.HTMLAttributes<HTMLHeadingElement>) => <Heading props={props} hnum={4} />,
        h5: (props: React.HTMLAttributes<HTMLHeadingElement>) => <Heading props={props} hnum={5} />,
        h6: (props: React.HTMLAttributes<HTMLHeadingElement>) => <Heading props={props} hnum={6} />,
        img: (props: React.HTMLAttributes<HTMLImageElement>) => <MarkdownImg props={props} resolveOpts={resolveOpts} />,
        source: (props: React.HTMLAttributes<HTMLSourceElement>) => <MarkdownSource {...props} />,
        code: Code,
        pre: (props: React.HTMLAttributes<HTMLPreElement>) => (
            <CodeBlock children={props.children} onClickExecute={onClickExecute} />
        ),
    };

    const toc = useMemo(() => {
        if (showToc && tocRef.current.length > 0) {
            return tocRef.current.map((item) => {
                return (
                    <a
                        key={item.href}
                        className="toc-item"
                        style={{ "--indent-factor": item.depth } as React.CSSProperties}
                        onClick={() => setFocusedHeading(item.href)}
                    >
                        {item.value}
                    </a>
                );
            });
        }
    }, [showToc, tocRef]);

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
                    rehypePlugins={[
                        rehypeRaw,
                        rehypeHighlight,
                        () =>
                            rehypeSanitize({
                                ...defaultSchema,
                                attributes: {
                                    ...defaultSchema.attributes,
                                    span: [
                                        ...(defaultSchema.attributes?.span || []),
                                        // Allow all class names starting with `hljs-`.
                                        ["className", /^hljs-./],
                                        // Alternatively, to allow only certain class names:
                                        // ['className', 'hljs-number', 'hljs-title', 'hljs-variable']
                                    ],
                                },
                                tagNames: [...(defaultSchema.tagNames || []), "span"],
                            }),
                        () => rehypeSlug({ prefix: idPrefix }),
                    ]}
                    components={markdownComponents}
                >
                    {text}
                </ReactMarkdown>
            </OverlayScrollbarsComponent>
            {toc && (
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
