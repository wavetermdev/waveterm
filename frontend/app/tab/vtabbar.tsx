// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { useEffect, useMemo, useRef, useState } from "react";
import { VTab, VTabItem } from "./vtab";
export type { VTabItem } from "./vtab";

interface VTabBarProps {
    tabs: VTabItem[];
    activeTabId?: string;
    width?: number;
    className?: string;
    onSelectTab?: (tabId: string) => void;
    onCloseTab?: (tabId: string) => void;
    onReorderTabs?: (tabIds: string[]) => void;
}

function clampWidth(width?: number): number {
    if (width == null) {
        return 220;
    }
    if (width < 100) {
        return 100;
    }
    if (width > 400) {
        return 400;
    }
    return width;
}

export function VTabBar({ tabs, activeTabId, width, className, onSelectTab, onCloseTab, onReorderTabs }: VTabBarProps) {
    const [orderedTabs, setOrderedTabs] = useState<VTabItem[]>(tabs);
    const [dragTabId, setDragTabId] = useState<string>(null);
    const [dropTargetTabId, setDropTargetTabId] = useState<string>(null);
    const dragSourceRef = useRef<string>(null);

    useEffect(() => {
        setOrderedTabs(tabs);
    }, [tabs]);

    const barWidth = useMemo(() => clampWidth(width), [width]);

    const clearDragState = () => {
        dragSourceRef.current = null;
        setDragTabId(null);
        setDropTargetTabId(null);
    };

    const reorder = (targetTabId: string) => {
        const sourceTabId = dragSourceRef.current;
        if (sourceTabId == null || sourceTabId === targetTabId) {
            return;
        }
        const sourceIndex = orderedTabs.findIndex((tab) => tab.id === sourceTabId);
        const targetIndex = orderedTabs.findIndex((tab) => tab.id === targetTabId);
        if (sourceIndex === -1 || targetIndex === -1) {
            return;
        }
        const nextTabs = [...orderedTabs];
        const [movedTab] = nextTabs.splice(sourceIndex, 1);
        nextTabs.splice(targetIndex, 0, movedTab);
        setOrderedTabs(nextTabs);
        onReorderTabs?.(nextTabs.map((tab) => tab.id));
    };

    return (
        <div
            className={cn("flex h-full min-w-[100px] max-w-[400px] flex-col overflow-hidden border-r border-border bg-panel", className)}
            style={{ width: barWidth }}
        >
            <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-1">
                {orderedTabs.map((tab) => (
                    <VTab
                        key={tab.id}
                        tab={tab}
                        active={tab.id === activeTabId}
                        isDragging={dragTabId === tab.id}
                        isDropTarget={dropTargetTabId === tab.id && dragTabId !== tab.id}
                        onSelect={() => onSelectTab?.(tab.id)}
                        onClose={onCloseTab ? () => onCloseTab(tab.id) : undefined}
                        onDragStart={(event) => {
                            dragSourceRef.current = tab.id;
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("text/plain", tab.id);
                            setDragTabId(tab.id);
                        }}
                        onDragOver={(event) => {
                            event.preventDefault();
                            setDropTargetTabId(tab.id);
                        }}
                        onDrop={(event) => {
                            event.preventDefault();
                            reorder(tab.id);
                            clearDragState();
                        }}
                        onDragEnd={clearDragState}
                    />
                ))}
            </div>
        </div>
    );
}
