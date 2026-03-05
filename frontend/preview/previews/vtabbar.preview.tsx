// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { VTabBar, VTabItem } from "@/app/tab/vtabbar";
import { useState } from "react";

const InitialTabs: VTabItem[] = [
    { id: "vtab-1", name: "Terminal" },
    { id: "vtab-2", name: "Build Logs", indicator: { icon: "bell", color: "#f59e0b" } },
    { id: "vtab-3", name: "Deploy" },
    { id: "vtab-4", name: "Wave AI" },
    { id: "vtab-5", name: "A Very Long Tab Name To Show Truncation" },
];

export function VTabBarPreview() {
    const [tabs, setTabs] = useState<VTabItem[]>(InitialTabs);
    const [activeTabId, setActiveTabId] = useState<string>(InitialTabs[0].id);
    const [width, setWidth] = useState<number>(220);

    const handleCloseTab = (tabId: string) => {
        setTabs((prevTabs) => {
            const nextTabs = prevTabs.filter((tab) => tab.id !== tabId);
            if (activeTabId === tabId && nextTabs.length > 0) {
                setActiveTabId(nextTabs[0].id);
            }
            return nextTabs;
        });
    };

    return (
        <div className="flex w-full max-w-[900px] gap-6 px-6">
            <div className="w-[300px] shrink-0 rounded-md border border-border bg-panel p-4">
                <div className="mb-3 text-xs text-muted">Width: {width}px</div>
                <input
                    type="range"
                    min={100}
                    max={400}
                    value={width}
                    onChange={(event) => setWidth(Number(event.target.value))}
                    className="w-full cursor-pointer"
                />
                <p className="mt-3 text-xs text-muted">
                    Drag tabs to reorder. Names, indicators, and close buttons remain single-line.
                </p>
            </div>
            <div className="h-[360px] rounded-md border border-border bg-background">
                <VTabBar
                    tabs={tabs}
                    activeTabId={activeTabId}
                    width={width}
                    onSelectTab={setActiveTabId}
                    onCloseTab={handleCloseTab}
                    onRenameTab={(tabId, newName) => {
                        setTabs((prevTabs) =>
                            prevTabs.map((tab) => (tab.id === tabId ? { ...tab, name: newName } : tab))
                        );
                    }}
                    onReorderTabs={(tabIds) => {
                        setTabs((prevTabs) => {
                            const tabById = new Map(prevTabs.map((tab) => [tab.id, tab]));
                            return tabIds.map((tabId) => tabById.get(tabId)).filter((tab) => tab != null);
                        });
                    }}
                />
            </div>
        </div>
    );
}
