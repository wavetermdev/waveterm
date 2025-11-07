// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export const DefaultTermTheme = "default-dark";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { RpcApi } from "@/app/store/wshclientapi";
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
    const ext = MIME_TO_EXT[blob.type] || "png";

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
 * Checks if image input is supported.
 * Images will be saved as temp files and the path will be pasted.
 * Claude Code and other AI tools can then read the file.
 *
 * @returns true if image input is supported
 */
export function supportsImageInput(): boolean {
    return true;
}

/**
 * Handles pasting an image blob by creating a temp file and pasting its path.
 *
 * @param blob - The image blob to paste
 * @param pasteFn - Function to paste the file path into the terminal
 */
export async function handleImagePasteBlob(blob: Blob, pasteFn: (text: string) => void): Promise<void> {
    try {
        const tempPath = await createTempFileFromBlob(blob);
        // Paste the file path (like iTerm2 does when you copy a file)
        // Claude Code will read the file and display it as [Image #N]
        pasteFn(tempPath + " ");
    } catch (err) {
        console.error("Error pasting image:", err);
    }
}
