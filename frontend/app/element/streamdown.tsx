// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { CopyButton } from "@/app/element/copybutton";
import { IconButton } from "@/app/element/iconbutton";
import { cn } from "@/util/util";
import { useEffect, useRef, useState } from "react";
import { codeToHtml } from "shiki/bundle/web";
import { Streamdown } from "streamdown";

const ShikiTheme = "github-dark-high-contrast";

export function Code({ className = "", children }: { className?: string; children: React.ReactNode }) {
    const [html, setHtml] = useState<string | null>(null);
    const codeRef = useRef<HTMLElement>(null);

    useEffect(() => {
        let disposed = false;

        const raw = codeRef.current?.textContent ?? (typeof children === "string" ? children : "");

        const m = className?.match(/language-([\w+-]+)/i);
        const lang = m?.[1] || "text";

        if (!raw || lang === "text") {
            setHtml(null);
            return;
        }

        (async () => {
            try {
                const full = await codeToHtml(raw, { lang, theme: ShikiTheme });
                // strip outer <pre><code> wrapper quickly:
                const start = full.indexOf("<code");
                const open = full.indexOf(">", start);
                const end = full.lastIndexOf("</code>");
                const inner = start !== -1 && open !== -1 && end !== -1 ? full.slice(open + 1, end) : null;
                if (!disposed) setHtml(inner);
            } catch (e) {
                if (!disposed) setHtml(null);
                console.warn(`Shiki highlight failed for ${lang}`, e);
            }
        })();

        return () => {
            disposed = true;
        };
    }, [children, className]);

    if (html) {
        return (
            <code
                ref={codeRef}
                className={cn("font-mono text-[12px]", className)}
                dangerouslySetInnerHTML={{ __html: html }}
            />
        );
    }

    return (
        <code ref={codeRef} className={`${className} text-secondary font-mono rounded`}>
            {children}
        </code>
    );
}

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
        textToCopy = textToCopy.replace(/\n$/, "");
        await navigator.clipboard.writeText(textToCopy);
    };

    const handleExecute = (e: React.MouseEvent) => {
        let textToCopy = getTextContent(children);
        textToCopy = textToCopy.replace(/\n$/, "");
        if (onClickExecute) {
            onClickExecute(textToCopy);
            return;
        }
    };

    return (
        <pre className="group relative bg-panel rounded py-[0.4em] px-[0.7em] my-[0.286em] mx-[0.714em]">
            {children}
            <div className="invisible group-hover:visible flex absolute top-0 right-0 rounded backdrop-blur-[8px] m-[0.143em] p-[0.286em] items-center justify-end gap-[0.286em]">
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

function Collapsible({ title, children, defaultOpen = false }) {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <div className="my-3">
            <button
                className="flex items-center gap-2 cursor-pointer bg-transparent border-0 p-0 font-medium text-secondary hover:text-primary"
                onClick={() => setIsOpen(!isOpen)}
            >
                <span className="text-[0.65rem] text-primary transition-transform duration-200 inline-block w-3">
                    {isOpen ? "▼" : "▶"}
                </span>
                <span>{title}</span>
            </button>
            {isOpen && <div className="mt-2 ml-1 pl-3.5 border-l-2 border-border text-secondary">{children}</div>}
        </div>
    );
}

interface WaveStreamdownProps {
    text: string;
    parseIncompleteMarkdown?: boolean;
    className?: string;
    onClickExecute?: (cmd: string) => void;
}

