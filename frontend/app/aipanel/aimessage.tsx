// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WaveStreamdown } from "@/app/element/streamdown";
import { cn } from "@/util/util";
import { memo, useEffect, useRef } from "react";
import { getFileIcon } from "./ai-utils";
import { AIFeedbackButtons } from "./aifeedbackbuttons";
import { AIToolUseGroup } from "./aitooluse";
import { WaveUIMessage, WaveUIMessagePart } from "./aitypes";
import { WaveAIModel } from "./waveai-model";

const AIThinking = memo(
    ({ message = "AI is thinking...", reasoningText }: { message?: string; reasoningText?: string }) => {
        const scrollRef = useRef<HTMLDivElement>(null);

        useEffect(() => {
            if (scrollRef.current && reasoningText) {
                scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            }
        }, [reasoningText]);

        const displayText = reasoningText
            ? (() => {
                  const lastDoubleNewline = reasoningText.lastIndexOf("\n\n");
                  return lastDoubleNewline !== -1 ? reasoningText.substring(lastDoubleNewline + 2) : reasoningText;
              })()
            : "";

        return (
            <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                    <div className="animate-pulse flex items-center">
                        <i className="fa fa-circle text-[10px]"></i>
                        <i className="fa fa-circle text-[10px] mx-1"></i>
                        <i className="fa fa-circle text-[10px]"></i>
                    </div>
                    {message && <span className="text-sm text-gray-400">{message}</span>}
                </div>
                {displayText && (
                    <div
                        ref={scrollRef}
                        className="text-sm text-gray-500 overflow-y-auto max-h-[2lh] max-w-[600px] pl-9"
                    >
                        {displayText}
                    </div>
                )}
            </div>
        );
    }
);

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
                            <div className="w-12 h-12 mb-1 flex items-center justify-center bg-gray-600 rounded overflow-hidden">
                                {file.data?.previewurl ? (
                                    <img
                                        src={file.data.previewurl}
                                        alt={file.data?.filename || "File"}
                                        className="w-full h-full object-cover"
                                    />
                                ) : (
                                    <i
                                        className={cn(
                                            "fa text-lg text-gray-300",
                                            getFileIcon(file.data?.filename || "", file.data?.mimetype || "")
                                        )}
                                    ></i>
                                )}
                            </div>
                            <div
                                className="text-[10px] text-gray-200 truncate w-full max-w-16"
                                title={file.data?.filename || "File"}
                            >
                                {file.data?.filename || "File"}
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
    const model = WaveAIModel.getInstance();

    if (part.type === "text") {
        const content = part.text ?? "";

        if (role === "user") {
            return <div className="whitespace-pre-wrap break-words">{content}</div>;
        } else {
            return (
                <WaveStreamdown
                    text={content}
                    parseIncompleteMarkdown={isStreaming}
                    className="text-gray-100"
                    codeBlockMaxWidthAtom={model.codeBlockMaxWidth}
                />
            );
        }
    }

    return null;
});

AIMessagePart.displayName = "AIMessagePart";

interface AIMessageProps {
    message: WaveUIMessage;
    isStreaming: boolean;
}

const isDisplayPart = (part: WaveUIMessagePart): boolean => {
    return (
        part.type === "text" ||
        part.type === "data-tooluse" ||
        (part.type.startsWith("tool-") && "state" in part && part.state === "input-available")
    );
};

type MessagePart =
    | { type: "single"; part: WaveUIMessagePart }
    | { type: "toolgroup"; parts: Array<WaveUIMessagePart & { type: "data-tooluse" }> };

const groupMessageParts = (parts: WaveUIMessagePart[]): MessagePart[] => {
    const grouped: MessagePart[] = [];
    let currentToolGroup: Array<WaveUIMessagePart & { type: "data-tooluse" }> = [];

    for (const part of parts) {
        if (part.type === "data-tooluse") {
            currentToolGroup.push(part as WaveUIMessagePart & { type: "data-tooluse" });
        } else {
            if (currentToolGroup.length > 0) {
                grouped.push({ type: "toolgroup", parts: currentToolGroup });
                currentToolGroup = [];
            }
            grouped.push({ type: "single", part });
        }
    }

    if (currentToolGroup.length > 0) {
        grouped.push({ type: "toolgroup", parts: currentToolGroup });
    }

    return grouped;
};

const getThinkingMessage = (
    parts: WaveUIMessagePart[],
    isStreaming: boolean,
    role: string
): { message: string; reasoningText?: string } | null => {
    if (!isStreaming || role !== "assistant") {
        return null;
    }

    const hasPendingApprovals = parts.some(
        (part) => part.type === "data-tooluse" && part.data?.approval === "needs-approval"
    );

    if (hasPendingApprovals) {
        return { message: "Waiting for Tool Approvals..." };
    }

    const lastPart = parts[parts.length - 1];

    if (lastPart?.type === "reasoning") {
        const reasoningContent = lastPart.text || "";
        return { message: "AI is thinking...", reasoningText: reasoningContent };
    }

    if (lastPart?.type === "text" && lastPart.text) {
        return null;
    }

    return { message: "" };
};

export const AIMessage = memo(({ message, isStreaming }: AIMessageProps) => {
    const parts = message.parts || [];
    const displayParts = parts.filter(isDisplayPart);
    const fileParts = parts.filter(
        (part): part is WaveUIMessagePart & { type: "data-userfile" } => part.type === "data-userfile"
    );

    const thinkingData = getThinkingMessage(parts, isStreaming, message.role);
    const groupedParts = groupMessageParts(displayParts);

    return (
        <div className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
            <div
                className={cn(
                    "px-2 rounded-lg [&>*:first-child]:!mt-0",
                    message.role === "user" ? "py-2 bg-accent-800 text-white max-w-[calc(100%-20px)]" : null
                )}
            >
                {displayParts.length === 0 && !isStreaming && !thinkingData ? (
                    <div className="whitespace-pre-wrap break-words">(no text content)</div>
                ) : (
                    <>
                        {groupedParts.map((group, index: number) =>
                            group.type === "toolgroup" ? (
                                <AIToolUseGroup key={index} parts={group.parts} isStreaming={isStreaming} />
                            ) : (
                                <div key={index} className="mt-2">
                                    <AIMessagePart part={group.part} role={message.role} isStreaming={isStreaming} />
                                </div>
                            )
                        )}
                        {thinkingData != null && (
                            <div className="mt-2">
                                <AIThinking message={thinkingData.message} reasoningText={thinkingData.reasoningText} />
                            </div>
                        )}
                    </>
                )}

                {message.role === "user" && <UserMessageFiles fileParts={fileParts} />}
                {message.role === "assistant" && !isStreaming && displayParts.length > 0 && (
                    <AIFeedbackButtons
                        messageText={parts
                            .filter((p) => p.type === "text")
                            .map((p) => p.text || "")
                            .join("\n\n")}
                    />
                )}
            </div>
        </div>
    );
});

AIMessage.displayName = "AIMessage";
