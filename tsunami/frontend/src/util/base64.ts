// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import base64 from "base64-js";

export function base64ToString(b64: string): string {
    if (b64 == null) {
        return null;
    }
    if (b64 == "") {
        return "";
    }
    const stringBytes = base64.toByteArray(b64);
    return new TextDecoder().decode(stringBytes);
}

export function stringToBase64(input: string): string {
    const stringBytes = new TextEncoder().encode(input);
    return base64.fromByteArray(stringBytes);
}

export function base64ToArray(b64: string): Uint8Array<ArrayBufferLike> {
    const cleanB64 = b64.replace(/\s+/g, "");
    return base64.toByteArray(cleanB64);
}

export function base64ToArrayBuffer(b64: string): ArrayBuffer {
    const cleanB64 = b64.replace(/\s+/g, "");
    const u8 = base64.toByteArray(cleanB64); // Uint8Array<ArrayBufferLike>
    // Force a plain ArrayBuffer slice (no SharedArrayBuffer, no offset issues)
    return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const u8 = new Uint8Array(buffer);
    return base64.fromByteArray(u8);
}
