// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getTabBadgeAtom } from "@/app/store/badge";
import { makeORef } from "@/app/store/wos";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import { validateCssColor } from "@/util/color-validator";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { VTab, VTabItem } from "./vtab";
import { VTabBarEnv } from "./vtabbarenv";
export type { VTabItem } from "./vtab";

interface VTabBarProps {
    workspace: Workspace;
    width?: number;
    className?: string;
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

interface VTabWrapperProps {
    tabId: string;
    active: boolean;
    isDragging: boolean;
    isReordering: boolean;
    hoverResetVersion: number;
    index: number;
    onSelect: () => void;
    onClose: () => void;
    onRename: (newName: string) => void;
    onDragStart: (event: React.DragEvent<HTMLDivElement>) => void;
    onDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
    onDrop: (event: React.DragEvent<HTMLDivElement>) => void;
    onDragEnd: () => void;
}

function VTabWrapper({
    tabId,
    active,
    isDragging,
    isReordering,
    hoverResetVersion,
    onSelect,
    onClose,
    onRename,
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd,
}: VTabWrapperProps) {
    const env = useWaveEnv<VTabBarEnv>();
    const [tabData] = env.wos.useWaveObjectValue<Tab>(makeORef("tab", tabId));
    const badges = useAtomValue(getTabBadgeAtom(tabId, env));

    const rawFlagColor = tabData?.meta?.["tab:flagcolor"];
    let flagColor: string | null = null;
    if (rawFlagColor) {
        try {
            validateCssColor(rawFlagColor);
            flagColor = rawFlagColor;
        } catch {
            flagColor = null;
        }
    }

    const tab: VTabItem = {
        id: tabId,
        name: tabData?.name ?? "",
        badges,
        flagColor,
    };

    return (
        <VTab
            key={`${tabId}:${hoverResetVersion}`}
            tab={tab}
            active={active}
            isDragging={isDragging}
            isReordering={isReordering}
            onSelect={onSelect}
            onClose={onClose}
            onRename={onRename}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onDragEnd={onDragEnd}
        />
    );
}

export function VTabBar({ workspace, width, className }: VTabBarProps) {
    const env = useWaveEnv<VTabBarEnv>();
    const activeTabId = useAtomValue(env.atoms.staticTabId);
    const reinitVersion = useAtomValue(env.atoms.reinitVersion);
    const tabIds = workspace?.tabids ?? [];

    const [orderedTabIds, setOrderedTabIds] = useState<string[]>(tabIds);
    const [dragTabId, setDragTabId] = useState<string | null>(null);
    const [dropIndex, setDropIndex] = useState<number | null>(null);
    const [dropLineTop, setDropLineTop] = useState<number | null>(null);
    const [hoverResetVersion, setHoverResetVersion] = useState(0);
    const dragSourceRef = useRef<string | null>(null);
    const didResetHoverForDragRef = useRef(false);

    useEffect(() => {
        setOrderedTabIds(tabIds);
    }, [workspace?.tabids]);

    useEffect(() => {
        if (reinitVersion > 0) {
            setOrderedTabIds(workspace?.tabids ?? []);
        }
    }, [reinitVersion]);

    const barWidth = useMemo(() => clampWidth(width), [width]);

    const clearDragState = () => {
        if (dragSourceRef.current != null && !didResetHoverForDragRef.current) {
            didResetHoverForDragRef.current = true;
            setHoverResetVersion((version) => version + 1);
        }
        dragSourceRef.current = null;
        setDragTabId(null);
        setDropIndex(null);
        setDropLineTop(null);
    };

    const reorder = (targetIndex: number) => {
        const sourceTabId = dragSourceRef.current;
        if (sourceTabId == null) {
            return;
        }
        const sourceIndex = orderedTabIds.findIndex((id) => id === sourceTabId);
        if (sourceIndex === -1) {
            return;
        }
        const boundedTargetIndex = Math.max(0, Math.min(targetIndex, orderedTabIds.length));
        const adjustedTargetIndex = sourceIndex < boundedTargetIndex ? boundedTargetIndex - 1 : boundedTargetIndex;
        if (sourceIndex === adjustedTargetIndex) {
            return;
        }
        const nextTabIds = [...orderedTabIds];
        const [movedId] = nextTabIds.splice(sourceIndex, 1);
        nextTabIds.splice(adjustedTargetIndex, 0, movedId);
        setOrderedTabIds(nextTabIds);
        fireAndForget(() => env.rpc.UpdateWorkspaceTabIdsCommand(TabRpcClient, workspace.oid, nextTabIds));
    };

    return (
        <div
            className={cn(
                "flex h-full min-w-[100px] max-w-[400px] flex-col overflow-hidden bg-panel",
                className
            )}
            style={{ width: barWidth }}
        >
            <div
                className="relative flex min-h-0 flex-1 flex-col overflow-y-auto"
                onDragOver={(event) => {
                    event.preventDefault();
                    if (event.target === event.currentTarget) {
                        setDropIndex(orderedTabIds.length);
                        setDropLineTop(event.currentTarget.scrollHeight);
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
                {orderedTabIds.map((tabId, index) => (
                    <VTabWrapper
                        key={`${tabId}:${hoverResetVersion}`}
                        tabId={tabId}
                        active={tabId === activeTabId}
                        isDragging={dragTabId === tabId}
                        isReordering={dragTabId != null}
                        hoverResetVersion={hoverResetVersion}
                        index={index}
                        onSelect={() => env.electron.setActiveTab(tabId)}
                        onClose={() => fireAndForget(() => env.electron.closeTab(workspace.oid, tabId, false))}
                        onRename={(newName) =>
                            fireAndForget(() => env.rpc.UpdateTabNameCommand(TabRpcClient, tabId, newName))
                        }
                        onDragStart={(event) => {
                            didResetHoverForDragRef.current = false;
                            dragSourceRef.current = tabId;
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("text/plain", tabId);
                            setDragTabId(tabId);
                            setDropIndex(index);
                            setDropLineTop(event.currentTarget.offsetTop);
                        }}
                        onDragOver={(event) => {
                            event.preventDefault();
                            const rect = event.currentTarget.getBoundingClientRect();
                            const relativeY = event.clientY - rect.top;
                            const midpoint = event.currentTarget.offsetHeight / 2;
                            const insertBefore = relativeY < midpoint;
                            setDropIndex(insertBefore ? index : index + 1);
                            setDropLineTop(
                                insertBefore
                                    ? event.currentTarget.offsetTop
                                    : event.currentTarget.offsetTop + event.currentTarget.offsetHeight
                            );
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
                ))}
                <button
                    type="button"
                    className="my-1 flex shrink-0 cursor-pointer items-center gap-1.5 rounded-sm pr-3 pl-2 py-1.5 text-xs text-secondary/60 transition-colors hover:bg-hover hover:text-primary"
                    onClick={() => env.electron.createTab()}
                    aria-label="New Tab"
                >
                    <i className="fa fa-solid fa-plus" style={{ fontSize: "10px" }} />
                    <span>New Tab</span>
                </button>
                {dragTabId != null && dropIndex != null && dropLineTop != null && (
                    <div
                        className="pointer-events-none absolute left-0 right-0 border-t-2 border-accent/80"
                        style={{ top: dropLineTop, transform: "translateY(-1px)" }}
                    />
                )}
            </div>
        </div>
    );
}
