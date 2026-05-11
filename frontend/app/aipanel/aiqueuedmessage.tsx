// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Tooltip } from "@/element/tooltip";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo } from "react";
import { WaveAIModel } from "./waveai-model";

interface AIQueuedMessageProps {
    model: WaveAIModel;
}

export const AIQueuedMessage = memo(({ model }: AIQueuedMessageProps) => {
    const queued = useAtomValue(model.queuedMessageAtom);

    if (queued == null) {
        return null;
    }

    const text = queued.text || "";
    const fileCount = queued.files.length;
    const displayText = text.length > 80 ? text.slice(0, 80) + "…" : text;

    return (
        <div className="mx-2 mt-2 mb-1">
            <div
                className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-md",
                    "bg-zinc-800/80 border border-accent/30"
                )}
            >
                <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-200 truncate">
                        <span className="text-accent mr-1.5">
                            <i className="fa fa-clock-o text-xs"></i>
                        </span>
                        <span className="italic">{displayText}</span>
                    </div>
                    {fileCount > 0 && (
                        <div className="text-xs text-gray-400 mt-0.5">
                            {fileCount} file{fileCount > 1 ? "s" : ""} attached
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                    <Tooltip content="Edit" placement="top">
                        <button
                            onClick={() => model.editQueuedMessage()}
                            className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:text-accent hover:bg-zinc-700/50 cursor-pointer transition-colors"
                        >
                            <i className="fa fa-pen text-xs"></i>
                        </button>
                    </Tooltip>
                    <Tooltip content="Send Now" placement="top">
                        <button
                            onClick={() => model.sendQueuedMessageNow()}
                            className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:text-green-400 hover:bg-zinc-700/50 cursor-pointer transition-colors"
                        >
                            <i className="fa fa-paper-plane text-xs"></i>
                        </button>
                    </Tooltip>
                    <Tooltip content="Delete" placement="top">
                        <button
                            onClick={() => model.deleteQueuedMessage()}
                            className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:text-red-400 hover:bg-zinc-700/50 cursor-pointer transition-colors"
                        >
                            <i className="fa fa-trash text-xs"></i>
                        </button>
                    </Tooltip>
                </div>
            </div>
        </div>
    );
});

AIQueuedMessage.displayName = "AIQueuedMessage";
