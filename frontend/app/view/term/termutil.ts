// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export const DefaultTermTheme = "default-dark";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import * as TermTypes from "@xterm/xterm";
import base64 from "base64-js";
import { colord } from "colord";

export type GenClipboardItem = { text?: string; image?: Blob };

function applyTransparencyToColor(hexColor: string, transparency: number): string {
    const alpha = 1 - transparency; // transparency is already 0-1
    return colord(hexColor).alpha(alpha).toHex();
}

// returns (theme, bgcolor, transparency (0 - 1.0))
export function computeTheme(
    fullConfig: FullConfigType,
    themeName: string,
    termTransparency: number
): [TermThemeType, string] {
    let theme: TermThemeType = fullConfig?.termthemes?.[themeName];
    if (theme == null) {
        theme = fullConfig?.termthemes?.[DefaultTermTheme] || ({} as any);
    }
    const themeCopy = { ...theme };
    if (termTransparency != null && termTransparency > 0) {
        if (themeCopy.background) {
            themeCopy.background = applyTransparencyToColor(themeCopy.background, termTransparency);
        }
        if (themeCopy.selectionBackground) {
            themeCopy.selectionBackground = applyTransparencyToColor(themeCopy.selectionBackground, termTransparency);
        }
    }
    let bgcolor = themeCopy.background;
    themeCopy.background = "#00000000";
    return [themeCopy, bgcolor];
}

export const MIME_TO_EXT: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/bmp": "bmp",
    "image/svg+xml": "svg",
    "image/tiff": "tiff",
    "image/heic": "heic",
    "image/heif": "heif",
    "image/avif": "avif",
    "image/x-icon": "ico",
    "image/vnd.microsoft.icon": "ico",
};

/**
 * Creates a temporary file from a Blob (typically an image).
 * Validates size, generates a unique filename, saves to temp directory,
 * and returns the file path.
 *
 * @param blob - The Blob to save
 * @returns The path to the created temporary file
 * @throws Error if blob is too large (>5MB) or data URL is invalid
 */
export async function createTempFileFromBlob(blob: Blob): Promise<string> {
    // Check size limit (5MB)
    if (blob.size > 5 * 1024 * 1024) {
        throw new Error("Image too large (>5MB)");
    }

    // Get file extension from MIME type
    if (!blob.type.startsWith("image/") || !MIME_TO_EXT[blob.type]) {
        throw new Error(`Unsupported or invalid image type: ${blob.type}`);
    }
    const ext = MIME_TO_EXT[blob.type];

    // Generate unique filename with timestamp and random component
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const filename = `waveterm_paste_${timestamp}_${random}.${ext}`;

    const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = reject;
        reader.readAsArrayBuffer(blob);
    });

    const base64Data = base64.fromByteArray(new Uint8Array(arrayBuffer));

    // Write image to temp file and get path
    const tempPath = await RpcApi.WriteTempFileCommand(TabRpcClient, {
        filename,
        data64: base64Data,
    });

    return tempPath;
}

/**
 * Extracts text or image data from a ClipboardItem using prioritized extraction modes.
 *
 * Mode 1 (Images): If image types are present, returns the first image
 * Mode 2 (Plain Text): If text/plain, text/plain;*, or "text" is found
 * Mode 3 (HTML): If text/html is found, extracts text content via DOM
 * Mode 4 (Generic): If empty string or null type exists
 *
 * @param item - ClipboardItem to extract data from
 * @returns Object with either text or image, or null if no supported content found
 */
