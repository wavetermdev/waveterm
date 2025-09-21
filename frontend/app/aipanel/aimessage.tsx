// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { UIMessage } from "ai";
import { memo } from "react";
import { Streamdown } from "streamdown";
import { getFileIcon } from "./ai-utils";

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
    fileParts: Array<any>;
}

const UserMessageFiles = memo(({ fileParts }: UserMessageFilesProps) => {
    if (fileParts.length === 0) return null;

    return (
        <div className="mt-2 pt-2 border-t border-gray-600">
            <div className="flex gap-2 overflow-x-auto pb-1">
                {fileParts.map((file, index) => (
                    <div key={index} className="relative bg-gray-700 rounded-lg p-2 min-w-20 flex-shrink-0">
                        <div className="flex flex-col items-center text-center">
                            {file.url?.startsWith('data:image') ? (
                                <div className="w-12 h-12 mb-1">
                                    <img
                                        src={file.url}
                                        alt={file.filename || 'Image'}
                                        className="w-full h-full object-cover rounded"
                                    />
                                </div>
                            ) : (
                                <div className="w-12 h-12 mb-1 flex items-center justify-center bg-gray-600 rounded">
                                    <i className={cn("fa text-lg text-gray-300", getFileIcon(file.filename || '', file.mediaType || ''))}></i>
                                </div>
                            )}
                            <div className="text-[10px] text-gray-200 truncate w-full max-w-16" title={file.filename || 'File'}>
                                {file.filename || 'File'}
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
    part: any;
    role: string;
    isStreaming: boolean;
}

const AIMessagePart = memo(({ part, role, isStreaming }: AIMessagePartProps) => {
    if (part.type !== "text") {
        return null;
    }

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
});

AIMessagePart.displayName = "AIMessagePart";

interface AIMessageProps {
    message: UIMessage;
    isStreaming: boolean;
}

export const AIMessage = memo(({ message, isStreaming }: AIMessageProps) => {
    const parts = message.parts || [];
    const textParts = parts.filter((part: any) => part.type === "text");
    const fileParts = parts.filter((part: any) => part.type === "file");
    const hasTextContent = textParts.length > 0 && textParts.some((part: any) => part.text);

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
                    textParts.map((part: any, index: number) => (
                        <AIMessagePart key={index} part={part} role={message.role} isStreaming={isStreaming} />
                    ))
                )}
                
                {message.role === "user" && <UserMessageFiles fileParts={fileParts} />}
            </div>
        </div>
    );
});

AIMessage.displayName = "AIMessage";