export const WaveStreamdown = ({ text, parseIncompleteMarkdown, className, onClickExecute }: WaveStreamdownProps) => {
    return (
        <Streamdown
            parseIncompleteMarkdown={parseIncompleteMarkdown}
            className={cn("wave-streamdown text-secondary", className)}
            shikiTheme={[ShikiTheme, ShikiTheme]}
            controls={{
                code: false,
                table: false,
                mermaid: true,
            }}
            mermaidConfig={{
                theme: "dark",
                darkMode: true,
            }}
            defaultOrigin="http://localhost"
            components={{
                code: Code,
                pre: (props: React.HTMLAttributes<HTMLPreElement>) => (
                    <CodeBlock children={props.children} onClickExecute={onClickExecute} />
                ),
                p: (props: React.HTMLAttributes<HTMLParagraphElement>) => <p {...props} className="text-secondary" />,
                h1: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
                    <h1 {...props} className="text-2xl font-bold text-primary mt-6 mb-3" />
                ),
                h2: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
                    <h2 {...props} className="text-xl font-bold text-primary mt-5 mb-2" />
                ),
                h3: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
                    <h3 {...props} className="text-lg font-bold text-primary mt-4 mb-2" />
                ),
                h4: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
                    <h4 {...props} className="text-base font-semibold text-primary mt-3 mb-1" />
                ),
                h5: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
                    <h5 {...props} className="text-sm font-semibold text-primary mt-2 mb-1" />
                ),
                h6: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
                    <h6 {...props} className="text-sm text-primary mt-2 mb-1" />
                ),
                table: (props: React.HTMLAttributes<HTMLTableElement>) => (
                    <table {...props} className="w-full border-collapse my-4" />
                ),
                thead: (props: React.HTMLAttributes<HTMLTableSectionElement>) => (
                    <thead {...props} className="border-b border-border" />
                ),
                tbody: (props: React.HTMLAttributes<HTMLTableSectionElement>) => <tbody {...props} />,
                tr: (props: React.HTMLAttributes<HTMLTableRowElement>) => (
                    <tr {...props} className="border-b border-border/50 last:border-0" />
                ),
                th: (props: React.HTMLAttributes<HTMLTableCellElement>) => (
                    <th {...props} className="text-left font-semibold px-2 py-1.5 text-sm text-primary" />
                ),
                td: (props: React.HTMLAttributes<HTMLTableCellElement>) => (
                    <td {...props} className="px-2 py-1.5 text-sm text-secondary" />
                ),
                ul: (props: React.HTMLAttributes<HTMLUListElement>) => (
                    <ul
                        {...props}
                        className="list-disc list-outside pl-6 my-2 text-secondary [&_ul]:my-1 [&_ol]:my-1"
                    />
                ),
                ol: (props: React.HTMLAttributes<HTMLOListElement>) => (
                    <ol
                        {...props}
                        className="list-decimal list-outside pl-6 my-2 text-secondary [&_ul]:my-1 [&_ol]:my-1"
                    />
                ),
                li: (props: React.HTMLAttributes<HTMLLIElement>) => (
                    <li {...props} className="text-secondary leading-relaxed" />
                ),
                blockquote: (props: React.HTMLAttributes<HTMLQuoteElement>) => (
                    <blockquote {...props} className="border-l-2 border-border pl-4 my-2 text-secondary italic" />
                ),
                details: ({ children, ...props }) => {
                    const childArray = Array.isArray(children) ? children : [children];

                    // Extract summary text and content
                    const summary = childArray.find((c) => c?.props?.node?.tagName === "summary");
                    const summaryText = summary?.props?.children || "Details";
                    const content = childArray.filter((c) => c?.props?.node?.tagName !== "summary");

                    return (
                        <Collapsible title={summaryText} defaultOpen={props.open}>
                            {content}
                        </Collapsible>
                    );
                },
                summary: () => null, // Don't render summary separately
                a: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
                    <a {...props} className="text-primary underline hover:text-primary/80" />
                ),
                strong: (props: React.HTMLAttributes<HTMLElement>) => (
                    <strong {...props} className="font-semibold text-secondary" />
                ),
                em: (props: React.HTMLAttributes<HTMLElement>) => <em {...props} className="italic text-secondary" />,
            }}
        >
            {text}
        </Streamdown>
    );
};