export async function extractClipboardData(item: ClipboardItem): Promise<GenClipboardItem | null> {
    // Mode #1: Check for image first
    const imageTypes = item.types.filter((type) => type.startsWith("image/"));
    if (imageTypes.length > 0) {
        const blob = await item.getType(imageTypes[0]);
        return { image: blob };
    }

    // Mode #2: Try text/plain, text/plain;*, or "text"
    const plainTextType = item.types.find((t) => t === "text" || t === "text/plain" || t.startsWith("text/plain;"));
    if (plainTextType) {
        const blob = await item.getType(plainTextType);
        const text = await blob.text();
        return text ? { text } : null;
    }

    // Mode #3: Try text/html - extract text via DOM
    const htmlType = item.types.find((t) => t === "text/html" || t.startsWith("text/html;"));
    if (htmlType) {
        const blob = await item.getType(htmlType);
        const html = await blob.text();
        if (!html) {
            return null;
        }
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = html;
        const text = tempDiv.textContent || "";
        return text ? { text } : null;
    }

    // Mode #4: Try empty string or null type
    const genericType = item.types.find((t) => t === "");
    if (genericType != null) {
        const blob = await item.getType(genericType);
        const text = await blob.text();
        return text ? { text } : null;
    }

    return null;
}

/**
 * Finds the first DataTransferItem matching the specified kind and type predicate.
 *
 * @param items - The DataTransferItemList to search
 * @param kind - The kind to match ("file" or "string")
 * @param typePredicate - Function that returns true if the type matches
 * @returns The first matching DataTransferItem, or null if none found
 */
function findFirstDataTransferItem(
    items: DataTransferItemList,
    kind: string,
    typePredicate: (type: string) => boolean
): DataTransferItem | null {
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === kind && typePredicate(item.type)) {
            return item;
        }
    }
    return null;
}

/**
 * Finds all DataTransferItems matching the specified kind and type predicate.
 *
 * @param items - The DataTransferItemList to search
 * @param kind - The kind to match ("file" or "string")
 * @param typePredicate - Function that returns true if the type matches
 * @returns Array of matching DataTransferItems
 */
function findAllDataTransferItems(
    items: DataTransferItemList,
    kind: string,
    typePredicate: (type: string) => boolean
): DataTransferItem[] {
    const results: DataTransferItem[] = [];
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === kind && typePredicate(item.type)) {
            results.push(item);
        }
    }
    return results;
}

/**
 * Extracts clipboard data from a DataTransferItemList using prioritized extraction modes.
 *
 * The function uses a hierarchical approach to determine what data to extract:
 *
 * Mode 1 (Image Files): If any image file items are present, extracts only image files
 * - Returns array of {image: Blob} for each image/* MIME type
 * - Ignores all non-image items when image files are present
 * - Non-image files (e.g., PDFs) allow fallthrough to text modes
 *
 * Mode 2 (Plain Text): If text/plain is found (and no image files)
 * - Returns single-item array with first text/plain content as {text: string}
 * - Matches: "text", "text/plain", or types starting with "text/plain"
 *
 * Mode 3 (HTML): If text/html is found (and no image files or plain text)
 * - Extracts text content from first HTML item using DOM parsing
 * - Returns single-item array as {text: string}
 *
 * Mode 4 (Generic String): If string item with empty/null type exists
 * - Returns first string item with no type identifier
 * - Returns single-item array as {text: string}
 *
 * @param items - The DataTransferItemList to process
 * @returns Array of GenClipboardItem objects, or empty array if no supported content found
 */
export async function extractDataTransferItems(items: DataTransferItemList): Promise<GenClipboardItem[]> {
    // Mode #1: If image files are present, only extract image files
    const imageFiles = findAllDataTransferItems(items, "file", (type) => type.startsWith("image/"));
    if (imageFiles.length > 0) {
        const results: GenClipboardItem[] = [];
        for (const item of imageFiles) {
            const blob = item.getAsFile();
            if (blob) {
                results.push({ image: blob });
            }
        }
        return results;
    }

    // Mode #2: If text/plain is present, only extract the first text/plain
    const plainTextItem = findFirstDataTransferItem(
        items,
        "string",
        (type) => type === "text" || type === "text/plain" || type.startsWith("text/plain;")
    );
    if (plainTextItem) {
        return new Promise((resolve) => {
            plainTextItem.getAsString((text) => {
                resolve(text ? [{ text }] : []);
            });
        });
    }

    // Mode #3: If text/html is present, extract text from first HTML
    const htmlItem = findFirstDataTransferItem(
        items,
        "string",
        (type) => type === "text/html" || type.startsWith("text/html;")
    );
    if (htmlItem) {
        return new Promise((resolve) => {
            htmlItem.getAsString((html) => {
                if (!html) {
                    resolve([]);
                    return;
                }
                const tempDiv = document.createElement("div");
                tempDiv.innerHTML = html;
                const text = tempDiv.textContent || "";
                resolve(text ? [{ text }] : []);
            });
        });
    }

    // Mode #4: If there's a string item with empty/null type, extract first one
    const genericStringItem = findFirstDataTransferItem(items, "string", (type) => type === "" || type == null);
    if (genericStringItem) {
        return new Promise((resolve) => {
            genericStringItem.getAsString((text) => {
                resolve(text ? [{ text }] : []);
            });
        });
    }

    return [];
}

