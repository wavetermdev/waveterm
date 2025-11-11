// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useAtomValue } from "jotai";
import { memo, useRef, useState } from "react";
import { WaveAIModel } from "./waveai-model";

type ThinkingMode = "quick" | "balanced" | "deep";

interface ThinkingModeMetadata {
    icon: string;
    name: string;
    desc: string;
}

const ThinkingModeData: Record<ThinkingMode, ThinkingModeMetadata> = {
    quick: {
        icon: "fa-bolt",
        name: "Quick",
        desc: "Fastest responses (gpt-5-mini)",
    },
    balanced: {
        icon: "fa-sparkles",
        name: "Balanced",
        desc: "Good mix of speed and accuracy\n(gpt-5 with minimal thinking)",
    },
    deep: {
        icon: "fa-lightbulb",
        name: "Deep",
        desc: "Slower but most capable\n(gpt-5 with full reasoning)",
    },
};

export const ThinkingLevelDropdown = memo(() => {
    const model = WaveAIModel.getInstance();
    const thinkingMode = useAtomValue(model.thinkingMode);
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const handleSelect = (mode: ThinkingMode) => {
        model.setThinkingMode(mode);
        setIsOpen(false);
    };

    const currentMode = (thinkingMode as ThinkingMode) || "balanced";
    const currentMetadata = ThinkingModeData[currentMode];

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-300 hover:text-white bg-gray-800/50 hover:bg-gray-700/50 rounded transition-colors cursor-pointer border border-gray-600/50"
                title={`Thinking: ${currentMetadata.name}`}
            >
                <i className={`fa ${currentMetadata.icon} text-[10px]`}></i>
                <span className="text-[11px]">{currentMetadata.name}</span>
                <i className="fa fa-chevron-down text-[8px]"></i>
            </button>

            {isOpen && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
                    <div className="absolute top-full right-0 mt-1 bg-gray-800 border border-gray-600 rounded shadow-lg z-50 min-w-[280px]">
                        {(Object.keys(ThinkingModeData) as ThinkingMode[]).map((mode, index) => {
                            const metadata = ThinkingModeData[mode];
                            const isLast = index === Object.keys(ThinkingModeData).length - 1;
                            return (
                                <button
                                    key={mode}
                                    onClick={() => handleSelect(mode)}
                                    className={`w-full flex flex-col gap-0.5 px-3 pt-1.5 ${isLast ? "pb-1.5" : ""} text-gray-300 hover:bg-gray-700 transition-colors cursor-pointer text-left`}
                                >
                                    <div className="flex items-center gap-2 w-full">
                                        <i className={`fa ${metadata.icon}`}></i>
                                        <span className={`text-sm ${thinkingMode === mode ? "font-bold" : ""}`}>
                                            {metadata.name}
                                        </span>
                                        {thinkingMode === mode && <i className="fa fa-check ml-auto"></i>}
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
