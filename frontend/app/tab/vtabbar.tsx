// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Tooltip } from "@/app/element/tooltip";
import { getTabBadgeAtom } from "@/app/store/badge";
import { getTabModelByTabId } from "@/app/store/tab-model";
import { makeORef } from "@/app/store/wos";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import { WorkspaceLayoutModel } from "@/app/workspace/workspace-layout-model";
import { validateCssColor } from "@/util/color-validator";
import { cn, fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { buildTabBarContextMenu, buildTabContextMenu } from "./tabcontextmenu";
import { UpdateStatusBanner } from "./updatebanner";
import { VTab, VTabItem } from "./vtab";
import { VTabBarEnv } from "./vtabbarenv";
import { WorkspaceSwitcher } from "./workspaceswitcher";
export type { VTabItem } from "./vtab";

const VTabBarAIButton = memo(() => {
    const env = useWaveEnv<VTabBarEnv>();
    const aiPanelOpen = useAtomValue(WorkspaceLayoutModel.getInstance().panelVisibleAtom);
    const hideAiButton = useAtomValue(env.getSettingsKeyAtom("app:hideaibutton"));

    const onClick = () => {
        const currentVisible = WorkspaceLayoutModel.getInstance().getAIPanelVisible();
        WorkspaceLayoutModel.getInstance().setAIPanelVisible(!currentVisible);
    };

    if (hideAiButton) {
        return null;
    }

    return (
        <Tooltip
            content="Toggle Wave AI Panel"
            placement="bottom"
            hideOnClick
            divClassName={`flex h-[22px] px-3.5 justify-end mb-1 items-center rounded-md mr-1 box-border cursor-pointer bg-hover hover:bg-hoverbg transition-colors text-[12px] ${aiPanelOpen ? "text-accent" : "text-secondary"}`}
            divStyle={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            divOnClick={onClick}
        >
            <i className="fa fa-sparkles" />
        </Tooltip>
    );
});
VTabBarAIButton.displayName = "VTabBarAIButton";

const MacOSHeader = memo(() => {
    const env = useWaveEnv<VTabBarEnv>();
    const isFullScreen = useAtomValue(env.atoms.isFullScreen);
    return (
        <>
            {!isFullScreen && (
                <div
                    className="w-full shrink-0"
                    style={
                        {
                            height: "calc(25px * var(--zoomfactor-inv))",
                            WebkitAppRegion: "drag",
                        } as React.CSSProperties
                    }
                />
            )}
            <div
                className="flex shrink-0 flex-row flex-wrap items-end px-1 pb-1 pl-2"
                style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            >
                <VTabBarAIButton />
                <Tooltip content="Workspace Switcher" placement="bottom" hideOnClick divClassName="flex items-center">
                    <WorkspaceSwitcher />
                </Tooltip>
                <UpdateStatusBanner />
            </div>
        </>
    );
});
MacOSHeader.displayName = "MacOSHeader";

interface VTabBarProps {
    workspace: Workspace;
    className?: string;
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
    const renameRef = useRef<(() => void) | null>(null);
    const tabModel = getTabModelByTabId(tabId, env);

    useEffect(() => {
        const cb = () => renameRef.current?.();
        tabModel.startRenameCallback = cb;
        return () => {
            if (tabModel.startRenameCallback === cb) {
                tabModel.startRenameCallback = null;
            }
        };
    }, [tabModel]);

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

    const handleContextMenu = useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            e.preventDefault();
            e.stopPropagation();
            const menu = buildTabContextMenu(tabId, renameRef, () => onClose(), env);
            env.showContextMenu(menu, e);
        },
        [tabId, onClose, env]
    );

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
            onContextMenu={handleContextMenu}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onDragEnd={onDragEnd}
            onHoverChanged={onHoverChanged}
            renameRef={renameRef}
        />
    );
}