/**
 * Extracts all clipboard data from a ClipboardEvent using multiple fallback methods.
 * Tries ClipboardEvent.clipboardData.items first, then Clipboard API, then simple getData().
 *
 * @param e - The ClipboardEvent (optional)
 * @returns Array of objects containing text and/or image data
 */
export async function extractAllClipboardData(e?: ClipboardEvent): Promise<Array<GenClipboardItem>> {
    const results: Array<GenClipboardItem> = [];

    try {
        // First try using ClipboardEvent.clipboardData.items
        if (e?.clipboardData?.items) {
            return await extractDataTransferItems(e.clipboardData.items);
        }

        // Fallback: Try Clipboard API
        const clipboardItems = await navigator.clipboard.read();
        for (const item of clipboardItems) {
            const data = await extractClipboardData(item);
            if (data) {
                results.push(data);
            }
        }
        return results;
    } catch (err) {
        console.error("Clipboard read error:", err);
        // Final fallback: simple text paste
        if (e?.clipboardData) {
            const text = e.clipboardData.getData("text/plain");
            if (text) {
                results.push({ text });
            }
        }
        return results;
    }
}

/**
 * Converts terminal buffer lines to text, properly handling wrapped lines.
 * Wrapped lines (long lines split across multiple buffer rows) are concatenated
 * without adding newlines between them, while preserving actual line breaks.
 *
 * @param buffer - The xterm.js buffer to extract lines from
 * @param startIndex - Starting buffer index (inclusive, 0-based)
 * @param endIndex - Ending buffer index (exclusive, 0-based)
 * @returns Array of logical lines (with wrapped lines concatenated)
 */
export function bufferLinesToText(buffer: TermTypes.IBuffer, startIndex: number, endIndex: number): string[] {
    const lines: string[] = [];
    let currentLine = "";
    let isFirstLine = true;

    // Clamp indices to valid buffer range to avoid out-of-bounds access on the
    // underlying circular buffer, which could return stale/wrong data.
    const clampedStart = Math.max(0, Math.min(startIndex, buffer.length));
    const clampedEnd = Math.max(0, Math.min(endIndex, buffer.length));

    for (let i = clampedStart; i < clampedEnd; i++) {
        const line = buffer.getLine(i);
        if (line) {
            const lineText = line.translateToString(true);
            // If this line is wrapped (continuation of previous line), concatenate without newline
            if (line.isWrapped && !isFirstLine) {
                currentLine += lineText;
            } else {
                // This is a new logical line
                if (!isFirstLine) {
                    lines.push(currentLine);
                }
                currentLine = lineText;
                isFirstLine = false;
            }
        }
    }

    // Don't forget the last line
    if (!isFirstLine) {
        lines.push(currentLine);
    }

    // Trim trailing blank lines only when the requested range extends to the
    // actual end of the buffer.  A terminal allocates a fixed number of rows
    // (e.g. 80) but only the first few may contain real content; the rest are
    // empty placeholder rows.  We strip those so callers don't receive a wall
    // of empty strings.
    //
    // Crucially, if the caller requested a specific sub-range (e.g. lines
    // 100-150) and lines 140-150 happen to be blank, those blanks are
    // intentional and must NOT be removed.  We only trim when the range
    // reaches the very end of the buffer.
    if (clampedEnd >= buffer.length) {
        while (lines.length > 0 && lines[lines.length - 1] === "") {
            lines.pop();
        }
    }

    return lines;
}
