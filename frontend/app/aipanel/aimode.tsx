// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms, getSettingsKeyAtom } from "@/app/store/global";
import { cn, fireAndForget, makeIconClass } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useRef, useState } from "react";
import { getFilteredAIModeConfigs } from "./ai-utils";
import { WaveAIModel } from "./waveai-model";

interface AIModeMenuItemProps {
    config: any;
    isSelected: boolean;
    isDisabled: boolean;
    onClick: () => void;
    isFirst?: boolean;
    isLast?: boolean;
}

const AIModeMenuItem = memo(({ config, isSelected, isDisabled, onClick, isFirst, isLast }: AIModeMenuItemProps) => {
    return (
        <button
            key={config.mode}
            onClick={onClick}
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
});

AIModeMenuItem.displayName = "AIModeMenuItem";

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

    interface ConfigSection {
        sectionName: string;
        configs: any[];
    }

    const sections: ConfigSection[] = [];
    if (waveProviderConfigs.length > 0) {
        sections.push({ sectionName: "Wave AI Cloud", configs: waveProviderConfigs });
    }
    if (otherProviderConfigs.length > 0) {
        sections.push({ sectionName: "Custom", configs: otherProviderConfigs });
    }

    const showSectionHeaders = sections.length > 1;

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

    const handleConfigureClick = () => {
        fireAndForget(async () => {
            await model.openWaveAIConfig();
            setIsOpen(false);
        });
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
                        {sections.map((section, sectionIndex) => {
                            const isFirstSection = sectionIndex === 0;
                            const isLastSection = sectionIndex === sections.length - 1;
                            
                            return (
                                <div key={section.sectionName}>
                                    {!isFirstSection && <div className="border-t border-gray-600 my-2" />}
                                    {showSectionHeaders && (
                                        <div className={`${isFirstSection ? "pt-2" : "pt-0"} pb-1 text-center text-[10px] text-gray-400 uppercase tracking-wide`}>
                                            {section.sectionName}
                                        </div>
                                    )}
                                    {section.configs.map((config, index) => {
                                        const isFirst = index === 0 && isFirstSection && !showSectionHeaders;
                                        const isLast = index === section.configs.length - 1 && isLastSection;
                                        const isDisabled = !hasPremium && config["waveai:premium"];
                                        const isSelected = currentMode === config.mode;
                                        return (
                                            <AIModeMenuItem
                                                key={config.mode}
                                                config={config}
                                                isSelected={isSelected}
                                                isDisabled={isDisabled}
                                                onClick={() => handleSelect(config.mode)}
                                                isFirst={isFirst}
                                                isLast={isLast}
                                            />
                                        );
                                    })}
                                </div>
                            );
                        })}
                        <div className="border-t border-gray-600 my-1" />
                        <button
                            onClick={handleConfigureClick}
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
