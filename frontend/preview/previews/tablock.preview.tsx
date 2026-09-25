// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { TabV } from "@/app/tab/tab";
import { VTab, VTabItem } from "@/app/tab/vtab";
import { useEffect, useRef } from "react";

const TAB_WIDTH = 130;
const TAB_HEIGHT = 26;

interface TopTabEntry {
    tabId: string;
    tabName: string;
    active: boolean;
    locked?: boolean;
}

const topTabs: TopTabEntry[] = [
    { tabId: "lock-top-1", tabName: "Terminal", active: false },
    { tabId: "lock-top-2", tabName: "Production", active: true, locked: true },
    { tabId: "lock-top-3", tabName: "Scratch", active: false },
];

const leftTabs: VTabItem[] = [
    { id: "lock-left-1", name: "Terminal" },
    { id: "lock-left-2", name: "Production", locked: true },
    { id: "lock-left-3", name: "Deploy Logs" },
];

/** No-op handler used to satisfy the tab components' required event props in the preview. */
function noop() {}

/** Renders the horizontal (top) tab bar with one locked tab to preview the locked styling. */
function TopBar() {
    const tabRefs = useRef<Record<string, HTMLDivElement | null>>({});
    useEffect(() => {
        topTabs.forEach((tab, index) => {
            const el = tabRefs.current[tab.tabId];
            if (el) {
                el.style.opacity = "1";
                el.style.transform = `translate3d(${index * TAB_WIDTH}px, 0, 0)`;
            }
        });
    }, []);
    return (
        <div style={{ position: "relative", width: TAB_WIDTH * topTabs.length, height: TAB_HEIGHT }}>
            {topTabs.map((tab, index) => {
                const activeIndex = topTabs.findIndex((t) => t.active);
                const showDivider = index !== 0 && !tab.active && index !== activeIndex + 1;
                return (
                    <TabV
                        key={tab.tabId}
                        ref={(el) => {
                            tabRefs.current[tab.tabId] = el;
                        }}
                        tabId={tab.tabId}
                        tabName={tab.tabName}
                        active={tab.active}
                        showDivider={showDivider}
                        isDragging={false}
                        tabWidth={TAB_WIDTH}
                        isNew={false}
                        locked={tab.locked}
                        onClick={noop}
                        onClose={noop}
                        onDragStart={noop}
                        onContextMenu={noop}
                        onRename={noop}
                    />
                );
            })}
        </div>
    );
}

/** Renders the vertical (left) tab bar with one locked tab to preview the locked styling. */
function LeftBar() {
    return (
        <div
            className="flex w-[220px] flex-col rounded-md py-1"
            style={{ backdropFilter: "blur(20px)", background: "rgba(0, 0, 0, 0.35)" }}
        >
            {leftTabs.map((tab) => (
                <VTab
                    key={tab.id}
                    tab={tab}
                    active={tab.id === "lock-left-2"}
                    isDragging={false}
                    isReordering={false}
                    onSelect={noop}
                    onClose={noop}
                    onRename={noop}
                    onContextMenu={noop}
                    onDragStart={noop}
                    onDragOver={noop}
                    onDrop={noop}
                    onDragEnd={noop}
                />
            ))}
        </div>
    );
}

/** Preview entry that shows the locked-tab visuals in both the top and left tab bars. */
export function TabLockPreview() {
    return (
        <div className="flex flex-col gap-8 p-10">
            <div className="flex flex-col gap-2">
                <div className="text-xs text-secondary">Top tab bar — &ldquo;Production&rdquo; locked</div>
                <TopBar />
            </div>
            <div className="flex flex-col gap-2">
                <div className="text-xs text-secondary">Left tab bar — &ldquo;Production&rdquo; locked</div>
                <LeftBar />
            </div>
        </div>
    );
}
