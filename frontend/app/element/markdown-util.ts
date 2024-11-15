// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export type MarkdownContentBlockType = {
    type: string;
    id: string;
    content: string;
    opts?: Record<string, any>;
};

const idMatchRe = /^("(?:[^"\\]|\\.)*")/;

function formatInlineContentBlock(block: MarkdownContentBlockType): string {
    return `!!!${block.type}[${block.id}]!!!`;
}

function parseOptions(str: string): Record<string, any> {
    const trimmed = str.trim();
    if (!trimmed) return null;

    try {
        const parsed = JSON.parse(trimmed);
        // Ensure it's an object (not array or primitive)
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

function makeMarkdownWaveBlockKey(block: MarkdownContentBlockType): string {
    return `${block.type}[${block.id}]`;
}

export function transformBlocks(content: string): { content: string; blocks: Map<string, MarkdownContentBlockType> } {
    const lines = content.split("\n");
    const blocks = new Map();
    let currentBlock = null;
    let currentContent = [];
    let processedLines = [];

    for (const line of lines) {
        // Check for start marker
        if (line.startsWith("@@@start ")) {
            // Already in a block? Add as content
            if (currentBlock) {
                processedLines.push(line);
                continue;
            }

            // Parse the start line
            const [, type, rest] = line.slice(9).match(/^(\w+)\s+(.*)/) || [];
            if (!type || !rest) {
                // Invalid format - treat as regular content
                processedLines.push(line);
                continue;
            }

            // Get the ID (everything between first set of quotes)
            const idMatch = rest.match(idMatchRe);
            if (!idMatch) {
                processedLines.push(line);
                continue;
            }

            // Parse options if any exist after the ID
            const afterId = rest.slice(idMatch[0].length).trim();
            const opts = parseOptions(afterId);

            currentBlock = {
                type,
                id: idMatch[1],
                opts,
            };
            continue;
        }

        // Check for end marker
        if (line.startsWith("@@@end ")) {
            // If we're not in a block, treat as content
            if (!currentBlock) {
                processedLines.push(line);
                continue;
            }

            // Parse the end line
            const [, type, rest] = line.slice(7).match(/^(\w+)\s+(.*)/) || [];
            if (!type || !rest) {
                currentContent.push(line);
                continue;
            }

            // Get the ID
            const idMatch = rest.match(idMatchRe);
            if (!idMatch) {
                currentContent.push(line);
                continue;
            }

            const endId = idMatch[1];

            // If this doesn't match our current block, treat as content
            if (type !== currentBlock.type || endId !== currentBlock.id) {
                currentContent.push(line);
                continue;
            }

            // Found matching end - store block and add placeholder
            const key = makeMarkdownWaveBlockKey(currentBlock);
            blocks.set(key, {
                type: currentBlock.type,
                id: currentBlock.id,
                opts: currentBlock.opts,
                content: currentContent.join("\n"),
            });

            processedLines.push(formatInlineContentBlock(currentBlock));
            currentBlock = null;
            currentContent = [];
            continue;
        }

        // Regular line - add to current block or processed lines
        if (currentBlock) {
            currentContent.push(line);
        } else {
            processedLines.push(line);
        }
    }

    // Handle unclosed block - add what we have so far
    if (currentBlock) {
        const key = makeMarkdownWaveBlockKey(currentBlock);
        blocks.set(key, {
            type: currentBlock.type,
            id: currentBlock.id,
            opts: currentBlock.opts,
            content: currentContent.join("\n"),
        });
        processedLines.push(formatInlineContentBlock(currentBlock));
    }

    return {
        content: processedLines.join("\n"),
        blocks: blocks,
    };
}
