// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockModel } from "@/app/block/block-model";
import { cn, fireAndForget } from "@/util/util";
import { memo, useEffect, useRef, useState } from "react";
import { WaveUIMessagePart } from "./aitypes";
import { WaveAIModel } from "./waveai-model";

function getEffectiveApprovalStatus(baseApproval: string, isStreaming: boolean): string {
    return !isStreaming && baseApproval === "needs-approval" ? "timeout" : baseApproval;
}

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
    parts: Array<WaveUIMessagePart & { type: "data-tooluse" }>;
    isStreaming: boolean;
}

const AIToolUseBatch = memo(({ parts, isStreaming }: AIToolUseBatchProps) => {
    const [userApprovalOverride, setUserApprovalOverride] = useState<string | null>(null);

    // All parts in a batch have the same approval status (enforced by grouping logic in AIToolUseGroup)
    const firstTool = parts[0].data;
    const baseApproval = userApprovalOverride || firstTool.approval;
    const effectiveApproval = getEffectiveApprovalStatus(baseApproval, isStreaming);

    useEffect(() => {
        if (!isStreaming || effectiveApproval !== "needs-approval") return;

        const interval = setInterval(() => {
            parts.forEach((part) => {
                WaveAIModel.getInstance().toolUseKeepalive(part.data.toolcallid);
            });
        }, 4000);

        return () => clearInterval(interval);
    }, [isStreaming, effectiveApproval, parts]);

    const handleApprove = () => {
        setUserApprovalOverride("user-approved");
        parts.forEach((part) => {
            WaveAIModel.getInstance().toolUseSendApproval(part.data.toolcallid, "user-approved");
        });
    };

    const handleDeny = () => {
        setUserApprovalOverride("user-denied");
        parts.forEach((part) => {
            WaveAIModel.getInstance().toolUseSendApproval(part.data.toolcallid, "user-denied");
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
                {effectiveApproval === "needs-approval" && (
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
    const highlightTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const highlightedBlockIdRef = useRef<string | null>(null);

    const statusIcon = toolData.status === "completed" ? "✓" : toolData.status === "error" ? "✗" : "•";
    const statusColor =
        toolData.status === "completed" ? "text-success" : toolData.status === "error" ? "text-error" : "text-gray-400";

    const baseApproval = userApprovalOverride || toolData.approval;
    const effectiveApproval = getEffectiveApprovalStatus(baseApproval, isStreaming);

    const isFileWriteTool = toolData.toolname === "write_text_file" || toolData.toolname === "edit_text_file";

    useEffect(() => {
        if (!isStreaming || effectiveApproval !== "needs-approval") return;

        const interval = setInterval(() => {
            WaveAIModel.getInstance().toolUseKeepalive(toolData.toolcallid);
        }, 4000);

        return () => clearInterval(interval);
    }, [isStreaming, effectiveApproval, toolData.toolcallid]);

    useEffect(() => {
        return () => {
            if (highlightTimeoutRef.current) {
                clearTimeout(highlightTimeoutRef.current);
            }
        };
    }, []);

    const handleApprove = () => {
        setUserApprovalOverride("user-approved");
        WaveAIModel.getInstance().toolUseSendApproval(toolData.toolcallid, "user-approved");
    };

    const handleDeny = () => {
        setUserApprovalOverride("user-denied");
        WaveAIModel.getInstance().toolUseSendApproval(toolData.toolcallid, "user-denied");
    };

    const handleMouseEnter = () => {
        if (!toolData.blockid) return;

        if (highlightTimeoutRef.current) {
            clearTimeout(highlightTimeoutRef.current);
        }

        highlightedBlockIdRef.current = toolData.blockid;
        BlockModel.getInstance().setBlockHighlight({
            blockId: toolData.blockid,
            icon: "sparkles",
        });

        highlightTimeoutRef.current = setTimeout(() => {
            if (highlightedBlockIdRef.current === toolData.blockid) {
                BlockModel.getInstance().setBlockHighlight(null);
                highlightedBlockIdRef.current = null;
            }
        }, 2000);
    };

    const handleMouseLeave = () => {
        if (!toolData.blockid) return;

        if (highlightTimeoutRef.current) {
            clearTimeout(highlightTimeoutRef.current);
            highlightTimeoutRef.current = null;
        }

        if (highlightedBlockIdRef.current === toolData.blockid) {
            BlockModel.getInstance().setBlockHighlight(null);
            highlightedBlockIdRef.current = null;
        }
    };

    const handleOpenDiff = () => {
        fireAndForget(() => WaveAIModel.getInstance().openDiff(toolData.inputfilename, toolData.toolcallid));
    };

    return (
        <div
            className={cn("flex items-start gap-2 p-2 rounded bg-gray-800 border border-gray-700", statusColor)}
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
            {isFileWriteTool && toolData.inputfilename && (
                <button
                    onClick={handleOpenDiff}
                    className="flex-shrink-0 px-2 py-1 border border-gray-600 hover:border-gray-500 hover:bg-gray-700 rounded cursor-pointer transition-colors flex items-center gap-1.5 text-gray-400"
                    title="Open in diff viewer"
                >
                    <span className="text-sm">Show Diff</span>
                    <i className="fa fa-arrow-up-right-from-square text-sm"></i>
                </button>
            )}
        </div>
    );
});

AIToolUse.displayName = "AIToolUse";

interface AIToolUseGroupProps {
    parts: Array<WaveUIMessagePart & { type: "data-tooluse" }>;
    isStreaming: boolean;
}

type ToolGroupItem =
    | { type: "batch"; parts: Array<WaveUIMessagePart & { type: "data-tooluse" }> }
    | { type: "single"; part: WaveUIMessagePart & { type: "data-tooluse" } };

export const AIToolUseGroup = memo(({ parts, isStreaming }: AIToolUseGroupProps) => {
    const isFileOp = (part: WaveUIMessagePart & { type: "data-tooluse" }) => {
        const toolName = part.data?.toolname;
        return toolName === "read_text_file" || toolName === "read_dir";
    };

    const needsApproval = (part: WaveUIMessagePart & { type: "data-tooluse" }) => {
        return getEffectiveApprovalStatus(part.data?.approval, isStreaming) === "needs-approval";
    };

    const readFileNeedsApproval: Array<WaveUIMessagePart & { type: "data-tooluse" }> = [];
    const readFileOther: Array<WaveUIMessagePart & { type: "data-tooluse" }> = [];

    for (const part of parts) {
        if (isFileOp(part)) {
            if (needsApproval(part)) {
                readFileNeedsApproval.push(part);
            } else {
                readFileOther.push(part);
            }
        }
    }

    const groupedItems: ToolGroupItem[] = [];
    let addedApprovalBatch = false;
    let addedOtherBatch = false;

    for (const part of parts) {
        const isFileOpPart = isFileOp(part);
        const partNeedsApproval = needsApproval(part);

        if (isFileOpPart && partNeedsApproval && !addedApprovalBatch) {
            groupedItems.push({ type: "batch", parts: readFileNeedsApproval });
            addedApprovalBatch = true;
        } else if (isFileOpPart && !partNeedsApproval && !addedOtherBatch) {
            groupedItems.push({ type: "batch", parts: readFileOther });
            addedOtherBatch = true;
        } else if (!isFileOpPart) {
            groupedItems.push({ type: "single", part });
        }
    }

    return (
        <>
            {groupedItems.map((item, idx) =>
                item.type === "batch" ? (
                    <div key={idx} className="mt-2">
                        <AIToolUseBatch parts={item.parts} isStreaming={isStreaming} />
                    </div>
                ) : (
                    <div key={idx} className="mt-2">
                        <AIToolUse part={item.part} isStreaming={isStreaming} />
                    </div>
                )
            )}
        </>
    );
});

AIToolUseGroup.displayName = "AIToolUseGroup";
