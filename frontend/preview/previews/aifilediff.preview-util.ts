// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { stringToBase64 } from "@/util/util";

export const DefaultAiFileDiffChatId = "preview-aifilediff-chat";
export const DefaultAiFileDiffToolCallId = "preview-aifilediff-toolcall";
export const DefaultAiFileDiffFileName = "src/lib/greeting.ts";

export const DefaultAiFileDiffOriginal = `export function greet(name: string) {
    return "Hello " + name;
}

export function greetAll(names: string[]) {
    return names.map(greet).join("\\n");
}
`;

export const DefaultAiFileDiffModified = `export function greet(name: string) {
    const normalizedName = name.trim() || "friend";
    return \`Hello, \${normalizedName}!\`;
}

export function greetAll(names: string[]) {
    return names.map(greet).join("\\n");
}
`;

export function makeMockAiFileDiffResponse(
    original = DefaultAiFileDiffOriginal,
    modified = DefaultAiFileDiffModified
): CommandWaveAIGetToolDiffRtnData {
    return {
        originalcontents64: stringToBase64(original),
        modifiedcontents64: stringToBase64(modified),
    };
}
