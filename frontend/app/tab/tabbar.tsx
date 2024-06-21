// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { deleteLayoutStateAtomForTab } from "@/faraday/lib/layoutAtom";
import { debounce } from "@/faraday/lib/utils";
import { atoms } from "@/store/global";
import * as services from "@/store/services";
import { useAtomValue } from "jotai";
import { OverlayScrollbars } from "overlayscrollbars";
import React, { createRef, useCallback, useEffect, useRef, useState } from "react";

import { Tab } from "./tab";

import "./tabbar.less";

const TAB_DEFAULT_WIDTH = 130;
const TAB_MIN_WIDTH = 100;
const OS_OPTIONS = {
    overflow: {
        x: "scroll",
        y: "hidden",
    },
    scrollbars: {
        theme: "os-theme-dark",
        visibility: "auto",
        autoHide: "leave",
        autoHideDelay: 1300,
        autoHideSuspend: false,
        dragScroll: true,
        clickScroll: false,
        pointers: ["mouse", "touch", "pen"],
    },
};

interface TabBarProps {
    workspace: Workspace;
}

const TabBar = ({ workspace }: TabBarProps) => {
    const [tabIds, setTabIds] = useState<string[]>([]);
    const [dragStartPositions, setDragStartPositions] = useState<number[]>([]);
    const [draggingTab, setDraggingTab] = useState<string>();
    const [tabsLoaded, setTabsLoaded] = useState({});
    const [scrollable, setScrollable] = useState(false);
    const [tabWidth, setTabWidth] = useState(TAB_DEFAULT_WIDTH);

    const tabBarRef = useRef<HTMLDivElement>(null);
    const tabsWrapperRef = useRef<HTMLDivElement>(null);
    const tabRefs = useRef<React.RefObject<HTMLDivElement>[]>([]);
    const addBtnRef = useRef<HTMLDivElement>(null);
    const draggingTimeoutIdRef = useRef<NodeJS.Timeout>(null);
    const scrollToNewTabTimeoutIdRef = useRef<NodeJS.Timeout>(null);
    const draggingRemovedRef = useRef(false);
    const draggingTabDataRef = useRef({
        tabId: "",
        ref: { current: null },
        tabStartX: 0,
        tabIndex: 0,
        initialOffsetX: null,
        totalScrollOffset: null,
        dragged: false,
    });
    const osInstanceRef = useRef<OverlayScrollbars>(null);

    const windowData = useAtomValue(atoms.waveWindow);
    const { activetabid } = windowData;

    let prevDelta: number;
    let prevDragDirection: string;

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
        }
    }, [workspace, tabIds]);

    const updateTabPositions = useCallback(() => {
        const tabs = tabRefs.current;
        if (tabs === null) return;

        const newStartPositions: number[] = [];
        let cumulativeLeft = 0; // Start from the left edge

        tabRefs.current.forEach((ref) => {
            if (ref.current) {
                newStartPositions.push(cumulativeLeft);
                cumulativeLeft += ref.current.getBoundingClientRect().width; // Add each tab's actual width to the cumulative position
            }
        });

        setDragStartPositions(newStartPositions);
    }, []);

    const debouncedSetTabWidth = debounce((width) => setTabWidth(width), 100);
    const debouncedSetScrollable = debounce((scrollable) => setScrollable(scrollable), 100);
    const debouncedUpdateTabPositions = debounce(() => updateTabPositions(), 100);

    const handleResizeTabs = useCallback(() => {
        const tabBar = tabBarRef.current;
        if (tabBar === null) return;

        const tabBarWidth = tabBar.getBoundingClientRect().width;
        const numberOfTabs = tabIds.length;
        const totalDefaultTabWidth = numberOfTabs * TAB_DEFAULT_WIDTH;
        const minTotalTabWidth = numberOfTabs * TAB_MIN_WIDTH;
        let newTabWidth = tabWidth;
        let newScrollable = scrollable;

        if (minTotalTabWidth > tabBarWidth) {
            // Case where tabs cannot shrink further, make the tab bar scrollable
            newTabWidth = TAB_MIN_WIDTH;
            newScrollable = true;
        } else if (totalDefaultTabWidth > tabBarWidth) {
            // Case where resizing is needed due to limited container width
            newTabWidth = tabBarWidth / numberOfTabs;
            newScrollable = false;
        } else {
            // Case where tabs were previously shrunk or there is enough space for default width tabs
            newTabWidth = TAB_DEFAULT_WIDTH;
            newScrollable = false;
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
            debouncedSetTabWidth(newTabWidth);
        }
        // Update the state with the new scrollable state if it has changed
        if (newScrollable !== scrollable) {
            debouncedSetScrollable(newScrollable);
        }
        // Initialize/destroy overlay scrollbars
        if (newScrollable) {
            osInstanceRef.current = OverlayScrollbars(tabBarRef.current, { ...(OS_OPTIONS as any) });
        } else {
            if (osInstanceRef.current) {
                osInstanceRef.current.destroy();
            }
        }

        // Update the position of the Add Tab button if needed
        const addButton = addBtnRef.current;
        const lastTabRef = tabRefs.current[tabRefs.current.length - 1];
        if (addButton && lastTabRef && lastTabRef.current) {
            const lastTabRect = lastTabRef.current.getBoundingClientRect();
            addButton.style.position = "absolute";
            if (newScrollable) {
                addButton.style.transform = `translateX(${document.documentElement.clientWidth - addButton.offsetWidth}px) translateY(-50%)`;
            } else {
                addButton.style.transform = `translateX(${lastTabRect.right + 1}px) translateY(-50%)`;
            }
        }

        debouncedUpdateTabPositions();
    }, [tabIds, tabWidth, scrollable]);

    useEffect(() => {
        window.addEventListener("resize", () => handleResizeTabs());
        return () => {
            window.removeEventListener("resize", () => handleResizeTabs());
        };
    }, [handleResizeTabs]);

    useEffect(() => {
        // Check if all tabs are loaded
        const allLoaded = tabIds.length > 0 && tabIds.every((id) => tabsLoaded[id]);
        if (allLoaded) {
            updateTabPositions();
            handleResizeTabs();
        }
    }, [tabIds, tabsLoaded, handleResizeTabs, updateTabPositions]);

    // Make sure timeouts are cleared when component is unmounted
    useEffect(() => {
        return () => {
            if (draggingTimeoutIdRef.current) {
                clearTimeout(draggingTimeoutIdRef.current);
            }
            if (scrollToNewTabTimeoutIdRef.current) {
                clearTimeout(scrollToNewTabTimeoutIdRef.current);
            }
        };
    }, []);

    const getDragDirection = (currentX: number) => {
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
        return dragDirection;
    };

    const getNewTabIndex = (currentX: number, tabIndex: number, dragDirection: string) => {
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
        return newTabIndex;
    };

    const handleMouseMove = (event: MouseEvent) => {
        const { tabId, ref, tabStartX } = draggingTabDataRef.current;

        let initialOffsetX = draggingTabDataRef.current.initialOffsetX;
        let totalScrollOffset = draggingTabDataRef.current.totalScrollOffset;
        if (initialOffsetX === null) {
            initialOffsetX = event.clientX - tabStartX;
            draggingTabDataRef.current.initialOffsetX = initialOffsetX;
        }
        let currentX = event.clientX - initialOffsetX - totalScrollOffset;
        let tabBarRectWidth = tabBarRef.current.getBoundingClientRect().width;
        const dragDirection = getDragDirection(currentX);

        // Scroll the tab bar if the dragged tab overflows the container bounds
        if (scrollable) {
            const { viewport } = osInstanceRef.current.elements();
            const currentScrollLeft = viewport.scrollLeft;

            if (event.clientX <= 0) {
                viewport.scrollLeft = Math.max(0, currentScrollLeft - 5); // Scroll left
                if (viewport.scrollLeft !== currentScrollLeft) {
                    // Only adjust if the scroll actually changed
                    draggingTabDataRef.current.totalScrollOffset += currentScrollLeft - viewport.scrollLeft;
                }
            } else if (event.clientX >= tabBarRectWidth) {
                viewport.scrollLeft = Math.min(viewport.scrollWidth, currentScrollLeft + 5); // Scroll right
                if (viewport.scrollLeft !== currentScrollLeft) {
                    // Only adjust if the scroll actually changed
                    draggingTabDataRef.current.totalScrollOffset -= viewport.scrollLeft - currentScrollLeft;
                }
            }
        }

        // Re-calculate currentX after potential scroll adjustment
        initialOffsetX = draggingTabDataRef.current.initialOffsetX;
        totalScrollOffset = draggingTabDataRef.current.totalScrollOffset;
        currentX = event.clientX - initialOffsetX - totalScrollOffset;

        setDraggingTab((prev) => (prev !== tabId ? tabId : prev));

        // Check if the tab has moved 5 pixels
        if (Math.abs(currentX - tabStartX) >= 50) {
            draggingTabDataRef.current.dragged = true;
        }

        // Constrain movement within the container bounds
        if (tabBarRef.current) {
            const numberOfTabs = tabIds.length;
            const totalDefaultTabWidth = numberOfTabs * TAB_DEFAULT_WIDTH;
            if (totalDefaultTabWidth < tabBarRectWidth) {
                // Set to the total default tab width if there's vacant space
                tabBarRectWidth = totalDefaultTabWidth;
            } else if (scrollable) {
                // Set to the scrollable width if the tab bar is scrollable
                tabBarRectWidth = tabsWrapperRef.current.scrollWidth;
            }

            const minLeft = 0;
            const maxRight = tabBarRectWidth - tabWidth;

            // Adjust currentX to stay within bounds
            currentX = Math.min(Math.max(currentX, minLeft), maxRight);
        }

        ref.current!.style.transform = `translateX(${currentX}px)`;
        ref.current!.style.zIndex = "100";

        const tabIndex = draggingTabDataRef.current.tabIndex;
        const newTabIndex = getNewTabIndex(currentX, tabIndex, dragDirection);

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
            draggingTimeoutIdRef.current = setTimeout(() => {
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
        } else {
            // Reset styles
            tabRefs.current.forEach((ref) => {
                ref.current.style.zIndex = "0";
                ref.current.classList.remove("animate");
            });
            // Reset dragging state
            setDraggingTab(null);
        }

        document.removeEventListener("mouseup", handleMouseUp);
        document.removeEventListener("mousemove", handleMouseMove);
        draggingRemovedRef.current = false;
    };

    const handleDragStart = useCallback(
        (event: React.MouseEvent<HTMLDivElement, MouseEvent>, name: string, ref: React.RefObject<HTMLDivElement>) => {
            if (event.button !== 0) return;

            const tabIndex = tabIds.indexOf(name);
            const tabStartX = dragStartPositions[tabIndex]; // Starting X position of the tab

            if (ref.current) {
                draggingTabDataRef.current = {
                    tabId: ref.current.dataset.tabId,
                    ref,
                    tabStartX,
                    tabIndex,
                    initialOffsetX: null,
                    totalScrollOffset: 0,
                    dragged: false,
                };

                document.addEventListener("mousemove", handleMouseMove);
                document.addEventListener("mouseup", handleMouseUp);

                if (draggingTimeoutIdRef.current) {
                    clearTimeout(draggingTimeoutIdRef.current);
                }
            }
        },
        [tabIds, dragStartPositions]
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

        scrollToNewTabTimeoutIdRef.current = setTimeout(() => {
            if (scrollable) {
                const { viewport } = osInstanceRef.current.elements();
                viewport.scrollLeft = tabIds.length * tabWidth;
            }
        }, 30);
    };

    const handleCloseTab = (event: React.MouseEvent<HTMLElement, MouseEvent>, tabId: string) => {
        event.stopPropagation();
        services.WindowService.CloseTab(tabId);
        deleteLayoutStateAtomForTab(tabId);
    };

    const handleTabLoaded = useCallback((tabId) => {
        setTabsLoaded((prev) => {
            if (!prev[tabId]) {
                // Only update if the tab isn't already marked as loaded
                return { ...prev, [tabId]: true };
            }
            return prev;
        });
    }, []);

    const isBeforeActive = (tabId: string) => {
        return tabIds.indexOf(tabId) === tabIds.indexOf(activetabid) - 1;
    };

    const tabsWrapperWidth = tabIds.length * tabWidth;

    return (
        <div className="tab-bar-wrapper">
            <div className="tab-bar" ref={tabBarRef} data-overlayscrollbars-initialize>
                <div className="tabs-wrapper" ref={tabsWrapperRef} style={{ width: tabsWrapperWidth }}>
                    {tabIds.map((tabId, index) => (
                        <Tab
                            key={tabId}
                            ref={tabRefs.current[index]}
                            id={tabId}
                            onSelect={() => handleSelectTab(tabId)}
                            active={activetabid === tabId}
                            onDragStart={(event) => handleDragStart(event, tabId, tabRefs.current[index])}
                            onClose={(event) => handleCloseTab(event, tabId)}
                            onLoaded={() => handleTabLoaded(tabId)}
                            isBeforeActive={isBeforeActive(tabId)}
                            isDragging={draggingTab === tabId}
                        />
                    ))}
                </div>
            </div>
            <div ref={addBtnRef} className="add-tab-btn" onClick={handleAddTab}>
                <i className="fa fa-solid fa-plus fa-fw" />
            </div>
        </div>
    );
};

export { TabBar };
