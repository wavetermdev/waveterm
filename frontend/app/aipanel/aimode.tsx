// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Tooltip } from "@/app/element/tooltip";
import { atoms, getSettingsKeyAtom } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn, fireAndForget, makeIconClass } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useRef, useState } from "react";
import { getFilteredAIModeConfigs, getModeDisplayName } from "./ai-utils";
import { WaveAIModel } from "./waveai-model";

interface AIModeMenuItemProps {
    config: AIModeConfigWithMode;
    isSelected: boolean;
    isDisabled: boolean;
    isPremiumDisabled: boolean;
    onClick: () => void;
    isFirst?: boolean;
    isLast?: boolean;
}

const AIModeMenuItem = memo(({ config, isSelected, isDisabled, isPremiumDisabled, onClick, isFirst, isLast }: AIModeMenuItemProps) => {
    return (
        <button
            key={config.mode}
            onClick={onClick}
            disabled={isDisabled}
            className={cn(
                "w-full flex flex-col gap-0.5 px-3 transition-colors text-left",
                isFirst ? "pt-1 pb-0.5" : isLast ? "pt-0.5 pb-1" : "pt-0.5 pb-0.5",
                isDisabled ? "text-zinc-500" : "text-zinc-300 hover:bg-zinc-700 cursor-pointer"
            )}
        >
            <div className="flex items-center gap-2 w-full">
                <i className={makeIconClass(config["display:icon"] || "sparkles", false)}></i>
                <span className={cn("text-sm", isSelected && "font-bold")}>
                    {getModeDisplayName(config)}
                    {isPremiumDisabled && " (premium)"}
                </span>
                {isSelected && <i className="fa fa-check ml-auto"></i>}
            </div>
            {config["display:description"] && (
                <div
                    className={cn("text-xs pl-5", isDisabled ? "text-gray-500" : "text-muted")}
                    style={{ whiteSpace: "pre-line" }}
                >
                    {config["display:description"]}
                </div>
            )}
        </button>
    );
});

AIModeMenuItem.displayName = "AIModeMenuItem";

interface ConfigSection {
    sectionName: string;
    configs: AIModeConfigWithMode[];
    isIncompatible?: boolean;
    noTelemetry?: boolean;
}

function computeCompatibleSections(
    currentMode: string,
    aiModeConfigs: Record<string, AIModeConfigType>,
    waveProviderConfigs: AIModeConfigWithMode[],
    otherProviderConfigs: AIModeConfigWithMode[]
): ConfigSection[] {
    const currentConfig = aiModeConfigs[currentMode];
    const allConfigs = [...waveProviderConfigs, ...otherProviderConfigs];

    if (!currentConfig) {
        return [{ sectionName: "Incompatible Modes", configs: allConfigs, isIncompatible: true }];
    }

    const currentSwitchCompat = currentConfig["ai:switchcompat"] || [];
    const compatibleConfigs: AIModeConfigWithMode[] = [{ ...currentConfig, mode: currentMode }];
    const incompatibleConfigs: AIModeConfigWithMode[] = [];

    if (currentSwitchCompat.length === 0) {
        allConfigs.forEach((config) => {
            if (config.mode !== currentMode) {
                incompatibleConfigs.push(config);
            }
        });
    } else {
        allConfigs.forEach((config) => {
            if (config.mode === currentMode) return;

            const configSwitchCompat = config["ai:switchcompat"] || [];
            const hasMatch = currentSwitchCompat.some((currentTag: string) => configSwitchCompat.includes(currentTag));

            if (hasMatch) {
                compatibleConfigs.push(config);
            } else {
                incompatibleConfigs.push(config);
            }
        });
    }

    const sections: ConfigSection[] = [];
    const compatibleSectionName = compatibleConfigs.length === 1 ? "Current" : "Compatible Modes";
    sections.push({ sectionName: compatibleSectionName, configs: compatibleConfigs });

    if (incompatibleConfigs.length > 0) {
        sections.push({ sectionName: "Incompatible Modes", configs: incompatibleConfigs, isIncompatible: true });
    }

    return sections;
}

function computeWaveCloudSections(
    waveProviderConfigs: AIModeConfigWithMode[],
    otherProviderConfigs: AIModeConfigWithMode[],
    telemetryEnabled: boolean
): ConfigSection[] {
    const sections: ConfigSection[] = [];

    if (waveProviderConfigs.length > 0) {
        sections.push({
            sectionName: "Wave AI Cloud",
            configs: waveProviderConfigs,
            noTelemetry: !telemetryEnabled,
        });
    }
    if (otherProviderConfigs.length > 0) {
        sections.push({ sectionName: "Custom", configs: otherProviderConfigs });
    }

    return sections;
}

interface AIModeDropdownProps {
    compatibilityMode?: boolean;
}

