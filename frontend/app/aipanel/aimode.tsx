// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms, createBlock, getSettingsKeyAtom } from "@/app/store/global";
import { cn, fireAndForget, makeIconClass } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useRef, useState } from "react";
import { getFilteredAIModeConfigs } from "./ai-utils";
import { WaveAIModel } from "./waveai-model";

export const AIModeDropdown = memo(() => {
    const model = WaveAIModel.getInstance();
    const aiMode = useAtomValue(model.currentAIMode);
    const aiModeConfigs = useAtomValue(model.aiModeConfigs);
    const rateLimitInfo = useAtomValue(atoms.waveAIRateLimitInfoAtom);
    const showCloudModes = useAtomValue(getSettingsKeyAtom("waveai:showcloudmodes"));
    const defaultMode = useAtomValue(getSettingsKeyAtom("waveai:defaultmode")) ?? "waveai@balanced";
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const hasPremium = !rateLimitInfo || rateLimitInfo.unknown || rateLimitInfo.preq > 0;

    const { waveProviderConfigs, otherProviderConfigs } = getFilteredAIModeConfigs(
        aiModeConfigs,
        showCloudModes,
        model.inBuilder,
        hasPremium
    );

    const hasBothModeTypes = waveProviderConfigs.length > 0 && otherProviderConfigs.length > 0;

    const handleSelect = (mode: string) => {
        const config = aiModeConfigs[mode];
        if (!config) return;
        if (!hasPremium && config["waveai:premium"]) {
            return;
        }
        model.setAIMode(mode);
        setIsOpen(false);
    };

    let currentMode = aiMode || defaultMode;
    const currentConfig = aiModeConfigs[currentMode];
    if (currentConfig) {
        if (!hasPremium && currentConfig["waveai:premium"]) {
            currentMode = "waveai@quick";
        }
        if (model.inBuilder && hasPremium && currentMode === "waveai@quick") {
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
                <i className={cn(makeIconClass(displayConfig["display:icon"] || "sparkles", false), "text-[10px]")}></i>
                <span className={`text-[11px]`}>
                    {displayConfig["display:name"]}
                </span>
                <i className="fa fa-chevron-down text-[8px]"></i>
            </button>

            {isOpen && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
                    <div className="absolute top-full left-0 mt-1 bg-gray-800 border border-gray-600 rounded shadow-lg z-50 min-w-[280px]">
                        {hasBothModeTypes && (
                            <div className="pt-2 pb-1 text-center text-[10px] text-gray-400 uppercase tracking-wide">
                                Wave AI Cloud
                            </div>
                        )}
                        {waveProviderConfigs.map((config, index) => {
                            const isFirst = index === 0 && !hasBothModeTypes;
                            const isDisabled = !hasPremium && config["waveai:premium"];
                            const isSelected = currentMode === config.mode;
                            return (
                                <button
                                    key={config.mode}
                                    onClick={() => handleSelect(config.mode)}
                                    disabled={isDisabled}
                                    className={`w-full flex flex-col gap-0.5 px-3 ${
                                        isFirst ? "pt-1 pb-0.5" : "pt-0.5 pb-0.5"
                                    } ${
                                        isDisabled
                                            ? "text-gray-500 cursor-not-allowed"
                                            : "text-gray-300 hover:bg-gray-700 cursor-pointer"
                                    } transition-colors text-left`}
                                >
                                    <div className="flex items-center gap-2 w-full">
                                        <i className={makeIconClass(config["display:icon"] || "sparkles", false)}></i>
                                        <span className={`text-sm ${isSelected ? "font-bold" : ""}`}>
                                            {config["display:name"]}
                                            {isDisabled && " (premium)"}
                                        </span>
                                        {isSelected && <i className="fa fa-check ml-auto"></i>}
                                    </div>
                                    {config["display:description"] && (
                                        <div className="text-xs text-muted pl-5" style={{ whiteSpace: "pre-line" }}>
                                            {config["display:description"]}
                                        </div>
                                    )}
                                </button>
                            );
                        })}
                        {hasBothModeTypes && (
                            <div className="border-t border-gray-600 my-2" />
                        )}
                        {hasBothModeTypes && (
                            <div className="pt-0 pb-1 text-center text-[10px] text-gray-400 uppercase tracking-wide">
                                Custom
                            </div>
                        )}
                        {otherProviderConfigs.map((config, index) => {
                            const isFirst = index === 0 && !hasBothModeTypes;
                            const isLast = index === otherProviderConfigs.length - 1;
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
                                        <i className={makeIconClass(config["display:icon"] || "sparkles", false)}></i>
                                        <span className={`text-sm ${isSelected ? "font-bold" : ""}`}>
                                            {config["display:name"]}
                                            {isDisabled && " (premium)"}
                                        </span>
                                        {isSelected && <i className="fa fa-check ml-auto"></i>}
                                    </div>
                                    {config["display:description"] && (
                                        <div className="text-xs text-muted pl-5" style={{ whiteSpace: "pre-line" }}>
                                            {config["display:description"]}
                                        </div>
                                    )}
                                </button>
                            );
                        })}
                        <div className="border-t border-gray-600 my-1" />
                        <button
                            onClick={() => {
                                fireAndForget(async () => {
                                    const blockDef: BlockDef = {
                                        meta: {
                                            view: "waveconfig",
                                            file: "waveai.json",
                                        },
                                    };
                                    await createBlock(blockDef, false, true);
                                    setIsOpen(false);
                                });
                            }}
                            className="w-full flex items-center gap-2 px-3 pt-1 pb-2 text-gray-300 hover:bg-gray-700 cursor-pointer transition-colors text-left"
                        >
                            <i className={makeIconClass("gear", false)}></i>
                            <span className="text-sm">Configure Modes</span>
                        </button>
                    </div>
                </>
            )}
        </div>
    );
});

AIModeDropdown.displayName = "AIModeDropdown";
