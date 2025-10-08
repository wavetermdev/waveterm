import React from 'react';
import ReactMarkdown, { Components } from 'react-markdown';
import { twMerge } from 'tailwind-merge';

interface MarkdownProps {
    text?: string;
    style?: React.CSSProperties;
    className?: string;
    scrollable?: boolean;
}

const markdownComponents: Partial<Components> = {
    h1: ({ children }) => <h1 className="text-3xl font-bold mb-4 mt-6 text-foreground">{children}</h1>,
    h2: ({ children }) => <h2 className="text-2xl font-bold mb-3 mt-5 text-foreground">{children}</h2>,
    h3: ({ children }) => <h3 className="text-xl font-bold mb-3 mt-4 text-foreground">{children}</h3>,
    h4: ({ children }) => <h4 className="text-lg font-bold mb-2 mt-3 text-foreground">{children}</h4>,
    h5: ({ children }) => <h5 className="text-base font-bold mb-2 mt-3 text-foreground">{children}</h5>,
    h6: ({ children }) => <h6 className="text-sm font-bold mb-2 mt-3 text-foreground">{children}</h6>,
    p: ({ children }) => <p className="mb-4 leading-relaxed text-secondary">{children}</p>,
    a: ({ href, children }) => (
        <a href={href} className="text-accent hover:text-accent-300 underline">
            {children}
        </a>
    ),
    ul: ({ children }) => <ul className="list-disc list-inside mb-4 space-y-1 text-secondary">{children}</ul>,
    ol: ({ children }) => <ol className="list-decimal list-inside mb-4 space-y-1 text-secondary">{children}</ol>,
    li: ({ children }) => <li className="ml-4">{children}</li>,
    code: ({ className, children }) => {
        const isInline = !className;
        if (isInline) {
            return (
                <code className="bg-panel text-foreground px-1 py-0.5 rounded text-sm font-mono">
                    {children}
                </code>
            );
        }
        return (
            <code className={className}>
                {children}
            </code>
        );
    },
    pre: ({ children }) => (
        <pre className="bg-panel text-foreground p-4 rounded-lg overflow-x-auto mb-4 text-sm font-mono">
            {children}
        </pre>
    ),
    blockquote: ({ children }) => (
        <blockquote className="border-l-4 border-border pl-4 italic mb-4 text-muted">
            {children}
        </blockquote>
    ),
    hr: () => <hr className="border-border my-6" />,
    table: ({ children }) => (
        <div className="overflow-x-auto mb-4">
            <table className="min-w-full border-collapse border border-border">
                {children}
            </table>
        </div>
    ),
    th: ({ children }) => (
        <th className="border border-border px-4 py-2 bg-panel font-bold text-left text-foreground">
            {children}
        </th>
    ),
    td: ({ children }) => (
        <td className="border border-border px-4 py-2 text-secondary">
            {children}
        </td>
    ),
};

export function Markdown({ text, style, className, scrollable = true }: MarkdownProps) {
    const scrollClasses = scrollable ? "overflow-auto" : "";
    const baseClasses = "prose prose-sm max-w-none";
    
    return (
        <div
            className={twMerge(baseClasses, scrollClasses, className)}
            style={style}
        >
            <ReactMarkdown components={markdownComponents}>
                {text || ''}
            </ReactMarkdown>
        </div>
    );
}