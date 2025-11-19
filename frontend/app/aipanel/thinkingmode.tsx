// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms } from "@/app/store/global";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useRef, useState } from "react";
import { WaveAIModel } from "./waveai-model";

type ThinkingMode = "quick" | "balanced" | "deep";

interface ThinkingModeMetadata {
    icon: string;
    name: string;
    desc: string;
    premium: boolean;
}

const ThinkingModeData: Record<ThinkingMode, ThinkingModeMetadata> = {
    quick: {
        icon: "fa-bolt",
        name: "Quick",
        desc: "Fastest responses (gpt-5-mini)",
        premium: false,
    },
    balanced: {
        icon: "fa-sparkles",
        name: "Balanced",
        desc: "Good mix of speed and accuracy\n(gpt-5.1 with minimal thinking)",
        premium: true,
    },
    deep: {
        icon: "fa-lightbulb",
        name: "Deep",
        desc: "Slower but most capable\n(gpt-5.1 with full reasoning)",
        premium: true,
    },
};

export const ThinkingLevelDropdown = memo(() => {
    const model = WaveAIModel.getInstance();
    const thinkingMode = useAtomValue(model.thinkingMode);
    const rateLimitInfo = useAtomValue(atoms.waveAIRateLimitInfoAtom);
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const hasPremium = !rateLimitInfo || rateLimitInfo.unknown || rateLimitInfo.preq > 0;
    const hideQuick = model.inBuilder && hasPremium;

    const handleSelect = (mode: ThinkingMode) => {
        const metadata = ThinkingModeData[mode];
        if (!hasPremium && metadata.premium) {
            return;
        }
        model.setThinkingMode(mode);
        setIsOpen(false);
    };

    let currentMode = (thinkingMode as ThinkingMode) || "balanced";
    const currentMetadata = ThinkingModeData[currentMode];
    if (!hasPremium && currentMetadata.premium) {
        currentMode = "quick";
    }
    if (hideQuick && currentMode === "quick") {
        currentMode = "balanced";
    }

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={cn(
                    "group flex items-center gap-1.5 px-2 py-1 text-xs text-gray-300 hover:text-white rounded transition-colors cursor-pointer border border-gray-600/50",
                    isOpen ? "bg-gray-700" : "bg-gray-800/50 hover:bg-gray-700"
                )}
                title={`Thinking: ${currentMetadata.name}`}
            >
                <i className={`fa ${currentMetadata.icon} text-[10px]`}></i>
                <span className={`text-[11px] ${isOpen ? "inline" : "hidden group-hover:inline @w450:inline"}`}>
                    {currentMetadata.name}
                </span>
                <i className="fa fa-chevron-down text-[8px]"></i>
            </button>

            {isOpen && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
                    <div className="absolute top-full left-0 mt-1 bg-gray-800 border border-gray-600 rounded shadow-lg z-50 min-w-[280px]">
                        {(Object.keys(ThinkingModeData) as ThinkingMode[])
                            .filter((mode) => !(hideQuick && mode === "quick"))
                            .map((mode, index, filteredModes) => {
                                const metadata = ThinkingModeData[mode];
                                const isFirst = index === 0;
                                const isLast = index === filteredModes.length - 1;
                                const isDisabled = !hasPremium && metadata.premium;
                                const isSelected = currentMode === mode;
                                return (
                                    <button
                                        key={mode}
                                        onClick={() => handleSelect(mode)}
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
                                            <i className={`fa ${metadata.icon}`}></i>
                                            <span className={`text-sm ${isSelected ? "font-bold" : ""}`}>
                                                {metadata.name}
                                                {isDisabled && " (premium)"}
                                            </span>
                                            {isSelected && <i className="fa fa-check ml-auto"></i>}
                                        </div>
                                        <div className="text-xs text-muted pl-5" style={{ whiteSpace: "pre-line" }}>
                                            {metadata.desc}
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
