// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Tooltip } from "@/app/element/tooltip";
import { cn, makeIconClass } from "@/util/util";
import { sortByDisplayOrder } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useMemo, useRef, useState } from "react";
import { WaveAIModel } from "./waveai-model";

interface AIModelMenuItemProps {
    modelKey: string;
    config: AIModelConfigType;
    isSelected: boolean;
    onClick: () => void;
}

const AIModelMenuItem = memo(
    ({ modelKey, config, isSelected, onClick }: AIModelMenuItemProps) => {
        return (
            <button
                key={modelKey}
                onClick={onClick}
                className="w-full flex flex-col gap-0.5 px-3 py-1 transition-colors text-left text-zinc-300 hover:bg-zinc-700 cursor-pointer"
            >
                <div className="flex items-center gap-2 w-full">
                    <i className={makeIconClass(config["display:icon"] || "sparkles", false)}></i>
                    <span className={cn("text-sm", isSelected && "font-bold")}>
                        {config["display:name"] || modelKey}
                    </span>
                    {isSelected && <i className="fa fa-check ml-auto"></i>}
                </div>
                {config["display:description"] && (
                    <div className="text-xs pl-5 text-muted">
                        {config["display:description"]}
                    </div>
                )}
            </button>
        );
    }
);
AIModelMenuItem.displayName = "AIModelMenuItem";

export const AIModelDropdown = memo(() => {
    const model = WaveAIModel.getInstance();
    const currentModel = useAtomValue(model.currentAIModel);
    const aiModelConfigs = useAtomValue(model.aiModelConfigs);
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const modelEntries = useMemo(() => {
        if (aiModelConfigs == null) return [];
        return Object.entries(aiModelConfigs)
            .map(([key, cfg]) => ({ key, ...cfg }))
            .sort(sortByDisplayOrder);
    }, [aiModelConfigs]);

    const currentCfg = aiModelConfigs?.[currentModel];
    const displayName = currentCfg?.["display:name"] || currentModel || "Model";
    const displayIcon = currentCfg?.["display:icon"] || "sparkles";

    const handleSelect = (key: string) => {
        model.setAIModel(key);
        setIsOpen(false);
    };

    return (
        <div className="relative" ref={dropdownRef}>
            <Tooltip content="Model" placement="bottom">
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    className={cn(
                        "flex items-center gap-1.5 px-2 py-1 text-xs text-gray-300 hover:text-white rounded transition-colors cursor-pointer border border-gray-600/50",
                        isOpen ? "bg-zinc-700" : "bg-zinc-800/50 hover:bg-zinc-700"
                    )}
                >
                    <i className={cn(makeIconClass(displayIcon, false), "text-[10px]")}></i>
                    <span className="text-[11px]">{displayName}</span>
                    <i className="fa fa-chevron-down text-[8px]"></i>
                </button>
            </Tooltip>

            {isOpen && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
                    <div className="absolute top-full left-0 mt-1 bg-zinc-800 border border-zinc-600 rounded shadow-lg z-50 min-w-[260px]">
                        <div className="pb-1 pt-2 text-center text-[10px] text-gray-400 uppercase tracking-wide">
                            Model
                        </div>
                        {modelEntries.length === 0 && (
                            <div className="px-3 py-2 text-xs text-zinc-500">No models configured</div>
                        )}
                        {modelEntries.map(({ key, ...cfg }) => (
                            <AIModelMenuItem
                                key={key}
                                modelKey={key}
                                config={cfg}
                                isSelected={currentModel === key}
                                onClick={() => handleSelect(key)}
                            />
                        ))}
                    </div>
                </>
            )}
        </div>
    );
});
AIModelDropdown.displayName = "AIModelDropdown";
