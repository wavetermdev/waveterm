// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { handleWaveAIContextMenu } from "@/app/aipanel/aipanel-contextmenu";
import { ToggleControl } from "@/app/element/settings/toggle-control";
import { useAtomValue } from "jotai";
import { memo, useCallback } from "react";
import { WaveAIModel } from "./waveai-model";

export const AIPanelHeader = memo(() => {
    const model = WaveAIModel.getInstance();
    const widgetAccess = useAtomValue(model.widgetAccessAtom);

    const handleKebabClick = (e: React.MouseEvent) => {
        handleWaveAIContextMenu(e, false);
    };

    const handleContextMenu = (e: React.MouseEvent) => {
        handleWaveAIContextMenu(e, false);
    };

    const handleWidgetToggle = useCallback(
        (value: boolean) => {
            model.setWidgetAccess(value);
            setTimeout(() => {
                model.focusInput();
            }, 0);
        },
        [model]
    );

    return (
        <div
            className="py-2 pl-3 pr-1 @xs:p-2 @xs:pl-4 border-b border-border flex items-center justify-between min-w-0"
            onContextMenu={handleContextMenu}
        >
            <h2 className="text-primary text-sm @xs:text-lg font-semibold flex items-center gap-2 flex-shrink-0 whitespace-nowrap">
                <i className="fa fa-sparkles text-accent"></i>
                Wave AI
            </h2>

            <div className="flex items-center flex-shrink-0 whitespace-nowrap">
                <div className="flex items-center text-sm whitespace-nowrap gap-2">
                    <span className="text-secondary @xs:hidden text-[12px]">Context</span>
                    <span className="text-secondary hidden @xs:inline text-[12px]">Widget Context</span>
                    <ToggleControl value={widgetAccess} onChange={handleWidgetToggle} />
                </div>

                <button
                    onClick={handleKebabClick}
                    className="text-muted hover:text-primary cursor-pointer transition-colors p-1 rounded flex-shrink-0 ml-2 focus:outline-none"
                    title="More options"
                >
                    <i className="fa fa-ellipsis-vertical"></i>
                </button>
            </div>
        </div>
    );
});

AIPanelHeader.displayName = "AIPanelHeader";
