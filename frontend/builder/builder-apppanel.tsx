// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BuilderAppPanelModel, type TabType } from "@/builder/store/builderAppPanelModel";
import { BuilderFocusManager } from "@/builder/store/builderFocusManager";
import { BuilderCodeTab } from "@/builder/tabs/builder-codetab";
import { BuilderFilesTab } from "@/builder/tabs/builder-filestab";
import { BuilderPreviewTab } from "@/builder/tabs/builder-previewtab";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useRef } from "react";

type TabButtonProps = {
    label: string;
    tabType: TabType;
    isActive: boolean;
    isAppFocused: boolean;
    onClick: () => void;
};

const TabButton = memo(({ label, tabType, isActive, isAppFocused, onClick }: TabButtonProps) => {
    return (
        <button
            className={cn(
                "px-4 py-2 text-sm font-medium transition-colors cursor-pointer",
                isActive
                    ? `text-main-text border-b-2 ${isAppFocused ? "border-accent" : "border-gray-500"}`
                    : "text-gray-500 hover:text-secondary border-b-2 border-transparent"
            )}
            onClick={onClick}
        >
            {label}
        </button>
    );
});

TabButton.displayName = "TabButton";

const BuilderAppPanel = memo(() => {
    const model = BuilderAppPanelModel.getInstance();
    const focusElemRef = useRef<HTMLInputElement>(null);
    const activeTab = useAtomValue(model.activeTab);
    const focusType = useAtomValue(BuilderFocusManager.getInstance().focusType);
    const isAppFocused = focusType === "app";

    if (focusElemRef.current) {
        model.setFocusElemRef(focusElemRef.current);
    }

    const handleTabClick = (tab: TabType) => {
        model.setActiveTab(tab);
        BuilderFocusManager.getInstance().setAppFocused();
        model.giveFocus();
    };

    const handlePanelClick = () => {
        BuilderFocusManager.getInstance().setAppFocused();
        model.giveFocus();
    };

    return (
        <div className="w-full h-full flex flex-col border-b border-border" onClick={handlePanelClick}>
            <div key="focuselem" className="h-0 w-0">
                <input
                    type="text"
                    value=""
                    ref={focusElemRef}
                    className="h-0 w-0 opacity-0 pointer-events-none"
                    onChange={() => {}}
                />
            </div>
            <div className="shrink-0 border-b border-border">
                <div className="flex">
                    <TabButton
                        label="Preview"
                        tabType="preview"
                        isActive={activeTab === "preview"}
                        isAppFocused={isAppFocused}
                        onClick={() => handleTabClick("preview")}
                    />
                    <TabButton
                        label="Code"
                        tabType="code"
                        isActive={activeTab === "code"}
                        isAppFocused={isAppFocused}
                        onClick={() => handleTabClick("code")}
                    />
                    <TabButton
                        label="Static Files"
                        tabType="files"
                        isActive={activeTab === "files"}
                        isAppFocused={isAppFocused}
                        onClick={() => handleTabClick("files")}
                    />
                </div>
            </div>
            <div className="flex-1 overflow-auto py-1">
                <div className="w-full h-full" style={{ display: activeTab === "preview" ? "block" : "none" }}>
                    <BuilderPreviewTab />
                </div>
                <div className="w-full h-full" style={{ display: activeTab === "code" ? "block" : "none" }}>
                    <BuilderCodeTab />
                </div>
                <div className="w-full h-full" style={{ display: activeTab === "files" ? "block" : "none" }}>
                    <BuilderFilesTab />
                </div>
            </div>
        </div>
    );
});

BuilderAppPanel.displayName = "BuilderAppPanel";

export { BuilderAppPanel };
