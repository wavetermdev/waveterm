// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms } from "@/app/store/global";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useRef, useState } from "react";
import { WaveAIModel } from "./waveai-model";

type ThinkingMode = "quick" | "balanced" | "deep";

export const ThinkingLevelDropdown = memo(() => {
    const model = WaveAIModel.getInstance();
    const thinkingMode = useAtomValue(model.thinkingMode);
    const thinkingModeConfigs = useAtomValue(model.thinkingModeConfigs);
    const rateLimitInfo = useAtomValue(atoms.waveAIRateLimitInfoAtom);
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const hasPremium = !rateLimitInfo || rateLimitInfo.unknown || rateLimitInfo.preq > 0;
    const hideQuick = model.inBuilder && hasPremium;

    const configsMap = thinkingModeConfigs.reduce((acc, config) => {
        acc[config.mode] = config;
        return acc;
    }, {} as Record<string, AIThinkingModeConfig>);

    const handleSelect = (mode: string) => {
        const config = configsMap[mode];
        if (!config) return;
        if (!hasPremium && config.premium) {
            return;
        }
        model.setThinkingMode(mode);
        setIsOpen(false);
    };

    let currentMode = thinkingMode || "balanced";
    const currentConfig = configsMap[currentMode];
    if (!currentConfig) {
        return null;
    }
    if (!hasPremium && currentConfig.premium) {
        currentMode = "quick";
    }
    if (hideQuick && currentMode === "quick") {
        currentMode = "balanced";
    }

    const displayConfig = configsMap[currentMode];
    if (!displayConfig) {
        return null;
    }

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={cn(
                    "group flex items-center gap-1.5 px-2 py-1 text-xs text-gray-300 hover:text-white rounded transition-colors cursor-pointer border border-gray-600/50",
                    isOpen ? "bg-gray-700" : "bg-gray-800/50 hover:bg-gray-700"
                )}
                title={`Thinking: ${displayConfig.displayname}`}
            >
                <i className={`fa ${displayConfig.icon} text-[10px]`}></i>
                <span className={`text-[11px] ${isOpen ? "inline" : "hidden group-hover:inline @w450:inline"}`}>
                    {displayConfig.displayname}
                </span>
                <i className="fa fa-chevron-down text-[8px]"></i>
            </button>

            {isOpen && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
                    <div className="absolute top-full left-0 mt-1 bg-gray-800 border border-gray-600 rounded shadow-lg z-50 min-w-[280px]">
                        {thinkingModeConfigs
                            .filter((config) => !(hideQuick && config.mode === "quick"))
                            .map((config, index, filteredConfigs) => {
                                const isFirst = index === 0;
                                const isLast = index === filteredConfigs.length - 1;
                                const isDisabled = !hasPremium && config.premium;
                                const isSelected = currentMode === config.mode;
                                return (
                                    <button
                                        key={config.mode}
                                        onClick={() => handleSelect(config.mode)}
                                        disabled={isDisabled}
                                        className={`w-full flex flex-col gap-0.5 px-3 ${
                                            isFirst ? "pt-1 pb-0.5" : isLast ? "pt-0.5 pb-1" : "pt-0.5 pb-0.5"
                                        } ${
                                            isDisabled
                                                ? "text-gray-500 cursor-not-allowed"
                                                : "text-gray-300 hover:bg-gray-700 cursor-pointer"
                                        } transition-colors text-left`}
                                    >
                                        <div className="flex items-center gap-2 w-full">
                                            <i className={`fa ${config.icon}`}></i>
                                            <span className={`text-sm ${isSelected ? "font-bold" : ""}`}>
                                                {config.displayname}
                                                {isDisabled && " (premium)"}
                                            </span>
                                            {isSelected && <i className="fa fa-check ml-auto"></i>}
                                        </div>
                                        <div className="text-xs text-muted pl-5" style={{ whiteSpace: "pre-line" }}>
                                            {config.description}
                                        </div>
                                    </button>
                                );
                            })}
                    </div>
                </>
            )}
        </div>
    );
});

ThinkingLevelDropdown.displayName = "ThinkingLevelDropdown";
