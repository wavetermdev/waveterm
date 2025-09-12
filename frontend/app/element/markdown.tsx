// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { CopyButton } from "@/app/element/copybutton";
import { createContentBlockPlugin } from "@/app/element/markdown-contentblock-plugin";
import {
    MarkdownContentBlockType,
    resolveRemoteFile,
    resolveSrcSet,
    transformBlocks,
} from "@/app/element/markdown-util";
import { boundNumber, useAtomValueSafe } from "@/util/util";
import clsx from "clsx";
import { Atom } from "jotai";
import mermaid from "mermaid";
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
import "./markdown.scss";

let mermaidInitialized = false;

const initializeMermaid = () => {
    if (!mermaidInitialized) {
        mermaid.initialize({ startOnLoad: false, theme: "dark" });
        mermaidInitialized = true;
    }
};

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

const Mermaid = ({ chart }: { chart: string }) => {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        initializeMermaid();
        if (!ref.current) {
            return;
        }

        // Normalize the chart text
        let normalizedChart = chart
            .replace(/<br\s*\/?>/gi, "\n") // Convert <br/> and <br> to newlines
            .replace(/\r\n/g, "\n") // Normalize \r\n to \n
            .replace(/\n$/, ""); // Remove final newline

        ref.current.removeAttribute("data-processed");
        ref.current.textContent = normalizedChart;
        console.log("mermaid", normalizedChart);
        mermaid.run({ nodes: [ref.current] });
    }, [chart]);

    return <div className="mermaid" ref={ref} />;
};

