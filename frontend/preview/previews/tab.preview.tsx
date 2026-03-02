// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { TabV } from "@/app/tab/tab";
import { useEffect, useRef, useState } from "react";

const TAB_WIDTH = 130;
const TAB_HEIGHT = 26;

interface PreviewTabEntry {
    tabId: string;
    tabName: string;
    active: boolean;
    isBeforeActive: boolean;
}

const tabDefs: PreviewTabEntry[] = [
    { tabId: "preview-tab-1", tabName: "Terminal", active: false, isBeforeActive: true },
    { tabId: "preview-tab-2", tabName: "My Tab", active: true, isBeforeActive: false },
    { tabId: "preview-tab-3", tabName: "T3", active: false, isBeforeActive: false },
];

export function TabPreview() {
    const [tabNames, setTabNames] = useState<Record<string, string>>(
        Object.fromEntries(tabDefs.map((t) => [t.tabId, t.tabName]))
    );
    const [activeTabId, setActiveTabId] = useState<string>(
        tabDefs.find((t) => t.active)?.tabId ?? tabDefs[0].tabId
    );
    const tabRefs = useRef<Record<string, HTMLDivElement | null>>({});

    // The real tabbar imperatively sets opacity: 1 and transform after calculating
    // tab positions. Tabs start at opacity: 0 in CSS, so we mirror that here.
    useEffect(() => {
        tabDefs.forEach((tab, index) => {
            const el = tabRefs.current[tab.tabId];
            if (el) {
                el.style.opacity = "1";
                el.style.transform = `translate3d(${index * TAB_WIDTH}px, 0, 0)`;
            }
        });
    }, []);

    return (
        <div style={{ position: "relative", width: TAB_WIDTH * tabDefs.length, height: TAB_HEIGHT }}>
            {tabDefs.map((tab, index) => {
                const activeIndex = tabDefs.findIndex((t) => t.tabId === activeTabId);
                const isActive = tab.tabId === activeTabId;
                const isBeforeActive = index === activeIndex - 1;
                return (
                <TabV
                    key={tab.tabId}
                    ref={(el) => {
                        tabRefs.current[tab.tabId] = el;
                    }}
                    tabId={tab.tabId}
                    tabName={tabNames[tab.tabId]}
                    active={isActive}
                    isBeforeActive={isBeforeActive}
                    isDragging={false}
                    tabWidth={TAB_WIDTH}
                    isNew={false}
                    indicator={null}
                    onClick={() => setActiveTabId(tab.tabId)}
                    onClose={() => console.log("close", tab.tabId)}
                    onDragStart={() => {}}
                    onContextMenu={() => {}}
                    onRename={(newName) => {
                        console.log("rename", tab.tabId, newName);
                        setTabNames((prev) => ({ ...prev, [tab.tabId]: newName }));
                    }}
                />
                );
            })}
        </div>
    );
}
