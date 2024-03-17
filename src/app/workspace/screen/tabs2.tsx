import React, { useState, useCallback, useRef, useEffect } from "react";
import { ScreenTab } from "./tab2";

import "./tabs2.less";

const DEFAULT_TAB_WIDTH = 100;

const TabsContainer: React.FC = () => {
    const [tabs, setTabs] = useState(["Tab1"]);
    const [activeTab, setActiveTab] = useState("Tab1");
    const [tabWidth, setTabWidth] = useState(DEFAULT_TAB_WIDTH);
    const [draggedTab, setDraggedTab] = useState<string | null>(null);
    const [dragStartPositions, setDragStartPositions] = useState<number[]>([]);
    const tabContainerRef = useRef<HTMLDivElement>(null);
    const addBtnRef = useRef<HTMLDivElement>(null);
    let prevDelta: number;
    let prevDragDirection: string;
    let draggedRemoved: boolean;
    let shrunk: boolean;

    const updateTabPositions = useCallback(() => {
        if (tabContainerRef.current) {
            const tabElements = Array.from(tabContainerRef.current.querySelectorAll(".tab"));
            let newStartPositions = [];
            let cumulativeLeft = 0; // Start from the left edge

            tabElements.forEach((tab) => {
                newStartPositions.push(cumulativeLeft);
                cumulativeLeft += tab.getBoundingClientRect().width; // Add each tab's actual width to the cumulative position
            });

            setDragStartPositions(newStartPositions);
        }
    }, [tabs]);

    useEffect(() => {
        updateTabPositions();
    }, [tabs, updateTabPositions]);

    const resizeTabs = useCallback(() => {
        if (tabContainerRef.current) {
            const containerWidth = tabContainerRef.current.getBoundingClientRect().width;
            const numberOfTabs = tabs.length;
            const totalDefaultTabWidth = numberOfTabs * DEFAULT_TAB_WIDTH;

            if (totalDefaultTabWidth > containerWidth) {
                // Case where resizing is needed due to limited container width
                shrunk = true;
                const newTabWidth = containerWidth / numberOfTabs;
                setTabWidth(newTabWidth);
                tabs.forEach((tab, index) => {
                    const tabElement = tabContainerRef.current.querySelector(`[data-tab-name="${tab}"]`) as HTMLElement;
                    tabElement.style.width = `${newTabWidth}px`;
                    tabElement.style.left = `${index * newTabWidth}px`;
                });
            } else if (shrunk || totalDefaultTabWidth < containerWidth) {
                // Case where tabs were previously shrunk or there is enough space for default width tabs
                shrunk = false;
                setTabWidth(DEFAULT_TAB_WIDTH);
                tabs.forEach((tab, index) => {
                    const tabElement = tabContainerRef.current.querySelector(`[data-tab-name="${tab}"]`) as HTMLElement;
                    tabElement.style.width = `${DEFAULT_TAB_WIDTH}px`;
                    tabElement.style.left = `${index * DEFAULT_TAB_WIDTH}px`;
                });
            }

            // Update the position of the Add Tab button
            const addButtonElement = addBtnRef.current;
            if (addButtonElement) {
                const tabElements = Array.from(tabContainerRef.current.querySelectorAll(".tab"));
                const lastTab = tabElements[tabElements.length - 1];
                const lastTabRect = lastTab.getBoundingClientRect();
                addButtonElement.style.position = "absolute";
                addButtonElement.style.left = `${lastTabRect.right - containerWidth + containerWidth}px`;
            }

            updateTabPositions();
        }
    }, [tabs.length, updateTabPositions]);

    // Resize tabs when the number of tabs or the window size changes
    useEffect(() => {
        resizeTabs();
        window.addEventListener("resize", resizeTabs);

        return () => {
            window.removeEventListener("resize", resizeTabs);
        };
    }, [resizeTabs]);

    const onDragStart = useCallback(
        (name: string, ref: React.RefObject<HTMLDivElement>) => {
            setDraggedTab(name);
            let tabIndex = tabs.indexOf(name);
            const tabStartX = dragStartPositions[tabIndex]; // Starting X position of the tab
            const containerWidth = tabContainerRef.current.getBoundingClientRect().width;

            if (ref.current) {
                let initialOffsetX: number | null = null;

                const handleMouseMove = (event: MouseEvent) => {
                    if (initialOffsetX === null) {
                        initialOffsetX = event.clientX - tabStartX;
                    }
                    let currentX = event.clientX - initialOffsetX;

                    // Constrain movement within the container bounds
                    if (tabContainerRef.current) {
                        const numberOfTabs = tabs.length;
                        const totalDefaultTabWidth = numberOfTabs * DEFAULT_TAB_WIDTH;
                        const containerRect = tabContainerRef.current.getBoundingClientRect();
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

                    ref.current.style.transform = `translateX(${currentX - tabStartX}px)`;
                    ref.current.style.zIndex = "100";

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
                        for (let i = tabIndex + 1; i < tabs.length; i++) {
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

                    // Rearrange the tabs temporarily
                    if (newTabIndex !== tabIndex) {
                        const tempTabs = Array.from(tabs);

                        // Remove the dragged tab if not already done
                        if (!draggedRemoved) {
                            tabs.splice(tabIndex, 1);
                            draggedRemoved = true;
                        }

                        // Find current index of the dragged tab in tempTabs
                        const currentIndexOfDraggedTab = tabs.indexOf(name);

                        // Move the dragged tab to its new position
                        if (currentIndexOfDraggedTab !== -1) {
                            tabs.splice(currentIndexOfDraggedTab, 1);
                        }
                        tabs.splice(newTabIndex, 0, name);

                        // Update visual positions of the tabs
                        tabs.forEach((tempTab, index) => {
                            const tabElement = tabContainerRef.current.querySelector(
                                `[data-tab-name="${tempTab}"]`
                            ) as HTMLElement;
                            if (tempTab !== name) {
                                tabElement.style.left = `${index * tabWidth}px`;
                            }
                        });

                        tabIndex = newTabIndex;
                    }
                };

                document.addEventListener("mousemove", handleMouseMove);

                const handleMouseUp = (event: MouseEvent) => {
                    document.removeEventListener("mousemove", handleMouseMove);
                    document.removeEventListener("mouseup", handleMouseUp);

                    if (ref.current) {
                        // Reset transform for all tabs
                        const tabElements = tabContainerRef.current.querySelectorAll(".tab");
                        tabElements.forEach((tab) => {
                            const htmlTab = tab as HTMLElement;
                            htmlTab.style.transform = "";
                            htmlTab.style.zIndex = "0";
                        });

                        // Update the final position of the dragged tab
                        const draggedTab = tabs[tabIndex];
                        const finalLeftPosition = tabIndex * tabWidth;
                        const draggedTabElement = tabContainerRef.current.querySelector(
                            `[data-tab-name="${draggedTab}"]`
                        ) as HTMLElement;
                        if (draggedTabElement) {
                            draggedTabElement.style.left = `${finalLeftPosition}px`;
                        }
                    }

                    setDraggedTab(null);
                    draggedRemoved = false;
                };

                document.addEventListener("mouseup", handleMouseUp);
            }
        },
        [tabs, dragStartPositions]
    );

    const selectTab = (tabName: string) => {
        setActiveTab(tabName);
    };

    const addTab = () => {
        const newTabName = `Tab${tabs.length + 1}`;
        setTabs([...tabs, newTabName]);
        setActiveTab(newTabName);
    };

    return (
        <div className="tabs-top-container">
            <div className="tab-container" ref={tabContainerRef}>
                {tabs.map((tab) => (
                    <ScreenTab
                        key={tab}
                        name={tab}
                        onSelect={selectTab}
                        active={activeTab === tab}
                        onDragStart={onDragStart}
                    />
                ))}
            </div>
            <div ref={addBtnRef} className="add-tab-button" onClick={addTab} style={{ left: DEFAULT_TAB_WIDTH }}>
                +
            </div>
        </div>
    );
};

export default TabsContainer;