const Code = ({ className = "", children }: { className?: string; children: React.ReactNode }) => {
    if (/\blanguage-mermaid\b/.test(className)) {
        const text = Array.isArray(children) ? children.join("") : String(children ?? "");
        return <Mermaid chart={text} />;
    }
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

const MarkdownSource = ({
    props,
    resolveOpts,
}: {
    props: React.HTMLAttributes<HTMLSourceElement> & {
        srcSet?: string;
        media?: string;
    };
    resolveOpts: MarkdownResolveOpts;
}) => {
    const [resolvedSrcSet, setResolvedSrcSet] = useState<string>(props.srcSet);
    const [resolving, setResolving] = useState<boolean>(true);

    useEffect(() => {
        const resolvePath = async () => {
            const resolved = await resolveSrcSet(props.srcSet, resolveOpts);
            setResolvedSrcSet(resolved);
            setResolving(false);
        };

        resolvePath();
    }, [props.srcSet]);

    if (resolving) {
        return null;
    }

    return <source srcSet={resolvedSrcSet} media={props.media} />;
};

interface WaveBlockProps {
    blockkey: string;
    blockmap: Map<string, MarkdownContentBlockType>;
}

const WaveBlock: React.FC<WaveBlockProps> = (props) => {
    const { blockkey, blockmap } = props;
    const block = blockmap.get(blockkey);
    if (block == null) {
        return null;
    }
    const sizeInKB = Math.round((block.content.length / 1024) * 10) / 10;
    const displayName = block.id.replace(/^"|"$/g, "");
    return (
        <div className="waveblock">
            <div className="wave-block-content">
                <div className="wave-block-icon">
                    <i className="fas fa-file-code"></i>
                </div>
                <div className="wave-block-info">
                    <span className="wave-block-filename">{displayName}</span>
                    <span className="wave-block-size">{sizeInKB} KB</span>
                </div>
            </div>
        </div>
    );
};

const MarkdownImg = ({
    props,
    resolveOpts,
}: {
    props: React.ImgHTMLAttributes<HTMLImageElement>;
    resolveOpts: MarkdownResolveOpts;
}) => {
    const [resolvedSrc, setResolvedSrc] = useState<string>(props.src);
    const [resolvedSrcSet, setResolvedSrcSet] = useState<string>(props.srcSet);
    const [resolvedStr, setResolvedStr] = useState<string>(null);
    const [resolving, setResolving] = useState<boolean>(true);

    useEffect(() => {
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
            const [resolvedSrc, resolvedSrcSet] = await Promise.all([
                resolveRemoteFile(props.src, resolveOpts),
                resolveSrcSet(props.srcSet, resolveOpts),
            ]);

            setResolvedSrc(resolvedSrc);
            setResolvedSrcSet(resolvedSrcSet);
            setResolvedStr(null);
            setResolving(false);
        };
        resolveFn();
    }, [props.src, props.srcSet]);

    if (resolving) {
        return null;
    }
    if (resolvedStr != null) {
        return <span>{resolvedStr}</span>;
    }
    if (resolvedSrc != null) {
        return <img {...props} src={resolvedSrc} srcSet={resolvedSrcSet} />;
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
    scrollable?: boolean;
    rehype?: boolean;
    fontSizeOverride?: number;
    fixedFontSizeOverride?: number;
};

const Markdown = ({
    text,
    textAtom,
    showTocAtom,
    style,
    className,
    resolveOpts,
    fontSizeOverride,
    fixedFontSizeOverride,
    scrollable = true,
    rehype = true,
    onClickExecute,
}: MarkdownProps) => {
    const textAtomValue = useAtomValueSafe<string>(textAtom);
    const tocRef = useRef<TocItem[]>([]);
    const showToc = useAtomValueSafe(showTocAtom) ?? false;
    const contentsOsRef = useRef<OverlayScrollbarsComponentRef>(null);
    const [focusedHeading, setFocusedHeading] = useState<string>(null);

    // Ensure uniqueness of ids between MD preview instances.
    const [idPrefix] = useState<string>(crypto.randomUUID());

    text = textAtomValue ?? text;
    const transformedOutput = transformBlocks(text);
    const transformedText = transformedOutput.content;
    const contentBlocksMap = transformedOutput.blocks;

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
        p: (props: React.HTMLAttributes<HTMLParagraphElement>) => <div className="paragraph" {...props} />,
        h1: (props: React.HTMLAttributes<HTMLHeadingElement>) => <Heading props={props} hnum={1} />,
        h2: (props: React.HTMLAttributes<HTMLHeadingElement>) => <Heading props={props} hnum={2} />,
        h3: (props: React.HTMLAttributes<HTMLHeadingElement>) => <Heading props={props} hnum={3} />,
        h4: (props: React.HTMLAttributes<HTMLHeadingElement>) => <Heading props={props} hnum={4} />,
        h5: (props: React.HTMLAttributes<HTMLHeadingElement>) => <Heading props={props} hnum={5} />,
        h6: (props: React.HTMLAttributes<HTMLHeadingElement>) => <Heading props={props} hnum={6} />,
        img: (props: React.HTMLAttributes<HTMLImageElement>) => <MarkdownImg props={props} resolveOpts={resolveOpts} />,
        source: (props: React.HTMLAttributes<HTMLSourceElement>) => (
            <MarkdownSource props={props} resolveOpts={resolveOpts} />
        ),
        code: Code,
        pre: (props: React.HTMLAttributes<HTMLPreElement>) => (
            <CodeBlock children={props.children} onClickExecute={onClickExecute} />
        ),
    };
    markdownComponents["waveblock"] = (props: any) => <WaveBlock {...props} blockmap={contentBlocksMap} />;

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

    let rehypePlugins = null;
    if (rehype) {
        rehypePlugins = [
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
                            ["srcset"],
                            ["media"],
                            ["type"],
                            // Alternatively, to allow only certain class names:
                            // ['className', 'hljs-number', 'hljs-title', 'hljs-variable']
                        ],
                        waveblock: [["blockkey"]],
                    },
                    tagNames: [...(defaultSchema.tagNames || []), "span", "waveblock", "picture", "source"],
                }),
            () => rehypeSlug({ prefix: idPrefix }),
        ];
    }
    const remarkPlugins: any = [
        remarkGfm,
        [RemarkFlexibleToc, { tocRef: tocRef.current }],
        [createContentBlockPlugin, { blocks: contentBlocksMap }],
    ];

    const ScrollableMarkdown = () => {
        return (
            <OverlayScrollbarsComponent
                ref={contentsOsRef}
                className="content"
                options={{ scrollbars: { autoHide: "leave" } }}
            >
                <ReactMarkdown
                    remarkPlugins={remarkPlugins}
                    rehypePlugins={rehypePlugins}
                    components={markdownComponents}
                >
                    {transformedText}
                </ReactMarkdown>
            </OverlayScrollbarsComponent>
        );
    };

    const NonScrollableMarkdown = () => {
        return (
            <div className="content non-scrollable">
                <ReactMarkdown
                    remarkPlugins={remarkPlugins}
                    rehypePlugins={rehypePlugins}
                    components={markdownComponents}
                >
                    {transformedText}
                </ReactMarkdown>
            </div>
        );
    };

    const mergedStyle = { ...style };
    if (fontSizeOverride != null) {
        mergedStyle["--markdown-font-size"] = `${boundNumber(fontSizeOverride, 6, 64)}px`;
    }
    if (fixedFontSizeOverride != null) {
        mergedStyle["--markdown-fixed-font-size"] = `${boundNumber(fixedFontSizeOverride, 6, 64)}px`;
    }
    return (
        <div className={clsx("markdown", className)} style={mergedStyle}>
            {scrollable ? <ScrollableMarkdown /> : <NonScrollableMarkdown />}
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