export const AIModeDropdown = memo(({ compatibilityMode = false }: AIModeDropdownProps) => {
    const model = WaveAIModel.getInstance();
    const currentMode = useAtomValue(model.currentAIMode);
    const aiModeConfigs = useAtomValue(model.aiModeConfigs);
    const waveaiModeConfigs = useAtomValue(atoms.waveaiModeConfigAtom);
    const widgetContextEnabled = useAtomValue(model.widgetAccessAtom);
    const hasPremium = useAtomValue(model.hasPremiumAtom);
    const showCloudModes = useAtomValue(getSettingsKeyAtom("waveai:showcloudmodes"));
    const telemetryEnabled = useAtomValue(getSettingsKeyAtom("telemetry:enabled")) ?? false;
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const { waveProviderConfigs, otherProviderConfigs } = getFilteredAIModeConfigs(
        aiModeConfigs,
        showCloudModes,
        model.inBuilder,
        hasPremium,
        currentMode
    );

    const sections: ConfigSection[] = compatibilityMode
        ? computeCompatibleSections(currentMode, aiModeConfigs, waveProviderConfigs, otherProviderConfigs)
        : computeWaveCloudSections(waveProviderConfigs, otherProviderConfigs, telemetryEnabled);

    const showSectionHeaders = compatibilityMode || sections.length > 1;

    const handleSelect = (mode: string) => {
        const config = aiModeConfigs[mode];
        if (!config) return;
        if (!hasPremium && config["waveai:premium"]) {
            return;
        }
        model.setAIMode(mode);
        setIsOpen(false);
    };

    const displayConfig = aiModeConfigs[currentMode];
    const displayName = displayConfig ? getModeDisplayName(displayConfig) : `Invalid (${currentMode})`;
    const displayIcon = displayConfig ? displayConfig["display:icon"] || "sparkles" : "question";
    const resolvedConfig = waveaiModeConfigs[currentMode];
    const hasToolsSupport = resolvedConfig && resolvedConfig["ai:capabilities"]?.includes("tools");
    const showNoToolsWarning = widgetContextEnabled && resolvedConfig && !hasToolsSupport;

    const handleNewChatClick = () => {
        model.clearChat();
        setIsOpen(false);
    };

    const handleConfigureClick = () => {
        fireAndForget(async () => {
            RpcApi.RecordTEventCommand(
                TabRpcClient,
                {
                    event: "action:other",
                    props: {
                        "action:type": "waveai:configuremodes:contextmenu",
                    },
                },
                { noresponse: true }
            );
            await model.openWaveAIConfig();
            setIsOpen(false);
        });
    };

    const handleEnableTelemetry = () => {
        fireAndForget(async () => {
            await RpcApi.WaveAIEnableTelemetryCommand(TabRpcClient);
            setTimeout(() => {
                model.focusInput();
            }, 100);
        });
    };

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={cn(
                    "group flex items-center gap-1.5 px-2 py-1 text-xs text-gray-300 hover:text-white rounded transition-colors cursor-pointer border border-gray-600/50",
                    isOpen ? "bg-zinc-700" : "bg-zinc-800/50 hover:bg-zinc-700"
                )}
                title={`AI Mode: ${displayName}`}
            >
                <i className={cn(makeIconClass(displayIcon, false), "text-[10px]")}></i>
                <span className={`text-[11px]`}>{displayName}</span>
                <i className="fa fa-chevron-down text-[8px]"></i>
            </button>

            {showNoToolsWarning && (
                <Tooltip
                    content={
                        <div className="max-w-xs">
                            Warning: This custom mode was configured without the "tools" capability in the
                            "ai:capabilities" array. Without tool support, Wave AI will not be able to interact with
                            widgets or files.
                        </div>
                    }
                    placement="bottom"
                >
                    <div className="flex items-center gap-1 text-[10px] text-yellow-600 mt-1 ml-1 cursor-default">
                        <i className="fa fa-triangle-exclamation"></i>
                        <span>No Tools Support</span>
                    </div>
                </Tooltip>
            )}

            {isOpen && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
                    <div className="absolute top-full left-0 mt-1 bg-zinc-800 border border-zinc-600 rounded shadow-lg z-50 min-w-[280px]">
                        {sections.map((section, sectionIndex) => {
                            const isFirstSection = sectionIndex === 0;
                            const isLastSection = sectionIndex === sections.length - 1;

                            return (
                                <div key={section.sectionName}>
                                    {!isFirstSection && <div className="border-t border-gray-600 my-2" />}
                                    {showSectionHeaders && (
                                        <>
                                            <div
                                                className={cn(
                                                    "pb-1 text-center text-[10px] text-gray-400 uppercase tracking-wide",
                                                    isFirstSection ? "pt-2" : "pt-0"
                                                )}
                                            >
                                                {section.sectionName}
                                            </div>
                                            {section.isIncompatible && (
                                                <div className="text-center text-[11px] text-red-300 pb-1">
                                                    (Start a New Chat to Switch)
                                                </div>
                                            )}
                                            {section.noTelemetry && (
                                                <button
                                                    onClick={handleEnableTelemetry}
                                                    className="text-center text-[11px] text-green-300 hover:text-green-200 pb-1 cursor-pointer transition-colors w-full"
                                                >
                                                    (enable telemetry to unlock Wave AI Cloud)
                                                </button>
                                            )}
                                        </>
                                    )}
                                    {section.configs.map((config, index) => {
                                        const isFirst = index === 0 && isFirstSection && !showSectionHeaders;
                                        const isLast = index === section.configs.length - 1 && isLastSection;
                                        const isPremiumDisabled = !hasPremium && config["waveai:premium"];
                                        const isIncompatibleDisabled = section.isIncompatible || false;
                                        const isTelemetryDisabled = section.noTelemetry || false;
                                        const isDisabled =
                                            isPremiumDisabled || isIncompatibleDisabled || isTelemetryDisabled;
                                        const isSelected = currentMode === config.mode;
                                        return (
                                            <AIModeMenuItem
                                                key={config.mode}
                                                config={config}
                                                isSelected={isSelected}
                                                isDisabled={isDisabled}
                                                isPremiumDisabled={isPremiumDisabled}
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
                            onClick={handleNewChatClick}
                            className="w-full flex items-center gap-2 px-3 pt-1 pb-1 text-gray-300 hover:bg-zinc-700 cursor-pointer transition-colors text-left"
                        >
                            <i className={makeIconClass("plus", false)}></i>
                            <span className="text-sm">New Chat</span>
                        </button>
                        <button
                            onClick={handleConfigureClick}
                            className="w-full flex items-center gap-2 px-3 pt-1 pb-2 text-gray-300 hover:bg-zinc-700 cursor-pointer transition-colors text-left"
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