export function VTabBar({ workspace, className }: VTabBarProps) {
    const env = useWaveEnv<VTabBarEnv>();
    const activeTabId = useAtomValue(env.atoms.staticTabId);
    const reinitVersion = useAtomValue(env.atoms.reinitVersion);
    const documentHasFocus = useAtomValue(env.atoms.documentHasFocus);
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
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const scrollAnimFrameRef = useRef<number | null>(null);
    const scrollDirectionRef = useRef<number>(0);
    const scrollSpeedRef = useRef<number>(0);

    useEffect(() => {
        setOrderedTabIds(tabIds);
    }, [workspace?.tabids]);

    useEffect(() => {
        if (reinitVersion > 0) {
            setOrderedTabIds(workspace?.tabids ?? []);
        }
    }, [reinitVersion]);

    useEffect(() => {
        if (activeTabId == null || scrollContainerRef.current == null) {
            return;
        }
        const el = scrollContainerRef.current.querySelector(`[data-tabid="${activeTabId}"]`);
        el?.scrollIntoView({ block: "nearest" });
    }, [activeTabId]);

    useEffect(() => {
        if (!documentHasFocus || activeTabId == null || scrollContainerRef.current == null) {
            return;
        }
        const el = scrollContainerRef.current.querySelector(`[data-tabid="${activeTabId}"]`);
        el?.scrollIntoView({ block: "nearest" });
    }, [documentHasFocus]);

    const stopScrollLoop = useCallback(() => {
        if (scrollAnimFrameRef.current != null) {
            cancelAnimationFrame(scrollAnimFrameRef.current);
            scrollAnimFrameRef.current = null;
        }
        scrollDirectionRef.current = 0;
    }, []);

    const startScrollLoop = useCallback(() => {
        if (scrollAnimFrameRef.current != null) {
            return;
        }
        const loop = () => {
            const container = scrollContainerRef.current;
            if (container == null || scrollDirectionRef.current === 0) {
                scrollAnimFrameRef.current = null;
                return;
            }
            container.scrollTop += scrollDirectionRef.current * scrollSpeedRef.current;
            scrollAnimFrameRef.current = requestAnimationFrame(loop);
        };
        scrollAnimFrameRef.current = requestAnimationFrame(loop);
    }, []);

    const updateScrollFromDragY = useCallback(
        (clientY: number) => {
            const container = scrollContainerRef.current;
            if (container == null) {
                return;
            }
            const EdgeZone = 60;
            const MaxScrollSpeed = 12;
            const rect = container.getBoundingClientRect();
            const relY = clientY - rect.top;
            const height = rect.height;
            if (relY < EdgeZone) {
                scrollDirectionRef.current = -1;
                scrollSpeedRef.current = MaxScrollSpeed * (1 - relY / EdgeZone);
                startScrollLoop();
            } else if (relY > height - EdgeZone) {
                scrollDirectionRef.current = 1;
                scrollSpeedRef.current = MaxScrollSpeed * (1 - (height - relY) / EdgeZone);
                startScrollLoop();
            } else {
                scrollDirectionRef.current = 0;
                stopScrollLoop();
            }
        },
        [startScrollLoop, stopScrollLoop]
    );

    const clearDragState = () => {
        stopScrollLoop();
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

    const handleTabBarContextMenu = useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            e.preventDefault();
            const menu = buildTabBarContextMenu(env);
            env.showContextMenu(menu, e);
        },
        [env]
    );

    return (
        <div
            className={cn("flex h-full flex-col overflow-hidden", className)}
            style={{ backdropFilter: "blur(20px)", background: "rgba(0, 0, 0, 0.35)" }}
            onContextMenu={handleTabBarContextMenu}
        >
            {env.isMacOS() && <MacOSHeader />}
            <div
                ref={scrollContainerRef}
                className="relative flex min-h-0 flex-col overflow-y-auto"
                onDragOver={(event) => {
                    event.preventDefault();
                    updateScrollFromDragY(event.clientY);
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
                            showDivider={
                                !isActive &&
                                !isNextActive &&
                                !isHovered &&
                                !isNextHovered &&
                                !(isLast && isNewTabHovered)
                            }
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
                {dragTabId != null && dropIndex != null && dropLineTop != null && (
                    <div
                        className="pointer-events-none absolute left-0 right-0 border-t-2 border-accent/80"
                        style={{ top: dropLineTop, transform: "translateY(-1px)" }}
                    />
                )}
            </div>
            <button
                type="button"
                className="group relative flex h-9 w-full shrink-0 cursor-pointer items-center gap-1.5 pl-3 pr-3 text-xs text-secondary/60 transition-colors hover:text-primary select-none whitespace-nowrap"
                onClick={() => env.electron.createTab()}
                onMouseEnter={() => setIsNewTabHovered(true)}
                onMouseLeave={() => setIsNewTabHovered(false)}
                aria-label="New Tab"
            >
                <div className="pointer-events-none absolute inset-x-1 inset-y-[4px] rounded-sm bg-transparent transition-colors group-hover:bg-hover" />
                <i className="fa fa-solid fa-plus" style={{ fontSize: "10px" }} />
                <span>New Tab</span>
            </button>
        </div>
    );
}
