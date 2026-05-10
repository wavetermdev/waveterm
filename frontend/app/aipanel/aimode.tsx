// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Tooltip } from "@/app/element/tooltip";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn, fireAndForget, makeIconClass, sortByDisplayOrder } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useMemo, useRef, useState } from "react";
import { WaveAIModel } from "./waveai-model";

interface AIModeMenuItemProps {
    modeKey: string;
    config: AIModeConfigType;
    isSelected: boolean;
    onClick: () => void;
}

const AIModeMenuItem = memo(({ modeKey, config, isSelected, onClick }: AIModeMenuItemProps) => {
    const color = config["display:color"];
    return (
        <button
            key={modeKey}
            onClick={onClick}
            className="w-full flex flex-col gap-0.5 px-3 py-1 transition-colors text-left text-zinc-300 hover:bg-zinc-700 cursor-pointer"
        >
            <div className="flex items-center gap-2 w-full">
                <i
                    className={makeIconClass(config["display:icon"] || "sparkles", false)}
                    style={color ? { color } : undefined}
                ></i>
                <span className={cn("text-sm", isSelected && "font-bold")} style={color ? { color } : undefined}>
                    {config["display:name"] || modeKey}
                </span>
                {isSelected && <i className="fa fa-check ml-auto"></i>}
            </div>
            {config["display:description"] && (
                <div className="text-xs pl-5 text-muted" style={{ whiteSpace: "pre-line" }}>
                    {config["display:description"]}
                </div>
            )}
        </button>
    );
});
AIModeMenuItem.displayName = "AIModeMenuItem";

interface AIModeDropdownProps {
    compatibilityMode?: boolean;
}

export const AIModeDropdown = memo((_props: AIModeDropdownProps) => {
    const model = WaveAIModel.getInstance();
    const currentMode = useAtomValue(model.currentAIMode);
    const aiModeConfigs = useAtomValue(model.aiModeConfigs);
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const modeEntries = useMemo(() => {
        if (aiModeConfigs == null) return [];
        return Object.entries(aiModeConfigs)
            .map(([key, cfg]) => ({ key, ...cfg }))
            .sort(sortByDisplayOrder);
    }, [aiModeConfigs]);

    const handleSelect = (key: string) => {
        model.setAIMode(key);
        setIsOpen(false);
    };

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
                    props: { "action:type": "waveai:configuremodes:contextmenu" },
                },
                { noresponse: true }
            );
            await model.openWaveAIConfig();
            setIsOpen(false);
        });
    };

    const displayConfig = aiModeConfigs?.[currentMode];
    const displayName = displayConfig?.["display:name"] || `Invalid (${currentMode})`;
    const displayIcon = displayConfig?.["display:icon"] || "question";
    const displayColor = displayConfig?.["display:color"];

    return (
        <div className="relative" ref={dropdownRef}>
            <Tooltip content={`AI Mode: ${displayName}`} placement="bottom">
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    className={cn(
                        "flex items-center gap-1.5 px-2 py-1 text-xs hover:text-white rounded transition-colors cursor-pointer border",
                        isOpen ? "bg-zinc-700" : "bg-zinc-800/50 hover:bg-zinc-700"
                    )}
                    style={{
                        borderColor: displayColor ? displayColor : "rgb(75 85 99 / 0.5)",
                        color: displayColor ?? "#d4d4d8",
                    }}
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
                            Mode
                        </div>
                        {modeEntries.length === 0 && (
                            <div className="px-3 py-2 text-xs text-zinc-500">No modes configured</div>
                        )}
                        {modeEntries.map(({ key, ...cfg }) => (
                            <AIModeMenuItem
                                key={key}
                                modeKey={key}
                                config={cfg}
                                isSelected={currentMode === key}
                                onClick={() => handleSelect(key)}
                            />
                        ))}
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
