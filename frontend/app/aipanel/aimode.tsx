// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms } from "@/app/store/global";
import { cn, makeIconClass } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useRef, useState } from "react";
import { WaveAIModel } from "./waveai-model";

export const AIModeDropdown = memo(() => {
    const model = WaveAIModel.getInstance();
    const aiMode = useAtomValue(model.currentAIMode);
    const aiModeConfigs = useAtomValue(model.aiModeConfigs);
    const rateLimitInfo = useAtomValue(atoms.waveAIRateLimitInfoAtom);
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const hasPremium = !rateLimitInfo || rateLimitInfo.unknown || rateLimitInfo.preq > 0;
    const hideQuick = model.inBuilder && hasPremium;

    const sortedConfigs = Object.entries(aiModeConfigs)
        .map(([mode, config]) => ({ mode, ...config }))
        .sort((a, b) => {
            const orderDiff = (a["display:order"] || 0) - (b["display:order"] || 0);
            if (orderDiff !== 0) return orderDiff;
            return (a["display:name"] || "").localeCompare(b["display:name"] || "");
        })
        .filter((config) => !(hideQuick && config.mode === "waveai@quick"));

    const handleSelect = (mode: string) => {
        const config = aiModeConfigs[mode];
        if (!config) return;
        if (!hasPremium && config["waveai:premium"]) {
            return;
        }
        model.setAIMode(mode);
        setIsOpen(false);
    };

    let currentMode = aiMode || "waveai@balanced";
    const currentConfig = aiModeConfigs[currentMode];
    if (currentConfig) {
        if (!hasPremium && currentConfig["waveai:premium"]) {
            currentMode = "waveai@quick";
        }
        if (hideQuick && currentMode === "waveai@quick") {
            currentMode = "waveai@balanced";
        }
    }

    const displayConfig = aiModeConfigs[currentMode] || {
        "display:name": "? Unknown",
        "display:icon": "question",
    };

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={cn(
                    "group flex items-center gap-1.5 px-2 py-1 text-xs text-gray-300 hover:text-white rounded transition-colors cursor-pointer border border-gray-600/50",
                    isOpen ? "bg-gray-700" : "bg-gray-800/50 hover:bg-gray-700"
                )}
                title={`AI Mode: ${displayConfig["display:name"]}`}
            >
                <i className={cn(makeIconClass(displayConfig["display:icon"], false), "text-[10px]")}></i>
                <span className={`text-[11px] ${isOpen ? "inline" : "hidden group-hover:inline @w450:inline"}`}>
                    {displayConfig["display:name"]}
                </span>
                <i className="fa fa-chevron-down text-[8px]"></i>
            </button>

            {isOpen && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
                    <div className="absolute top-full left-0 mt-1 bg-gray-800 border border-gray-600 rounded shadow-lg z-50 min-w-[280px]">
                        {sortedConfigs.map((config, index) => {
                            const isFirst = index === 0;
                            const isLast = index === sortedConfigs.length - 1;
                            const isDisabled = !hasPremium && config["waveai:premium"];
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
                                        <i className={makeIconClass(config["display:icon"], false)}></i>
                                        <span className={`text-sm ${isSelected ? "font-bold" : ""}`}>
                                            {config["display:name"]}
                                            {isDisabled && " (premium)"}
                                        </span>
                                        {isSelected && <i className="fa fa-check ml-auto"></i>}
                                    </div>
                                    <div className="text-xs text-muted pl-5" style={{ whiteSpace: "pre-line" }}>
                                        {config["display:description"]}
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

AIModeDropdown.displayName = "AIModeDropdown";
