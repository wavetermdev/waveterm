// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Paragraph, Root, Text } from "mdast";
import { visit } from "unist-util-visit";
import { type MarkdownContentBlockType } from "./markdown-util";

interface ContentBlockPluginOptions {
    blocks: Map<string, MarkdownContentBlockType>;
}

export function createContentBlockPlugin(opts: ContentBlockPluginOptions) {
    const { blocks } = opts;

    return function transformer(tree: Root) {
        visit(tree, "paragraph", (node: Paragraph) => {
            if (!node.children?.length) return;

            const newChildren = [];
            for (const child of node.children) {
                if (child.type !== "text") {
                    newChildren.push(child);
                    continue;
                }

                const text = (child as Text).value;
                let lastIndex = 0;
                const parts = [];

                // Find all inline blocks
                const regex = /!!!(\w+\[.*?\])!!!/g;
                let match;

                while ((match = regex.exec(text)) !== null) {
                    // Add text before the match
                    if (match.index > lastIndex) {
                        parts.push({
                            type: "text",
                            value: text.slice(lastIndex, match.index),
                        });
                    }

                    const key = match[1];
                    const block = blocks.get(key);

                    if (block) {
                        parts.push({
                            type: "waveblock",
                            data: {
                                hName: "waveblock",
                                hProperties: {
                                    blockkey: key,
                                },
                            },
                            block: block,
                        });
                    } else {
                        parts.push({
                            type: "text",
                            value: match[0],
                        });
                    }

                    lastIndex = match.index + match[0].length;
                }

                // Add remaining text
                if (lastIndex < text.length) {
                    parts.push({
                        type: "text",
                        value: text.slice(lastIndex),
                    });
                }

                newChildren.push(...parts);
            }

            node.children = newChildren;
        });
    };
}
