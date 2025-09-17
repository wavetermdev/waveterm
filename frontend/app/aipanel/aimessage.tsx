// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { memo } from "react";
import { Streamdown } from "streamdown";

interface AIMessageProps {
    message: any;
    isStreaming: boolean;
}

export const AIMessage = memo(({ message, isStreaming }: AIMessageProps) => {
    const getMessageContent = (message: any) => {
        if (message.content) return message.content;
        if (message.parts) {
            return message.parts
                .filter((part: any) => part.type === "text")
                .map((part: any) => part.text)
                .join("");
        }
        return "";
    };

    return (
        <div className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
            <div
                className={cn(
                    "max-w-[80%] px-4 py-2 rounded-lg",
                    message.role === "user" ? "bg-accent-800 text-white" : "bg-gray-800 text-gray-100"
                )}
            >
                {message.role === "user" ? (
                    <div className="whitespace-pre-wrap break-words">{getMessageContent(message)}</div>
                ) : (
                    <Streamdown
                        parseIncompleteMarkdown={isStreaming}
                        className="markdown-content text-gray-100"
                        shikiTheme={["github-dark", "github-dark"]}
                        controls={{
                            code: true,
                            table: true,
                            mermaid: true,
                        }}
                        mermaidConfig={{
                            theme: "dark",
                            darkMode: true,
                        }}
                        allowedLinkPrefixes={["https://", "http://", "#"]}
                        allowedImagePrefixes={["https://", "http://", "data:"]}
                        defaultOrigin="http://localhost"
                    >
                        {getMessageContent(message)}
                    </Streamdown>
                )}
            </div>
        </div>
    );
});

AIMessage.displayName = "AIMessage";
