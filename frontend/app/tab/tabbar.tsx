// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { modalsModel } from "@/app/store/modalmodel";
import { WindowDrag } from "@/element/windowdrag";
import { deleteLayoutModelForTab } from "@/layout/index";
import { atoms, createTab, getApi, isDev, PLATFORM, setActiveTab } from "@/store/global";
import { fireAndForget } from "@/util/util";
import { useAtomValue } from "jotai";
import { OverlayScrollbars } from "overlayscrollbars";
import { createRef, memo, useCallback, useEffect, useRef, useState } from "react";
import { debounce } from "throttle-debounce";
import { WorkspaceService } from "../store/services";
import { Tab } from "./tab";
import "./tabbar.scss";
import { UpdateStatusBanner } from "./updatebanner";
import { WorkspaceSwitcher } from "./workspaceswitcher";

const TAB_DEFAULT_WIDTH = 130;
const TAB_MIN_WIDTH = 100;
const DRAGGER_RIGHT_MIN_WIDTH = 74;
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

const ConfigErrorMessage = () => {
    const fullConfig = useAtomValue(atoms.fullConfigAtom);

    if (fullConfig?.configerrors == null || fullConfig?.configerrors.length == 0) {
        return (
            <div className="config-error-message">
                <h3>Configuration Clean</h3>
                <p>There are no longer any errors detected in your config.</p>
            </div>
        );
    }
    if (fullConfig?.configerrors.length == 1) {
        const singleError = fullConfig.configerrors[0];
        return (
            <div className="config-error-message">
                <h3>Configuration Error</h3>
                <div>
                    {singleError.file}: {singleError.err}
                </div>
            </div>
        );
    }
    return (
        <div className="config-error-message">
            <h3>Configuration Error</h3>
            <ul>
                {fullConfig.configerrors.map((error, index) => (
                    <li key={index}>
                        {error.file}: {error.err}
                    </li>
                ))}
            </ul>
        </div>
    );
};

const ConfigErrorIcon = ({ buttonRef }: { buttonRef: React.RefObject<HTMLElement> }) => {
    const fullConfig = useAtomValue(atoms.fullConfigAtom);

    function handleClick() {
        modalsModel.pushModal("MessageModal", { children: <ConfigErrorMessage /> });
    }

    if (fullConfig?.configerrors == null || fullConfig?.configerrors.length == 0) {
        return null;
    }
    return (
        <Button
            ref={buttonRef as React.RefObject<HTMLButtonElement>}
            className="config-error-button red"
            onClick={handleClick}
        >
            <i className="fa fa-solid fa-exclamation-triangle" />
            Config Error
        </Button>
    );
};

