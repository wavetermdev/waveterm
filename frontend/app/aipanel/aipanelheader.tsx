// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { handleWaveAIContextMenu } from "@/app/aipanel/aipanel-contextmenu";
import { memo } from "react";

export const AIPanelHeader = memo(() => {
    const handleKebabClick = (e: React.MouseEvent) => {
        handleWaveAIContextMenu(e, false);
    };

    const handleContextMenu = (e: React.MouseEvent) => {
        handleWaveAIContextMenu(e, false);
    };

    return (
        <div
            className="py-1 pl-3 pr-1 border-b border-gray-600 flex items-center justify-between min-w-0"
            onContextMenu={handleContextMenu}
        >
            <h2 className="text-white text-[11px] font-bold flex items-center gap-2 flex-shrink-0 whitespace-nowrap">
                <i className="fa fa-sparkles text-accent"></i>
                Assistant
            </h2>

            <div className="flex items-center flex-shrink-0 whitespace-nowrap">
                <button
                    onClick={handleKebabClick}
                    className="text-gray-400 hover:text-white cursor-pointer transition-colors p-1 rounded flex-shrink-0 ml-2 focus:outline-none"
                    title="More options"
                >
                    <i className="fa fa-ellipsis-vertical"></i>
                </button>
            </div>
        </div>
    );
});

AIPanelHeader.displayName = "AIPanelHeader";
