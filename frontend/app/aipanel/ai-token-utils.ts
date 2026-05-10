// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WaveUIMessage } from "./aitypes";

export function estimateTokensFromMessages(messages: WaveUIMessage[]): number {
    let totalChars = 0;
    for (const msg of messages) {
        if (!msg.parts) continue;
        for (const part of msg.parts) {
            if (part.type === "text" && part.text) {
                totalChars += part.text.length;
            } else if (part.type === "reasoning" && part.text) {
                totalChars += part.text.length;
            } else if (part.type?.startsWith("tool-")) {
                const toolPart = part as any;
                const toolText = JSON.stringify(toolPart.input ?? toolPart.output ?? "");
                totalChars += toolText.length;
            } else if (part.type === "data-tooluse") {
                const toolUseData = (part as any).data;
                if (toolUseData?.output) {
                    totalChars += toolUseData.output.length;
                }
            }
        }
    }
    // Rough estimate: ~4 characters per token (conservative for mixed content)
    return Math.ceil(totalChars / 4);
}