const TabBar = memo(({ workspace }: TabBarProps) => {
    const [tabIds, setTabIds] = useState<string[]>([]);
    const [dragStartPositions, setDragStartPositions] = useState<number[]>([]);
    const [draggingTab, setDraggingTab] = useState<string>();
    const [tabsLoaded, setTabsLoaded] = useState({});
    const [newTabId, setNewTabId] = useState<string | null>(null);

    const tabbarWrapperRef = useRef<HTMLDivElement>(null);
    const tabBarRef = useRef<HTMLDivElement>(null);
    const tabsWrapperRef = useRef<HTMLDivElement>(null);
    const tabRefs = useRef<React.RefObject<HTMLDivElement>[]>([]);
    const addBtnRef = useRef<HTMLDivElement>(null);
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
    const draggerRightRef = useRef<HTMLDivElement>(null);
    const draggerLeftRef = useRef<HTMLDivElement>(null);
    const workspaceSwitcherRef = useRef<HTMLDivElement>(null);
    const devLabelRef = useRef<HTMLDivElement>(null);
    const appMenuButtonRef = useRef<HTMLDivElement>(null);
    const tabWidthRef = useRef<number>(TAB_DEFAULT_WIDTH);
    const scrollableRef = useRef<boolean>(false);
    const updateStatusButtonRef = useRef<HTMLButtonElement>(null);
    const configErrorButtonRef = useRef<HTMLElement>(null);
    const prevAllLoadedRef = useRef<boolean>(false);
    const activeTabId = useAtomValue(atoms.staticTabId);
    const isFullScreen = useAtomValue(atoms.isFullScreen);

    const settings = useAtomValue(atoms.settingsAtom);

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

    const saveTabsPosition = useCallback(() => {
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

    const setSizeAndPosition = (animate?: boolean) => {
        const tabBar = tabBarRef.current;
        if (tabBar === null) return;

        const tabbarWrapperWidth = tabbarWrapperRef.current.getBoundingClientRect().width;
        const windowDragLeftWidth = draggerLeftRef.current.getBoundingClientRect().width;
        const addBtnWidth = addBtnRef.current.getBoundingClientRect().width;
        const updateStatusLabelWidth = updateStatusButtonRef.current?.getBoundingClientRect().width ?? 0;
        const configErrorWidth = configErrorButtonRef.current?.getBoundingClientRect().width ?? 0;
        const appMenuButtonWidth = appMenuButtonRef.current?.getBoundingClientRect().width ?? 0;
        const workspaceSwitcherWidth = workspaceSwitcherRef.current?.getBoundingClientRect().width ?? 0;
        const devLabelWidth = devLabelRef.current?.getBoundingClientRect().width ?? 0;

        const nonTabElementsWidth =
            windowDragLeftWidth +
            DRAGGER_RIGHT_MIN_WIDTH +
            addBtnWidth +
            updateStatusLabelWidth +
            configErrorWidth +
            appMenuButtonWidth +
            workspaceSwitcherWidth +
            devLabelWidth;
        const spaceForTabs = tabbarWrapperWidth - nonTabElementsWidth;

        const numberOfTabs = tabIds.length;

        // Compute the ideal width per tab by dividing the available space by the number of tabs
        let idealTabWidth = spaceForTabs / numberOfTabs;

        // Apply min/max constraints
        idealTabWidth = Math.max(TAB_MIN_WIDTH, Math.min(idealTabWidth, TAB_DEFAULT_WIDTH));

        // Determine if the tab bar needs to be scrollable
        const newScrollable = idealTabWidth * numberOfTabs > spaceForTabs;

        // Apply the calculated width and position to all tabs
        tabRefs.current.forEach((ref, index) => {
            if (ref.current) {
                if (animate) {
                    ref.current.classList.add("animate");
                } else {
                    ref.current.classList.remove("animate");
                }
                ref.current.style.width = `${idealTabWidth}px`;
                ref.current.style.transform = `translate3d(${index * idealTabWidth}px,0,0)`;
                ref.current.style.opacity = "1";
            }
        });

        // Update the state with the new tab width if it has changed
        if (idealTabWidth !== tabWidthRef.current) {
            tabWidthRef.current = idealTabWidth;
        }

        // Update the state with the new scrollable state if it has changed
        if (newScrollable !== scrollableRef.current) {
            scrollableRef.current = newScrollable;
        }

        // Initialize/destroy overlay scrollbars
        if (newScrollable) {
            osInstanceRef.current = OverlayScrollbars(tabBarRef.current, { ...(OS_OPTIONS as any) });
        } else {
            if (osInstanceRef.current) {
                osInstanceRef.current.destroy();
            }
        }
    };

    const handleResizeTabs = useCallback(() => {
        setSizeAndPosition();
        debounce(100, () => saveTabsPosition())();
    }, [tabIds, newTabId, isFullScreen]);

    const reinitVersion = useAtomValue(atoms.reinitVersion);
    useEffect(() => {
        if (reinitVersion > 0) {
            setSizeAndPosition();
        }
    }, [reinitVersion]);

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
            setSizeAndPosition(newTabId === null && prevAllLoadedRef.current);
            saveTabsPosition();
            if (!prevAllLoadedRef.current) {
                prevAllLoadedRef.current = true;
            }
        }
    }, [tabIds, tabsLoaded, newTabId, saveTabsPosition]);

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
        const tabWidth = tabWidthRef.current;
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
        // for macos, it's offset to make space for the window buttons
        const tabBarRectLeftOffset = tabBarRef.current.getBoundingClientRect().left;
        const incrementDecrement = tabBarRectLeftOffset * 0.05;
        const dragDirection = getDragDirection(currentX);
        const scrollable = scrollableRef.current;
        const tabWidth = tabWidthRef.current;

        // Scroll the tab bar if the dragged tab overflows the container bounds
        if (scrollable) {
            const { viewport } = osInstanceRef.current.elements();
            const currentScrollLeft = viewport.scrollLeft;

            if (event.clientX <= tabBarRectLeftOffset) {
                viewport.scrollLeft = Math.max(0, currentScrollLeft - incrementDecrement); // Scroll left
                if (viewport.scrollLeft !== currentScrollLeft) {
                    // Only adjust if the scroll actually changed
                    draggingTabDataRef.current.totalScrollOffset += currentScrollLeft - viewport.scrollLeft;
                }
            } else if (event.clientX >= tabBarRectWidth + tabBarRectLeftOffset) {
                viewport.scrollLeft = Math.min(viewport.scrollWidth, currentScrollLeft + incrementDecrement); // Scroll right
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

        ref.current!.style.transform = `translate3d(${currentX}px,0,0)`;
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
                    ref.current.style.transform = `translate3d(${index * tabWidth}px,0,0)`;
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
        const tabWidth = tabWidthRef.current;
        const finalLeftPosition = tabIndex * tabWidth;
        const ref = tabRefs.current.find((ref) => ref.current.dataset.tabId === draggingTab);
        if (ref.current) {
            ref.current.classList.add("animate");
            ref.current.style.transform = `translate3d(${finalLeftPosition}px,0,0)`;
        }

        if (dragged) {
            debounce(300, () => {
                // Reset styles
                tabRefs.current.forEach((ref) => {
                    ref.current.style.zIndex = "0";
                    ref.current.classList.remove("animate");
                });
                // Reset dragging state
                setDraggingTab(null);
                // Update workspace tab ids
                fireAndForget(async () => await WorkspaceService.UpdateTabIds(workspace.oid, tabIds));
            })();
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
        (event: React.MouseEvent<HTMLDivElement, MouseEvent>, tabId: string, ref: React.RefObject<HTMLDivElement>) => {
            if (event.button !== 0) return;

            const tabIndex = tabIds.indexOf(tabId);
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
            }
        },
        [tabIds, dragStartPositions]
    );

    const handleSelectTab = (tabId: string) => {
        if (!draggingTabDataRef.current.dragged) {
            setActiveTab(tabId);
        }
    };

    const handleAddTab = () => {
        createTab();
        tabsWrapperRef.current.style.transition;
        tabsWrapperRef.current.style.setProperty("--tabs-wrapper-transition", "width 0.1s ease");

        debounce(30, () => {
            if (scrollableRef.current) {
                const { viewport } = osInstanceRef.current.elements();
                viewport.scrollLeft = tabIds.length * tabWidthRef.current;
            }
        })();

        debounce(100, () => setNewTabId(null))();
    };

    const handleCloseTab = (event: React.MouseEvent<HTMLButtonElement, MouseEvent> | null, tabId: string) => {
        event?.stopPropagation();
        getApi().closeTab(tabId);
        tabsWrapperRef.current.style.setProperty("--tabs-wrapper-transition", "width 0.3s ease");
        deleteLayoutModelForTab(tabId);
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
        return tabIds.indexOf(tabId) === tabIds.indexOf(activeTabId) - 1;
    };

    function onEllipsisClick() {
        getApi().showContextMenu();
    }

    const tabsWrapperWidth = tabIds.length * tabWidthRef.current;
    const devLabel = isDev() ? (
        <div ref={devLabelRef} className="dev-label">
            <i className="fa fa-brands fa-dev fa-fw" />
        </div>
    ) : undefined;
    const appMenuButton =
        PLATFORM !== "darwin" && !settings["window:showmenubar"] ? (
            <div ref={appMenuButtonRef} className="app-menu-button" onClick={onEllipsisClick}>
                <i className="fa fa-ellipsis" />
            </div>
        ) : undefined;
    return (
        <div ref={tabbarWrapperRef} className="tab-bar-wrapper">
            <WindowDrag ref={draggerLeftRef} className="left" />
            {appMenuButton}
            {devLabel}
            <WorkspaceSwitcher />
            <div className="tab-bar" ref={tabBarRef} data-overlayscrollbars-initialize>
                <div className="tabs-wrapper" ref={tabsWrapperRef} style={{ width: `${tabsWrapperWidth}px` }}>
                    {tabIds.map((tabId, index) => {
                        return (
                            <Tab
                                key={tabId}
                                ref={tabRefs.current[index]}
                                id={tabId}
                                isFirst={index === 0}
                                onSelect={() => handleSelectTab(tabId)}
                                active={activeTabId === tabId}
                                onDragStart={(event) => handleDragStart(event, tabId, tabRefs.current[index])}
                                onClose={(event) => handleCloseTab(event, tabId)}
                                onLoaded={() => handleTabLoaded(tabId)}
                                isBeforeActive={isBeforeActive(tabId)}
                                isDragging={draggingTab === tabId}
                                tabWidth={tabWidthRef.current}
                                isNew={tabId === newTabId}
                            />
                        );
                    })}
                </div>
            </div>
            <div ref={addBtnRef} className="add-tab-btn" onClick={handleAddTab}>
                <i className="fa fa-solid fa-plus fa-fw" />
            </div>
            <WindowDrag ref={draggerRightRef} className="right" style={{ minWidth: DRAGGER_RIGHT_MIN_WIDTH }} />
            <UpdateStatusBanner buttonRef={updateStatusButtonRef} />
            <ConfigErrorIcon buttonRef={configErrorButtonRef} />
        </div>
    );
});

export { TabBar };
