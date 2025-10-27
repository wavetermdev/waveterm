// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BuilderFocusManager } from "@/builder/store/builderFocusManager";
import { BuilderCodeTab } from "@/builder/tabs/builder-codetab";
import { BuilderFilesTab } from "@/builder/tabs/builder-filestab";
import { BuilderPreviewTab } from "@/builder/tabs/builder-previewtab";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useState } from "react";

type TabType = "preview" | "files" | "code";

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
    const [activeTab, setActiveTab] = useState<TabType>("preview");
    const focusType = useAtomValue(BuilderFocusManager.getInstance().focusType);
    const isAppFocused = focusType === "app";

    const handleTabClick = (tab: TabType) => {
        setActiveTab(tab);
        BuilderFocusManager.getInstance().setAppFocused();
    };

    return (
        <div className="w-full h-full flex flex-col border-b border-border">
            <div className="flex-shrink-0 border-b border-border">
                <div className="flex">
                    <TabButton
                        label="Preview"
                        tabType="preview"
                        isActive={activeTab === "preview"}
                        isAppFocused={isAppFocused}
                        onClick={() => handleTabClick("preview")}
                    />
                    <TabButton
                        label="Files"
                        tabType="files"
                        isActive={activeTab === "files"}
                        isAppFocused={isAppFocused}
                        onClick={() => handleTabClick("files")}
                    />
                    <TabButton
                        label="Code"
                        tabType="code"
                        isActive={activeTab === "code"}
                        isAppFocused={isAppFocused}
                        onClick={() => handleTabClick("code")}
                    />
                </div>
            </div>
            <div className="flex-1 overflow-auto p-4">
                {activeTab === "preview" && <BuilderPreviewTab />}
                {activeTab === "files" && <BuilderFilesTab />}
                {activeTab === "code" && <BuilderCodeTab />}
            </div>
        </div>
    );
});

BuilderAppPanel.displayName = "BuilderAppPanel";

export { BuilderAppPanel };