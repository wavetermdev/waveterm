// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { getWebServerEndpoint } from "@/util/endpoints";
import { formatRemoteUri } from "@/util/waveutil";
import parseSrcSet from "parse-srcset";

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

export const resolveRemoteFile = async (filepath: string, resolveOpts: MarkdownResolveOpts): Promise<string | null> => {
    if (!filepath || filepath.startsWith("http://") || filepath.startsWith("https://")) {
        return filepath;
    }
    try {
        const baseDirUri = formatRemoteUri(resolveOpts.baseDir, resolveOpts.connName);
        const fileInfo = await RpcApi.FileJoinCommand(TabRpcClient, [baseDirUri, filepath]);
        const remoteUri = formatRemoteUri(fileInfo.path, resolveOpts.connName);
        // console.log("markdown resolve", resolveOpts, filepath, "=>", baseDirUri, remoteUri);
        const usp = new URLSearchParams();
        usp.set("path", remoteUri);
        return getWebServerEndpoint() + "/wave/stream-file?" + usp.toString();
    } catch (err) {
        console.warn("Failed to resolve remote file:", filepath, err);
        return null;
    }
};

export const resolveSrcSet = async (srcSet: string, resolveOpts: MarkdownResolveOpts): Promise<string> => {
    if (!srcSet) return null;

    // Parse the srcset
    const candidates = parseSrcSet(srcSet);

    // Resolve each URL in the array of candidates
    const resolvedCandidates = await Promise.all(
        candidates.map(async (candidate) => {
            const resolvedUrl = await resolveRemoteFile(candidate.url, resolveOpts);
            return {
                ...candidate,
                url: resolvedUrl,
            };
        })
    );

    // Reconstruct the srcset string
    return resolvedCandidates
        .map((candidate) => {
            let part = candidate.url;
            if (candidate.w) part += ` ${candidate.w}w`;
            if (candidate.h) part += ` ${candidate.h}h`;
            if (candidate.d) part += ` ${candidate.d}x`;
            return part;
        })
        .join(", ");
};
