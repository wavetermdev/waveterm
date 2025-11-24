// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export const DefaultTermTheme = "default-dark";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import base64 from "base64-js";
import { colord } from "colord";

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
 * Extracts text or image data from a clipboard item.
 * Prioritizes images over text - if an image is found, only the image is returned.
 * For text, only text/plain is accepted (no HTML or RTF).
 *
 * @param item - Either a DataTransferItem or ClipboardItem
 * @returns Object with either text or image, or null if neither could be extracted
 */
export async function extractClipboardData(
    item: DataTransferItem | ClipboardItem
): Promise<{ text?: string; image?: Blob } | null> {
    // Check if it's a DataTransferItem (has 'kind' property)
    if ("kind" in item) {
        const dataTransferItem = item as DataTransferItem;

        // Check for image first
        if (dataTransferItem.type.startsWith("image/")) {
            const blob = dataTransferItem.getAsFile();
            if (blob) {
                return { image: blob };
            }
        }

        // Accept text but explicitly reject HTML and RTF
        if (
            dataTransferItem.kind === "string" &&
            !dataTransferItem.type?.startsWith("text/html") &&
            !dataTransferItem.type?.startsWith("text/rtf")
        ) {
            return new Promise((resolve) => {
                dataTransferItem.getAsString((text) => {
                    resolve(text ? { text } : null);
                });
            });
        }

        return null;
    }

    // It's a ClipboardItem
    const clipboardItem = item as ClipboardItem;

    // Check for image first
    const imageTypes = clipboardItem.types.filter((type) => type.startsWith("image/"));
    if (imageTypes.length > 0) {
        const blob = await clipboardItem.getType(imageTypes[0]);
        return { image: blob };
    }

    // First pass: look for text/plain or just "text"
    let textType: string | undefined = clipboardItem.types.find((t) => t === "text/plain" || t === "text");
    if (!textType) {
        // Second pass: look for any text/* but reject html and rtf
        textType = clipboardItem.types.find(
            (t) => t.startsWith("text/") && !t.startsWith("text/html") && !t.startsWith("text/rtf")
        );
    }
    if (textType) {
        const blob = await clipboardItem.getType(textType);
        const text = await blob.text();
        return text ? { text } : null;
    }

    return null;
}

/**
 * Extracts all clipboard data from a ClipboardEvent using multiple fallback methods.
 * Tries ClipboardEvent.clipboardData.items first, then Clipboard API, then simple getData().
 *
 * @param e - The ClipboardEvent (optional)
 * @returns Array of objects containing text and/or image data
 */
export async function extractAllClipboardData(e?: ClipboardEvent): Promise<Array<{ text?: string; image?: Blob }>> {
    const results: Array<{ text?: string; image?: Blob }> = [];

    try {
        // First try using ClipboardEvent.clipboardData.items
        if (e?.clipboardData?.items) {
            for (let i = 0; i < e.clipboardData.items.length; i++) {
                const data = await extractClipboardData(e.clipboardData.items[i]);
                if (data) {
                    results.push(data);
                }
            }
            return results;
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
