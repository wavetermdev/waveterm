// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { deleteLayoutStateAtomForTab } from "@/faraday/lib/layoutAtom";
import { atoms } from "@/store/global";
import * as services from "@/store/services";
import { PrimitiveAtom, atom, useAtom, useAtomValue } from "jotai";
import React, { createRef, useCallback, useEffect, useRef } from "react";

import { Tab } from "./tab";

import "./tabbar.less";

const DEFAULT_TAB_WIDTH = 130;

// Atoms
const tabIdsAtom = atom<string[]>([]);
const tabWidthAtom = atom<number>(DEFAULT_TAB_WIDTH);
const dragStartPositionsAtom = atom<number[]>([]);
const draggingTabAtom = atom<string | null>(null) as PrimitiveAtom<string | null>;
const loadingAtom = atom<boolean>(true);

interface TabBarProps {
    workspace: Workspace;
}

const TabBar = ({ workspace }: TabBarProps) => {
    const [tabIds, setTabIds] = useAtom(tabIdsAtom);
    const [tabWidth, setTabWidth] = useAtom(tabWidthAtom);
    const [dragStartPositions, setDragStartPositions] = useAtom(dragStartPositionsAtom);
    const [draggingTab, setDraggingTab] = useAtom(draggingTabAtom);
    const [loading, setLoading] = useAtom(loadingAtom);

    const tabBarRef = useRef<HTMLDivElement>(null);
    const tabRefs = useRef<React.RefObject<HTMLDivElement>[]>([]);
    const addBtnRef = useRef<HTMLDivElement>(null);
    const draggingTimeoutId = useRef<NodeJS.Timeout>(null);
    const draggingRemovedRef = useRef(false);
    const draggingTabDataRef = useRef({
        tabId: "",
        ref: { current: null },
        tabStartX: 0,
        tabIndex: 0,
        dragged: false,
    });

    const windowData = useAtomValue(atoms.waveWindow);
    const { activetabid } = windowData;

    let prevDelta: number;
    let prevDragDirection: string;
    let shrunk: boolean;

    // Update refs when tabIds change
    useEffect(() => {
        tabRefs.current = tabIds.map((_, index) => tabRefs.current[index] || createRef());
    }, [tabIds]);

    useEffect(() => {
        if (workspace) {
            // Compare current tabIds with new workspace.tabids
            const currentTabIds = new Set(tabIds);
            const newTabIds = new Set(workspace.tabids);

            const areEqual =
                currentTabIds.size === newTabIds.size && [...currentTabIds].every((id) => newTabIds.has(id));

            if (!areEqual) {
                setTabIds(workspace.tabids);
            }
            setLoading(false);
        }
    }, [workspace, tabIds, setTabIds, setLoading]);

    const updateTabPositions = useCallback(() => {
        if (tabBarRef.current) {
            const newStartPositions: number[] = [];
            let cumulativeLeft = 0; // Start from the left edge

            tabRefs.current.forEach((ref) => {
                if (ref.current) {
                    newStartPositions.push(cumulativeLeft);
                    cumulativeLeft += ref.current.getBoundingClientRect().width; // Add each tab's actual width to the cumulative position
                }
            });

            setDragStartPositions(newStartPositions);
        }
    }, [tabRefs.current, setDragStartPositions]);

    const handleResizeTabs = useCallback(() => {
        const tabBar = tabBarRef.current;
        if (!tabBar) return;

        const containerWidth = tabBar.getBoundingClientRect().width;
        const numberOfTabs = tabIds.length;
        const totalDefaultTabWidth = numberOfTabs * DEFAULT_TAB_WIDTH;
        let newTabWidth = DEFAULT_TAB_WIDTH;

        if (totalDefaultTabWidth > containerWidth) {
            newTabWidth = containerWidth / numberOfTabs;
            shrunk = true;
        } else {
            shrunk = false;
        }

        // Apply the calculated width and position to all tabs
        tabRefs.current.forEach((ref, index) => {
            if (ref.current) {
                ref.current.style.width = `${newTabWidth}px`;
                ref.current.style.transform = `translateX(${index * newTabWidth}px)`;
            }
        });

        // Update the state with the new tab width if it has changed
        if (newTabWidth !== tabWidth) {
            setTabWidth(newTabWidth);
        }

        // Update the position of the Add Tab button if needed
        const addButton = addBtnRef.current;
        const lastTabRef = tabRefs.current[tabRefs.current.length - 1];
        if (addButton && lastTabRef && lastTabRef.current) {
            const lastTabRect = lastTabRef.current.getBoundingClientRect();
            addButton.style.position = "absolute";
            addButton.style.transform = `translateX(${lastTabRect.right}px) translateY(-50%)`;
        }
    }, [tabIds, tabWidth, updateTabPositions, setTabWidth]);

    useEffect(() => {
        window.addEventListener("resize", handleResizeTabs);
        return () => {
            window.removeEventListener("resize", handleResizeTabs);
        };
    }, [handleResizeTabs]);

    useEffect(() => {
        if (!loading) {
            handleResizeTabs();
            updateTabPositions();
        }
    }, [loading, handleResizeTabs, updateTabPositions]);

    // Make sure timeouts are cleared when component is unmounted
    useEffect(() => {
        return () => {
            if (draggingTimeoutId.current) {
                clearTimeout(draggingTimeoutId.current);
            }
        };
    }, []);

    const handleMouseMove = (event: MouseEvent) => {
        const { tabId, ref, tabStartX } = draggingTabDataRef.current;

        let tabIndex = draggingTabDataRef.current.tabIndex;
        let currentX = event.clientX - ref.current.getBoundingClientRect().width / 2;

        // Check if the tab has moved 5 pixels
        if (Math.abs(currentX - tabStartX) >= 5) {
            setDraggingTab(tabId);
            draggingTabDataRef.current.dragged = true;
        }

        // Constrain movement within the container bounds
        if (tabBarRef.current) {
            const numberOfTabs = tabIds.length;
            const totalDefaultTabWidth = numberOfTabs * DEFAULT_TAB_WIDTH;
            const containerRect = tabBarRef.current.getBoundingClientRect();
            let containerRectWidth = containerRect.width;
            // Set to the total default tab width if there's vacant space
            if (totalDefaultTabWidth < containerRectWidth) {
                containerRectWidth = totalDefaultTabWidth;
            }

            const minLeft = 0;
            const maxRight = containerRectWidth - tabWidth;

            // Adjust currentX to stay within bounds
            currentX = Math.min(Math.max(currentX, minLeft), maxRight);
        }

        ref.current!.style.transform = `translateX(${currentX}px)`;
        ref.current!.style.zIndex = "100";

        let dragDirection;
        if (currentX - prevDelta > 0) {
            dragDirection = "+";
        } else if (currentX - prevDelta === 0) {
            dragDirection = prevDragDirection;
        } else {
            dragDirection = "-";
        }
        prevDelta = currentX;
        prevDragDirection = dragDirection;

        let newTabIndex = tabIndex;

        if (dragDirection === "+") {
            // Dragging to the right
            for (let i = tabIndex + 1; i < tabIds.length; i++) {
                const otherTabStart = dragStartPositions[i];
                if (currentX + tabWidth > otherTabStart + tabWidth / 2) {
                    newTabIndex = i;
                }
            }
        } else {
            // Dragging to the left
            for (let i = tabIndex - 1; i >= 0; i--) {
                const otherTabEnd = dragStartPositions[i] + tabWidth;
                if (currentX < otherTabEnd - tabWidth / 2) {
                    newTabIndex = i;
                }
            }
        }

        if (newTabIndex !== tabIndex) {
            // Remove the dragged tab if not already done
            if (!draggingRemovedRef.current) {
                tabIds.splice(tabIndex, 1);
                draggingRemovedRef.current = true;
            }

            // Find current index of the dragged tab in tempTabs
            const currentIndexOfDraggingTab = tabIds.indexOf(tabId);

            // Move the dragged tab to its new position
            if (currentIndexOfDraggingTab !== -1) {
                tabIds.splice(currentIndexOfDraggingTab, 1);
            }
            tabIds.splice(newTabIndex, 0, tabId);

            // Update visual positions of the tabs
            tabIds.forEach((localTabId, index) => {
                const ref = tabRefs.current.find((ref) => ref.current.dataset.tabId === localTabId);
                if (ref.current && localTabId !== tabId) {
                    ref.current.style.transform = `translateX(${index * tabWidth}px)`;
                    ref.current.classList.add("animate");
                }
            });

            tabIndex = newTabIndex;
            draggingTabDataRef.current.tabIndex = newTabIndex;
        }
    };

    const handleMouseUp = (event: MouseEvent) => {
        const { tabIndex, dragged } = draggingTabDataRef.current;

        // Update the final position of the dragged tab
        const draggingTab = tabIds[tabIndex];
        const finalLeftPosition = tabIndex * tabWidth;
        const ref = tabRefs.current.find((ref) => ref.current.dataset.tabId === draggingTab);
        if (ref.current) {
            ref.current.classList.add("animate");
            ref.current.style.transform = `translateX(${finalLeftPosition}px)`;
        }

        if (dragged) {
            draggingTimeoutId.current = setTimeout(() => {
                // Reset styles
                tabRefs.current.forEach((ref) => {
                    ref.current.style.zIndex = "0";
                    ref.current.classList.remove("animate");
                });
                // Reset dragging state
                setDraggingTab(null);
                // Update workspace tab ids
                services.ObjectService.UpdateWorkspaceTabIds(workspace.oid, tabIds);
            }, 300);
        }

        document.removeEventListener("mouseup", handleMouseUp);
        document.removeEventListener("mousemove", handleMouseMove);
        draggingRemovedRef.current = false;
    };

    const handleDragStart = useCallback(
        (name: string, ref: React.RefObject<HTMLDivElement>) => {
            const tabIndex = tabIds.indexOf(name);
            const tabStartX = dragStartPositions[tabIndex]; // Starting X position of the tab

            if (ref.current) {
                draggingTabDataRef.current = {
                    tabId: ref.current.dataset.tabId,
                    ref,
                    tabStartX,
                    tabIndex,
                    dragged: false,
                };

                document.addEventListener("mousemove", handleMouseMove);
                document.addEventListener("mouseup", handleMouseUp);

                if (draggingTimeoutId.current) {
                    clearTimeout(draggingTimeoutId.current);
                }
            }
        },
        [tabIds, dragStartPositions, tabWidth]
    );

    const handleSelectTab = (tabId: string) => {
        if (!draggingTabDataRef.current.dragged) {
            services.ObjectService.SetActiveTab(tabId);
        }
    };

    const handleAddTab = () => {
        const newTabName = `T${tabIds.length + 1}`;
        setTabIds([...tabIds, newTabName]);
        services.ObjectService.AddTabToWorkspace(newTabName, true);
    };

    const handleCloseTab = (tabId: string) => {
        services.ObjectService.CloseTab(tabId);
        deleteLayoutStateAtomForTab(tabId);
    };

    const isBeforeActive = (tabId: string) => {
        return tabIds.indexOf(tabId) === tabIds.indexOf(activetabid) - 1;
    };

    return (
        <div className="tab-bar-wrapper">
            <div className="tab-bar" ref={tabBarRef}>
                {tabIds.map((tabId, index) => (
                    <Tab
                        key={tabId}
                        ref={tabRefs.current[index]}
                        id={tabId}
                        onSelect={() => handleSelectTab(tabId)}
                        active={activetabid === tabId}
                        onDragStart={() => handleDragStart(tabId, tabRefs.current[index])}
                        onClose={() => handleCloseTab(tabId)}
                        isBeforeActive={isBeforeActive(tabId)}
                        isDragging={draggingTab === tabId}
                    />
                ))}
            </div>
            <div ref={addBtnRef} className="add-tab-btn" onClick={handleAddTab}>
                <i className="fa fa-solid fa-plus fa-fw" />
            </div>
        </div>
    );
};

export { TabBar };
