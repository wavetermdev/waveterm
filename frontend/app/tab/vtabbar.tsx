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
    showDivider: boolean;
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
    onHoverChanged: (isHovered: boolean) => void;
}

function VTabWrapper({
    tabId,
    active,
    showDivider,
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
    onHoverChanged,
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
            showDivider={showDivider}
            isDragging={isDragging}
            isReordering={isReordering}
            onSelect={onSelect}
            onClose={onClose}
            onRename={onRename}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onDragEnd={onDragEnd}
            onHoverChanged={onHoverChanged}
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
    const [hoveredTabId, setHoveredTabId] = useState<string | null>(null);
    const [isNewTabHovered, setIsNewTabHovered] = useState(false);
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
                "flex h-full min-w-[100px] max-w-[400px] flex-col overflow-hidden",
                className
            )}
            style={{ width: barWidth, backdropFilter: "blur(20px)", background: "rgba(0, 0, 0, 0.35)" }}
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
                {orderedTabIds.map((tabId, index) => {
                    const isActive = tabId === activeTabId;
                    const isHovered = tabId === hoveredTabId;
                    const isLast = index === orderedTabIds.length - 1;
                    const nextTabId = orderedTabIds[index + 1];
                    const isNextActive = nextTabId === activeTabId;
                    const isNextHovered = nextTabId === hoveredTabId;
                    return (
                    <VTabWrapper
                        key={`${tabId}:${hoverResetVersion}`}
                        tabId={tabId}
                        active={isActive}
                        showDivider={!isActive && !isNextActive && !isHovered && !isNextHovered && !(isLast && isNewTabHovered)}
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
                        onHoverChanged={(isHovered) => setHoveredTabId(isHovered ? tabId : null)}
                    />
                    );
                })}
                <button
                    type="button"
                    className="group relative flex h-9 w-full shrink-0 cursor-pointer items-center gap-1.5 pl-3 pr-3 text-xs text-secondary/60 transition-colors hover:text-primary select-none"
                    onClick={() => env.electron.createTab()}
                    onMouseEnter={() => setIsNewTabHovered(true)}
                    onMouseLeave={() => setIsNewTabHovered(false)}
                    aria-label="New Tab"
                >
                    <div className="pointer-events-none absolute inset-x-1 inset-y-[4px] rounded-sm bg-transparent transition-colors group-hover:bg-hover" />
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
