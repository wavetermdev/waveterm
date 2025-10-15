// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockModel } from "@/app/block/block-model";
import { WaveStreamdown } from "@/app/element/streamdown";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn } from "@/util/util";
import { memo, useEffect, useState } from "react";
import { getFileIcon } from "./ai-utils";
import { WaveUIMessage, WaveUIMessagePart } from "./aitypes";
import { WaveAIModel } from "./waveai-model";

const AIThinking = memo(({ message = "AI is thinking..." }: { message?: string }) => (
    <div className="flex items-center gap-2">
        <div className="animate-pulse flex items-center">
            <i className="fa fa-circle text-[10px]"></i>
            <i className="fa fa-circle text-[10px] mx-1"></i>
            <i className="fa fa-circle text-[10px]"></i>
        </div>
        {message && <span className="text-sm text-gray-400">{message}</span>}
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

interface AIToolApprovalButtonsProps {
    count: number;
    onApprove: () => void;
    onDeny: () => void;
}

const AIToolApprovalButtons = memo(({ count, onApprove, onDeny }: AIToolApprovalButtonsProps) => {
    const approveText = count > 1 ? `Approve All (${count})` : "Approve";
    const denyText = count > 1 ? "Deny All" : "Deny";

    return (
        <div className="mt-2 flex gap-2">
            <button
                onClick={onApprove}
                className="px-3 py-1 border border-gray-600 text-gray-300 hover:border-gray-500 hover:text-white text-sm rounded cursor-pointer transition-colors"
            >
                {approveText}
            </button>
            <button
                onClick={onDeny}
                className="px-3 py-1 border border-gray-600 text-gray-300 hover:border-gray-500 hover:text-white text-sm rounded cursor-pointer transition-colors"
            >
                {denyText}
            </button>
        </div>
    );
});

AIToolApprovalButtons.displayName = "AIToolApprovalButtons";

interface AIToolUseBatchItemProps {
    part: WaveUIMessagePart & { type: "data-tooluse" };
    effectiveApproval: string;
}

const AIToolUseBatchItem = memo(({ part, effectiveApproval }: AIToolUseBatchItemProps) => {
    const statusIcon = part.data.status === "completed" ? "✓" : part.data.status === "error" ? "✗" : "•";
    const statusColor =
        part.data.status === "completed"
            ? "text-success"
            : part.data.status === "error"
              ? "text-error"
              : "text-gray-400";
    const effectiveErrorMessage = part.data.errormessage || (effectiveApproval === "timeout" ? "Not approved" : null);

    return (
        <div className="text-sm pl-2 flex items-start gap-1.5">
            <span className={cn("font-bold flex-shrink-0", statusColor)}>{statusIcon}</span>
            <div className="flex-1">
                <span className="text-gray-400">{part.data.tooldesc}</span>
                {effectiveErrorMessage && <div className="text-red-300 mt-0.5">{effectiveErrorMessage}</div>}
            </div>
        </div>
    );
});

AIToolUseBatchItem.displayName = "AIToolUseBatchItem";

interface AIToolUseBatchProps {
    parts: Array<WaveUIMessagePart & { type: "data-tooluse" }>; // parts must not be empty
    isStreaming: boolean;
}

const AIToolUseBatch = memo(({ parts, isStreaming }: AIToolUseBatchProps) => {
    const [userApprovalOverride, setUserApprovalOverride] = useState<string | null>(null);

    const firstTool = parts[0].data;
    const baseApproval = userApprovalOverride || firstTool.approval;
    const effectiveApproval = !isStreaming && baseApproval === "needs-approval" ? "timeout" : baseApproval;
    const allNeedApproval = parts.every((p) => (userApprovalOverride || p.data.approval) === "needs-approval");

    useEffect(() => {
        if (!isStreaming || effectiveApproval !== "needs-approval") return;

        const interval = setInterval(() => {
            parts.forEach((part) => {
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
        parts.forEach((part) => {
            RpcApi.WaveAIToolApproveCommand(TabRpcClient, {
                toolcallid: part.data.toolcallid,
                approval: "user-approved",
            });
        });
    };

    const handleDeny = () => {
        setUserApprovalOverride("user-denied");
        parts.forEach((part) => {
            RpcApi.WaveAIToolApproveCommand(TabRpcClient, {
                toolcallid: part.data.toolcallid,
                approval: "user-denied",
            });
        });
    };

    return (
        <div className="flex items-start gap-2 p-2 rounded bg-gray-800 border border-gray-700">
            <div className="flex-1">
                <div className="font-semibold">Reading Files</div>
                <div className="mt-1 space-y-0.5">
                    {parts.map((part, idx) => (
                        <AIToolUseBatchItem key={idx} part={part} effectiveApproval={effectiveApproval} />
                    ))}
                </div>
                {allNeedApproval && effectiveApproval === "needs-approval" && (
                    <AIToolApprovalButtons count={parts.length} onApprove={handleApprove} onDeny={handleDeny} />
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

    const handleMouseEnter = () => {
        if (toolData.blockid) {
            BlockModel.getInstance().setBlockHighlight({
                blockId: toolData.blockid,
                icon: "sparkles",
            });
        }
    };

    const handleMouseLeave = () => {
        if (toolData.blockid) {
            BlockModel.getInstance().setBlockHighlight(null);
        }
    };

    return (
        <div
            className={cn("flex items-start gap-2 p-2 rounded bg-gray-800 border border-gray-700", statusColor, {
                "cursor-pointer": toolData.blockid,
            })}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            <span className="font-bold">{statusIcon}</span>
            <div className="flex-1">
                <div className="font-semibold">{toolData.toolname}</div>
                {toolData.tooldesc && <div className="text-sm text-gray-400">{toolData.tooldesc}</div>}
                {(toolData.errormessage || effectiveApproval === "timeout") && (
                    <div className="text-sm text-red-300 mt-1">{toolData.errormessage || "Not approved"}</div>
                )}
                {effectiveApproval === "needs-approval" && (
                    <AIToolApprovalButtons count={1} onApprove={handleApprove} onDeny={handleDeny} />
                )}
            </div>
        </div>
    );
});

AIToolUse.displayName = "AIToolUse";

interface AIToolUseGroupProps {
    parts: Array<WaveUIMessagePart & { type: "data-tooluse" }>;
    isStreaming: boolean;
}

const AIToolUseGroup = memo(({ parts, isStreaming }: AIToolUseGroupProps) => {
    const isFileOp = (part: WaveUIMessagePart & { type: "data-tooluse" }) => {
        const toolName = part.data?.toolname;
        return toolName === "read_text_file" || toolName === "read_dir";
    };

    const fileOpsNeedApproval: Array<WaveUIMessagePart & { type: "data-tooluse" }> = [];
    const fileOpsNoApproval: Array<WaveUIMessagePart & { type: "data-tooluse" }> = [];
    const otherTools: Array<WaveUIMessagePart & { type: "data-tooluse" }> = [];

    for (const part of parts) {
        if (isFileOp(part)) {
            if (part.data.approval === "needs-approval") {
                fileOpsNeedApproval.push(part);
            } else {
                fileOpsNoApproval.push(part);
            }
        } else {
            otherTools.push(part);
        }
    }

    return (
        <>
            {fileOpsNoApproval.length > 0 && (
                <div className="mt-2">
                    <AIToolUseBatch parts={fileOpsNoApproval} isStreaming={isStreaming} />
                </div>
            )}
            {fileOpsNeedApproval.length > 0 && (
                <div className="mt-2">
                    <AIToolUseBatch parts={fileOpsNeedApproval} isStreaming={isStreaming} />
                </div>
            )}
            {otherTools.map((tool, idx) => (
                <div key={idx} className="mt-2">
                    <AIToolUse part={tool} isStreaming={isStreaming} />
                </div>
            ))}
        </>
    );
});

AIToolUseGroup.displayName = "AIToolUseGroup";

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

const getThinkingMessage = (parts: WaveUIMessagePart[], isStreaming: boolean, role: string): string | null => {
    if (!isStreaming || role !== "assistant") {
        return null;
    }

    // Check if there are any pending-approval tool calls - this takes priority
    const hasPendingApprovals = parts.some(
        (part) => part.type === "data-tooluse" && part.data?.approval === "needs-approval"
    );

    if (hasPendingApprovals) {
        return "Waiting for Tool Approvals...";
    }

    const lastPart = parts[parts.length - 1];

    // Check if the last part is a reasoning part
    if (lastPart?.type === "reasoning") {
        return "AI is thinking...";
    }

    // Only hide thinking indicator if the last part is text and not empty
    // (this means text is actively streaming)
    if (lastPart?.type === "text" && lastPart.text) {
        return null;
    }

    // For all other cases (including finish-step, tooluse, etc.), show dots
    return "";
};

export const AIMessage = memo(({ message, isStreaming }: AIMessageProps) => {
    const parts = message.parts || [];
    const displayParts = parts.filter(isDisplayPart);
    const fileParts = parts.filter(
        (part): part is WaveUIMessagePart & { type: "data-userfile" } => part.type === "data-userfile"
    );

    const thinkingMessage = getThinkingMessage(parts, isStreaming, message.role);
    const groupedParts = groupMessageParts(displayParts);

    return (
        <div className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
            <div
                className={cn(
                    "px-2 rounded-lg [&>*:first-child]:!mt-0",
                    message.role === "user" ? "py-2 bg-accent-800 text-white max-w-[calc(100%-20px)]" : null
                )}
            >
                {displayParts.length === 0 && !isStreaming && !thinkingMessage ? (
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
                        {thinkingMessage != null && (
                            <div className="mt-2">
                                <AIThinking message={thinkingMessage} />
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
