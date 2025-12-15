// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo } from "react";
import { formatFileSize, getFileIcon } from "./ai-utils";
import type { WaveAIModel } from "./waveai-model";

interface AIDroppedFilesProps {
    model: WaveAIModel;
}

export const AIDroppedFiles = memo(({ model }: AIDroppedFilesProps) => {
    const droppedFiles = useAtomValue(model.droppedFiles);

    if (droppedFiles.length === 0) {
        return null;
    }

    return (
        <div className="p-2 border-b border-gray-600">
            <div className="flex gap-2 overflow-x-auto pb-1">
                {droppedFiles.map((file) => (
                    <div key={file.id} className="relative bg-zinc-700 rounded-lg p-2 min-w-20 flex-shrink-0 group">
                        <button
                            onClick={() => model.removeFile(file.id)}
                            className="absolute top-1 right-1 w-4 h-4 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                        >
                            <i className="fa fa-times text-xs"></i>
                        </button>

                        <div className="flex flex-col items-center text-center">
                            {file.previewUrl ? (
                                <div className="w-12 h-12 mb-1">
                                    <img
                                        src={file.previewUrl}
                                        alt={file.name}
                                        className="w-full h-full object-cover rounded"
                                    />
                                </div>
                            ) : (
                                <div className="w-12 h-12 mb-1 flex items-center justify-center bg-zinc-600 rounded">
                                    <i
                                        className={cn("fa text-lg text-gray-300", getFileIcon(file.name, file.type))}
                                    ></i>
                                </div>
                            )}

                            <div className="text-[10px] text-gray-200 truncate w-full max-w-16" title={file.name}>
                                {file.name}
                            </div>
                            <div className="text-[9px] text-gray-400">{formatFileSize(file.size)}</div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
});

AIDroppedFiles.displayName = "AIDroppedFiles";
