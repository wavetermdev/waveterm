// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Auto-title generation utilities for pane labels
 * Generates contextual titles based on block type and content
 */

import { isBlank } from "@/util/util";

/**
 * Generate an automatic title for a block based on its metadata and type
 */
export function generateAutoTitle(block: Block): string {
    if (!block || !block.meta) {
        return "Untitled";
    }

    const view = block.meta.view;

    switch (view) {
        case "term":
            return generateTerminalTitle(block);
        case "preview":
            return generatePreviewTitle(block);
        case "codeeditor":
            return generateEditorTitle(block);
        case "chat":
            return generateChatTitle(block);
        case "help":
            return "Help";
        case "tips":
            return "Tips";
        case "sysinfo":
            return "System Info";
        case "tsunami":
            return "Tsunami";
        default:
            return generateDefaultTitle(block, view);
    }
}

/**
 * Generate title for terminal blocks
 * Uses current working directory or last command
 */
function generateTerminalTitle(block: Block): string {
    const meta = block.meta!;
    const cwd = meta["term:cwd"] as string | undefined;
    const lastCmd = meta["term:lastcmd"] as string | undefined;

    if (!isBlank(lastCmd)) {
        const cmdTruncated = truncate(lastCmd!, 30);
        if (!isBlank(cwd)) {
            return `${basename(cwd!)}: ${cmdTruncated}`;
        }
        return cmdTruncated;
    }

    if (!isBlank(cwd)) {
        return basename(cwd!) || "~";
    }

    return "Terminal";
}

/**
 * Generate title for preview blocks
 * Uses filename from meta
 */
function generatePreviewTitle(block: Block): string {
    const file = block.meta!.file;

    if (!isBlank(file)) {
        return basename(file!);
    }

    const url = block.meta!.url;
    if (!isBlank(url)) {
        try {
            const urlObj = new URL(url!);
            return urlObj.hostname || "Preview";
        } catch {
            return "Preview";
        }
    }

    return "Preview";
}

/**
 * Generate title for code editor blocks
 * Uses filename with parent directory context
 */
function generateEditorTitle(block: Block): string {
    const file = block.meta!.file;

    if (isBlank(file)) {
        return "Editor";
    }

    const parts = file!.split("/");

    // Show parent directory for context if available
    if (parts.length > 2) {
        const parent = parts[parts.length - 2];
        const filename = parts[parts.length - 1];
        return `${parent}/${filename}`;
    } else if (parts.length === 2) {
        return `${parts[0]}/${parts[1]}`;
    }

    return parts[0] || "Editor";
}

/**
 * Generate title for chat blocks
 * Uses channel name if available
 */
function generateChatTitle(block: Block): string {
    const channel = block.meta!["chat:channel"] as string | undefined;

    if (!isBlank(channel)) {
        return `Chat: ${channel}`;
    }

    return "Chat";
}

/**
 * Generate default title for unknown block types
 * Uses view name and block ID suffix
 */
function generateDefaultTitle(block: Block, view?: string): string {
    if (!isBlank(view)) {
        const viewCapitalized = view!.charAt(0).toUpperCase() + view!.slice(1);
        const blockIdShort = block.oid?.slice(0, 8) || "unknown";
        return `${viewCapitalized} (${blockIdShort})`;
    }

    const blockIdShort = block.oid?.slice(0, 8) || "unknown";
    return `Block (${blockIdShort})`;
}

/**
 * Get the basename of a path (last component)
 */
function basename(path: string): string {
    if (isBlank(path)) {
        return "";
    }

    // Handle both Unix and Windows paths
    const parts = path.split(/[/\\]/);
    const last = parts[parts.length - 1];

    return last || "";
}

/**
 * Truncate a string to a maximum length with ellipsis
 */
function truncate(str: string, maxLength: number): string {
    if (isBlank(str) || str.length <= maxLength) {
        return str;
    }

    return str.slice(0, maxLength) + "...";
}

/**
 * Determine if auto-title should be used for a block
 * Checks block metadata for auto-generation flag
 */
export function shouldAutoGenerateTitle(block: Block): boolean {
    if (!block || !block.meta) {
        return false;
    }

    // Check if block has explicit auto-generate setting
    const autoGenerate = block.meta["pane-title:auto"] as boolean | undefined;
    if (autoGenerate !== undefined) {
        return autoGenerate;
    }

    // Check if block has custom title - if so, don't auto-generate
    const customTitle = block.meta["pane-title"] as string | undefined;
    if (!isBlank(customTitle)) {
        return false;
    }

    // Default to auto-generate if no custom title
    return true;
}

/**
 * Get the effective title for a block
 * Returns custom title if set, otherwise auto-generates
 */
export function getEffectiveTitle(block: Block, autoGenerateEnabled: boolean): string {
    if (!block || !block.meta) {
        return "";
    }

    // Check for custom title first
    const customTitle = block.meta["pane-title"] as string | undefined;
    if (!isBlank(customTitle)) {
        return customTitle!;
    }

    // Auto-generate if enabled and appropriate
    if (autoGenerateEnabled && shouldAutoGenerateTitle(block)) {
        return generateAutoTitle(block);
    }

    return "";
}
