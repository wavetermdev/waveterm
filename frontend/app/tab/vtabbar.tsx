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
    const [dragTabId, setDragTabId] = useState<string | null>(null);
    const [dropIndex, setDropIndex] = useState<number | null>(null);
    const dragSourceRef = useRef<string | null>(null);

    useEffect(() => {
        setOrderedTabs(tabs);
    }, [tabs]);

    const barWidth = useMemo(() => clampWidth(width), [width]);

    const clearDragState = () => {
        dragSourceRef.current = null;
        setDragTabId(null);
        setDropIndex(null);
    };

    const reorder = (targetIndex: number) => {
        const sourceTabId = dragSourceRef.current;
        if (sourceTabId == null) {
            return;
        }
        const sourceIndex = orderedTabs.findIndex((tab) => tab.id === sourceTabId);
        if (sourceIndex === -1) {
            return;
        }
        const boundedTargetIndex = Math.max(0, Math.min(targetIndex, orderedTabs.length));
        const adjustedTargetIndex = sourceIndex < boundedTargetIndex ? boundedTargetIndex - 1 : boundedTargetIndex;
        if (sourceIndex === adjustedTargetIndex) {
            return;
        }
        const nextTabs = [...orderedTabs];
        const [movedTab] = nextTabs.splice(sourceIndex, 1);
        nextTabs.splice(adjustedTargetIndex, 0, movedTab);
        setOrderedTabs(nextTabs);
        onReorderTabs?.(nextTabs.map((tab) => tab.id));
    };

    return (
        <div
            className={cn("flex h-full min-w-[100px] max-w-[400px] flex-col overflow-hidden border-r border-border bg-panel", className)}
            style={{ width: barWidth }}
        >
            <div
                className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-1"
                onDragOver={(event) => {
                    event.preventDefault();
                    if (event.target === event.currentTarget) {
                        setDropIndex(orderedTabs.length);
                    }
                }}
                onDrop={(event) => {
                    event.preventDefault();
                    if (dropIndex != null) {
                        reorder(dropIndex);
                    }
                    clearDragState();
                }}
            >
                {dropIndex === 0 && <div className="h-0 border-t-2 border-accent/80" />}
                {orderedTabs.map((tab, index) => (
                    <div key={tab.id} className="flex flex-col gap-1">
                        <VTab
                            tab={tab}
                            active={tab.id === activeTabId}
                            isDragging={dragTabId === tab.id}
                            isReordering={dragTabId != null}
                            onSelect={() => onSelectTab?.(tab.id)}
                            onClose={onCloseTab ? () => onCloseTab(tab.id) : undefined}
                            onDragStart={(event) => {
                                dragSourceRef.current = tab.id;
                                event.dataTransfer.effectAllowed = "move";
                                event.dataTransfer.setData("text/plain", tab.id);
                                setDragTabId(tab.id);
                                setDropIndex(index);
                            }}
                            onDragOver={(event) => {
                                event.preventDefault();
                                const rect = event.currentTarget.getBoundingClientRect();
                                const insertBefore = event.clientY < rect.top + rect.height / 2;
                                setDropIndex(insertBefore ? index : index + 1);
                            }}
                            onDrop={(event) => {
                                event.preventDefault();
                                if (dropIndex != null) {
                                    reorder(dropIndex);
                                }
                                clearDragState();
                            }}
                            onDragEnd={clearDragState}
                        />
                        {dropIndex === index + 1 && <div className="h-0 border-t-2 border-accent/80" />}
                    </div>
                ))}
            </div>
        </div>
    );
}
