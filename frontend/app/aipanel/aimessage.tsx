// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WaveStreamdown } from "@/app/element/streamdown";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn } from "@/util/util";
import { memo, useEffect, useState } from "react";
import { getFileIcon } from "./ai-utils";
import { WaveUIMessage, WaveUIMessagePart } from "./aitypes";
import { WaveAIModel } from "./waveai-model";

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

interface AIToolUseBatchProps {
    parts: Array<WaveUIMessagePart & { type: "data-tooluse" }>;
    isStreaming: boolean;
}

const AIToolUseBatch = memo(({ parts, isStreaming }: AIToolUseBatchProps) => {
    const [userApprovalOverride, setUserApprovalOverride] = useState<string | null>(null);
    
    if (parts.length === 0) return null;
    
    const firstTool = parts[0].data;
    const baseApproval = userApprovalOverride || firstTool.approval;
    const effectiveApproval = !isStreaming && baseApproval === "needs-approval" ? "timeout" : baseApproval;
    const allNeedApproval = parts.every(p => (userApprovalOverride || p.data.approval) === "needs-approval");
    
    useEffect(() => {
        if (!isStreaming || effectiveApproval !== "needs-approval") return;
        
        const interval = setInterval(() => {
            parts.forEach(part => {
                RpcApi.WaveAIToolApproveCommand(TabRpcClient, {
                    toolcallid: part.data.toolcallid,
                    keepalive: true,
                });
            });
        }, 4000);
        
        return () => clearInterval(interval);
    }, [isStreaming, effectiveApproval, parts]);
    
    const handleApprove = () => {
        setUserApprovalOverride("user-approved");
        parts.forEach(part => {
            RpcApi.WaveAIToolApproveCommand(TabRpcClient, {
                toolcallid: part.data.toolcallid,
                approval: "user-approved",
            });
        });
    };
    
    const handleDeny = () => {
        setUserApprovalOverride("user-denied");
        parts.forEach(part => {
            RpcApi.WaveAIToolApproveCommand(TabRpcClient, {
                toolcallid: part.data.toolcallid,
                approval: "user-denied",
            });
        });
    };
    
    const groupTitle = firstTool.toolname === "read_text_file" ? "Reading Files" : "Listing Directories";
    
    return (
        <div className="flex items-start gap-2 p-2 rounded bg-gray-800 border border-gray-700">
            <div className="flex-1">
                <div className="font-semibold">{groupTitle}</div>
                <div className="mt-1 space-y-0.5">
                    {parts.map((part, idx) => {
                        const statusIcon = part.data.status === "completed" ? "✓" : part.data.status === "error" ? "✗" : "•";
                        const statusColor = part.data.status === "completed" ? "text-success" : part.data.status === "error" ? "text-error" : "text-gray-400";
                        const effectiveErrorMessage = part.data.errormessage || (effectiveApproval === "timeout" ? "Not approved" : null);
                        return (
                            <div key={idx} className="text-sm pl-2">
                                <span className={cn("font-bold mr-1.5", statusColor)}>{statusIcon}</span>
                                <span className="text-gray-400">{part.data.tooldesc}</span>
                                {effectiveErrorMessage && (
                                    <div className="text-red-300 ml-4 mt-0.5">{effectiveErrorMessage}</div>
                                )}
                            </div>
                        );
                    })}
                </div>
                {allNeedApproval && effectiveApproval === "needs-approval" && (
                    <div className="mt-2 flex gap-2">
                        <button
                            onClick={handleApprove}
                            className="px-3 py-1 border border-gray-600 text-gray-300 hover:border-gray-500 hover:text-white text-sm rounded cursor-pointer transition-colors"
                        >
                            Approve All ({parts.length})
                        </button>
                        <button
                            onClick={handleDeny}
                            className="px-3 py-1 border border-gray-600 text-gray-300 hover:border-gray-500 hover:text-white text-sm rounded cursor-pointer transition-colors"
                        >
                            Deny All
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
});

AIToolUseBatch.displayName = "AIToolUseBatch";

interface AIToolUseProps {
    part: WaveUIMessagePart & { type: "data-tooluse" };
    isStreaming: boolean;
}

const AIToolUse = memo(({ part, isStreaming }: AIToolUseProps) => {
    const toolData = part.data;
    const [userApprovalOverride, setUserApprovalOverride] = useState<string | null>(null);

    const statusIcon = toolData.status === "completed" ? "✓" : toolData.status === "error" ? "✗" : "•";
    const statusColor =
        toolData.status === "completed" ? "text-success" : toolData.status === "error" ? "text-error" : "text-gray-400";

    const baseApproval = userApprovalOverride || toolData.approval;
    const effectiveApproval = !isStreaming && baseApproval === "needs-approval" ? "timeout" : baseApproval;

    useEffect(() => {
        if (!isStreaming || effectiveApproval !== "needs-approval") return;

        const interval = setInterval(() => {
            RpcApi.WaveAIToolApproveCommand(TabRpcClient, {
                toolcallid: toolData.toolcallid,
                keepalive: true,
            });
        }, 4000);

        return () => clearInterval(interval);
    }, [isStreaming, effectiveApproval, toolData.toolcallid]);

    const handleApprove = () => {
        setUserApprovalOverride("user-approved");
        RpcApi.WaveAIToolApproveCommand(TabRpcClient, {
            toolcallid: toolData.toolcallid,
            approval: "user-approved",
        });
    };

    const handleDeny = () => {
        setUserApprovalOverride("user-denied");
        RpcApi.WaveAIToolApproveCommand(TabRpcClient, {
            toolcallid: toolData.toolcallid,
            approval: "user-denied",
        });
    };

    return (
        <div className={cn("flex items-start gap-2 p-2 rounded bg-gray-800 border border-gray-700", statusColor)}>
            <span className="font-bold">{statusIcon}</span>
            <div className="flex-1">
                <div className="font-semibold">{toolData.toolname}</div>
                {toolData.tooldesc && <div className="text-sm text-gray-400">{toolData.tooldesc}</div>}
                {(toolData.errormessage || effectiveApproval === "timeout") && (
                    <div className="text-sm text-red-300 mt-1">
                        {toolData.errormessage || "Not approved"}
                    </div>
                )}
                {effectiveApproval === "needs-approval" && (
                    <div className="mt-2 flex gap-2">
                        <button
                            onClick={handleApprove}
                            className="px-3 py-1 border border-gray-600 text-gray-300 hover:border-gray-500 hover:text-white text-sm rounded cursor-pointer transition-colors"
                        >
                            Approve
                        </button>
                        <button
                            onClick={handleDeny}
                            className="px-3 py-1 border border-gray-600 text-gray-300 hover:border-gray-500 hover:text-white text-sm rounded cursor-pointer transition-colors"
                        >
                            Deny
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
});

AIToolUse.displayName = "AIToolUse";

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

    if (part.type === "data-tooluse" && part.data) {
        return <AIToolUse part={part as WaveUIMessagePart & { type: "data-tooluse" }} isStreaming={isStreaming} />;
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

const isFileOperation = (part: WaveUIMessagePart): boolean => {
    if (part.type !== "data-tooluse") return false;
    const toolName = part.data?.toolname;
    return toolName === "read_text_file" || toolName === "read_dir";
};

type GroupedPart =
    | { type: "single"; part: WaveUIMessagePart }
    | { type: "batch"; parts: Array<WaveUIMessagePart & { type: "data-tooluse" }> };

const groupFileParts = (parts: WaveUIMessagePart[]): GroupedPart[] => {
    const grouped: GroupedPart[] = [];
    let currentBatch: Array<WaveUIMessagePart & { type: "data-tooluse" }> = [];
    let currentToolName: string | null = null;
    let currentNeedsApproval: boolean | null = null;
    
    for (const part of parts) {
        if (isFileOperation(part)) {
            const toolPart = part as WaveUIMessagePart & { type: "data-tooluse" };
            const toolName = toolPart.data.toolname;
            const needsApproval = toolPart.data.approval === "needs-approval";
            
            if (currentBatch.length === 0) {
                currentBatch.push(toolPart);
                currentToolName = toolName;
                currentNeedsApproval = needsApproval;
            } else if (toolName === currentToolName && needsApproval === currentNeedsApproval) {
                currentBatch.push(toolPart);
            } else {
                if (currentBatch.length > 1) {
                    grouped.push({ type: "batch", parts: currentBatch });
                } else if (currentBatch.length === 1) {
                    grouped.push({ type: "single", part: currentBatch[0] });
                }
                currentBatch = [toolPart];
                currentToolName = toolName;
                currentNeedsApproval = needsApproval;
            }
        } else {
            if (currentBatch.length > 1) {
                grouped.push({ type: "batch", parts: currentBatch });
            } else if (currentBatch.length === 1) {
                grouped.push({ type: "single", part: currentBatch[0] });
            }
            currentBatch = [];
            currentToolName = null;
            currentNeedsApproval = null;
            grouped.push({ type: "single", part });
        }
    }
    
    if (currentBatch.length > 1) {
        grouped.push({ type: "batch", parts: currentBatch });
    } else if (currentBatch.length === 1) {
        grouped.push({ type: "single", part: currentBatch[0] });
    }
    
    return grouped;
};

export const AIMessage = memo(({ message, isStreaming }: AIMessageProps) => {
    const parts = message.parts || [];
    const displayParts = parts.filter(isDisplayPart);
    const fileParts = parts.filter(
        (part): part is WaveUIMessagePart & { type: "data-userfile" } => part.type === "data-userfile"
    );
    const hasContent =
        displayParts.length > 0 &&
        displayParts.some(
            (part) =>
                (part.type === "text" && part.text) || part.type.startsWith("tool-") || part.type === "data-tooluse"
        );

    const showThinkingOnly = !hasContent && isStreaming && message.role === "assistant";
    const showThinkingInline = hasContent && isStreaming && message.role === "assistant";
    
    const groupedParts = groupFileParts(displayParts);

    return (
        <div className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
            <div
                className={cn(
                    "px-2 py-2 rounded-lg",
                    message.role === "user" ? "bg-accent-800 text-white max-w-[calc(100%-20px)]" : null
                )}
            >
                {showThinkingOnly ? (
                    <AIThinking />
                ) : !hasContent && !isStreaming ? (
                    <div className="whitespace-pre-wrap break-words">(no text content)</div>
                ) : (
                    <>
                        {groupedParts.map((group, index: number) => (
                            <div key={index} className={cn(index > 0 && "mt-2")}>
                                {group.type === "batch" ? (
                                    <AIToolUseBatch parts={group.parts} isStreaming={isStreaming} />
                                ) : (
                                    <AIMessagePart part={group.part} role={message.role} isStreaming={isStreaming} />
                                )}
                            </div>
                        ))}
                        {showThinkingInline && (
                            <div className="mt-2">
                                <AIThinking />
                            </div>
                        )}
                    </>
                )}

                {message.role === "user" && <UserMessageFiles fileParts={fileParts} />}
            </div>
        </div>
    );
});

AIMessage.displayName = "AIMessage";
