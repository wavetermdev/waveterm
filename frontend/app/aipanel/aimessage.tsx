// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { memo } from "react";
import { Streamdown } from "streamdown";
import { getFileIcon } from "./ai-utils";
import { WaveUIMessage, WaveUIMessagePart } from "./aitypes";

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

interface UserMessageFilesProps {
    fileParts: Array<WaveUIMessagePart & { type: "data-userfile" }>;
}

const UserMessageFiles = memo(({ fileParts }: UserMessageFilesProps) => {
    if (fileParts.length === 0) return null;

    return (
        <div className="mt-2 pt-2 border-t border-gray-600">
            <div className="flex gap-2 overflow-x-auto pb-1">
                {fileParts.map((file, index) => (
                    <div key={index} className="relative bg-gray-700 rounded-lg p-2 min-w-20 flex-shrink-0">
                        <div className="flex flex-col items-center text-center">
                            <div className="w-12 h-12 mb-1 flex items-center justify-center bg-gray-600 rounded">
                                <i className={cn("fa text-lg text-gray-300", getFileIcon(file.data?.filename || '', file.data?.mimetype || ''))}></i>
                            </div>
                            <div className="text-[10px] text-gray-200 truncate w-full max-w-16" title={file.data?.filename || 'File'}>
                                {file.data?.filename || 'File'}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
});

UserMessageFiles.displayName = "UserMessageFiles";

interface AIMessagePartProps {
    part: WaveUIMessagePart;
    role: string;
    isStreaming: boolean;
}

const AIMessagePart = memo(({ part, role, isStreaming }: AIMessagePartProps) => {
    if (part.type === "text") {
        const content = part.text ?? "";

        if (role === "user") {
            return <div className="whitespace-pre-wrap break-words">{content}</div>;
        } else {
            return (
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
            );
        }
    }

    if (part.type.startsWith("tool-") && "state" in part && part.state === "input-available") {
        const toolName = part.type.substring(5); // Remove "tool-" prefix
        return (
            <div className="text-gray-400 italic">
                Calling tool {toolName}
            </div>
        );
    }

    return null;
});

AIMessagePart.displayName = "AIMessagePart";

interface AIMessageProps {
    message: WaveUIMessage;
    isStreaming: boolean;
}

const isDisplayPart = (part: WaveUIMessagePart): boolean => {
    return part.type === "text" || (part.type.startsWith("tool-") && "state" in part && part.state === "input-available");
};

export const AIMessage = memo(({ message, isStreaming }: AIMessageProps) => {
    const parts = message.parts || [];
    const displayParts = parts.filter(isDisplayPart);
    const fileParts = parts.filter((part): part is WaveUIMessagePart & { type: "data-userfile" } => part.type === "data-userfile");
    const hasTextContent = displayParts.length > 0 && displayParts.some((part) => part.type === "text" && part.text);

    const showThinking = !hasTextContent && isStreaming && message.role === "assistant";

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
                ) : !hasTextContent && !isStreaming ? (
                    <div className="whitespace-pre-wrap break-words">(no text content)</div>
                ) : (
                    displayParts.map((part, index: number) => (
                        <div key={index} className={cn(index > 0 && "mt-2")}>
                            <AIMessagePart part={part} role={message.role} isStreaming={isStreaming} />
                        </div>
                    ))
                )}
                
                {message.role === "user" && <UserMessageFiles fileParts={fileParts} />}
            </div>
        </div>
    );
});

AIMessage.displayName = "AIMessage";
