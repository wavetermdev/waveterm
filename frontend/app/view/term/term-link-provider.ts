// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { createBlock, globalStore, WOS } from "@/store/global";
import { PLATFORM, PlatformMacOS } from "@/util/platformutil";
import { fireAndForget } from "@/util/util";
import type { IBufferRange, ILink, ILinkProvider, Terminal } from "@xterm/xterm";

// Matches file paths with optional line/col numbers:
//   /absolute/path/file.ts
//   ~/home/relative/file.ts
//   ./relative/file.ts
//   relative/file.ts (must contain / and end with known extension)
//   file.ts:10  file.ts:10:5  (file.ts:42)
//   at /path/file.js:10:5 (stack traces)
const FILE_PATH_REGEX =
    /(?:^|[\s('"`:])((\/[\w.+\-@/]*[\w.+\-@])|(~\/[\w.+\-@/]*[\w.+\-@])|(\.\/?[\w.+\-@/]*[\w.+\-@])|([\w.+\-@]+(?:\/[\w.+\-@]+)+))(?::(\d+)(?::(\d+))?)?/g;

// File extensions we recognize for bare relative paths (the ones without ./ prefix)
const KNOWN_EXTENSIONS =
    /\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|c|cpp|h|hpp|css|scss|less|html|json|yaml|yml|toml|md|txt|sh|bash|zsh|fish|lua|zig|swift|kt|scala|ex|exs|erl|hrl|vue|svelte|astro|sql|graphql|gql|proto|Makefile|Dockerfile|conf|cfg|ini|env|xml|csv|log)$/;

function getLineText(terminal: Terminal, lineNumber: number): string {
    const buffer = terminal.buffer.active;
    const line = buffer.getLine(lineNumber - 1);
    if (!line) {
        return "";
    }
    return line.translateToString(true);
}

function resolvePath(rawPath: string, cwd: string | undefined): string {
    if (rawPath.startsWith("/")) {
        return rawPath;
    }
    if (rawPath.startsWith("~/")) {
        // Can't fully resolve ~ without knowing home dir, but pass through
        // The preview block should handle ~ expansion
        return rawPath;
    }
    if (cwd) {
        const base = cwd.endsWith("/") ? cwd : cwd + "/";
        if (rawPath.startsWith("./")) {
            return base + rawPath.slice(2);
        }
        return base + rawPath;
    }
    return rawPath;
}

function getCwd(blockId: string): string | undefined {
    const blockAtom = WOS.getWaveObjectAtom<Block>(`block:${blockId}`);
    const blockData = globalStore.get(blockAtom);
    return blockData?.meta?.["cmd:cwd"];
}

function getConnection(blockId: string): string | undefined {
    const blockAtom = WOS.getWaveObjectAtom<Block>(`block:${blockId}`);
    const blockData = globalStore.get(blockAtom);
    return blockData?.meta?.connection;
}

function openFileInPreview(filePath: string, blockId: string): void {
    const connection = getConnection(blockId);
    const meta: Record<string, any> = {
        view: "preview",
        file: filePath,
    };
    if (connection) {
        meta.connection = connection;
    }
    const blockDef: BlockDef = { meta };
    fireAndForget(() => createBlock(blockDef));
}

export class FilePathLinkProvider implements ILinkProvider {
    private blockId: string;
    private terminal: Terminal;

    constructor(terminal: Terminal, blockId: string) {
        this.terminal = terminal;
        this.blockId = blockId;
    }

    provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void): void {
        const lineText = getLineText(this.terminal, bufferLineNumber);
        if (!lineText) {
            callback(undefined);
            return;
        }

        const links: ILink[] = [];
        let match: RegExpExecArray | null;
        FILE_PATH_REGEX.lastIndex = 0;

        while ((match = FILE_PATH_REGEX.exec(lineText)) !== null) {
            const fullMatch = match[0];
            const pathPart = match[1];

            // For bare relative paths (group 5), require a known file extension
            if (match[5] && !KNOWN_EXTENSIONS.test(match[5])) {
                continue;
            }

            // Calculate the start position (1-based column)
            // The fullMatch may have a leading separator char that's not part of the path
            const matchStart = match.index;
            const pathStartInMatch = fullMatch.indexOf(pathPart);
            const startX = matchStart + pathStartInMatch + 1; // 1-based

            // Include the line:col suffix in the link text for display
            const lineNum = match[6];
            const colNum = match[7];
            let linkText = pathPart;
            if (lineNum) {
                linkText += ":" + lineNum;
                if (colNum) {
                    linkText += ":" + colNum;
                }
            }
            const endX = startX + linkText.length - 1; // 1-based, inclusive

            const range: IBufferRange = {
                start: { x: startX, y: bufferLineNumber },
                end: { x: endX, y: bufferLineNumber },
            };

            const blockId = this.blockId;

            links.push({
                range,
                text: linkText,
                decorations: { pointerCursor: true, underline: true },
                activate: (event: MouseEvent, text: string) => {
                    // Require Cmd (Mac) or Ctrl (other) to activate
                    const isModifierHeld =
                        PLATFORM === PlatformMacOS ? event.metaKey : event.ctrlKey;
                    if (!isModifierHeld) {
                        return;
                    }
                    // Strip line:col suffix for the file path
                    const colonIdx = text.indexOf(":");
                    const filePath = colonIdx > 0 ? text.substring(0, colonIdx) : text;
                    const cwd = getCwd(blockId);
                    const resolved = resolvePath(filePath, cwd);
                    openFileInPreview(resolved, blockId);
                },
            });
        }

        callback(links.length > 0 ? links : undefined);
    }
}
