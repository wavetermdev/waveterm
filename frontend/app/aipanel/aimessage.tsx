// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { UIMessage } from "ai";
import { memo } from "react";
import { Streamdown } from "streamdown";

const AIThinking = memo(() => (
    <div className="flex items-center gap-2">
        <div className="animate-pulse flex items-center">
            <i className="fa fa-circle text-[10px]"></i>
            <i className="fa fa-circle text-[10px] mx-1"></i>
            <i className="fa fa-circle text-[10px]"></i>
        </div>
        <span className="text-sm text-gray-400">AI is thinking...</span>
    </div>
));

AIThinking.displayName = "AIThinking";

interface AIMessageProps {
    message: UIMessage;
    isStreaming: boolean;
}

export const AIMessage = memo(({ message, isStreaming }: AIMessageProps) => {
    let content = (() => {
        if (message.parts) {
            return message.parts
                .filter((part: any) => part.type === "text")
                .map((part: any) => part.text)
                .join("");
        }
        return "";
    })();

    const showThinking = content === "" && isStreaming && message.role === "assistant";
    
    if (content === "" && !isStreaming) {
        content = "(no text content)";
    }

    return (
        <div className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
            <div
                className={cn(
                    "px-2 py-2 rounded-lg",
                    message.role === "user"
                        ? "bg-accent-800 text-white max-w-[calc(100%-20px)]"
                        : "bg-gray-800 text-gray-100"
                )}
            >
                {showThinking ? (
                    <AIThinking />
                ) : message.role === "user" ? (
                    <div className="whitespace-pre-wrap break-words">{content}</div>
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
                        {content}
                    </Streamdown>
                )}
            </div>
        </div>
    );
});

AIMessage.displayName = "AIMessage";
