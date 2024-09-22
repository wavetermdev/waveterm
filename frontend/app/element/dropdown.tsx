import { useHeight } from "@/app/hook/useHeight";
import { useWidth } from "@/app/hook/useWidth";
import clsx from "clsx";
import React, { memo, useLayoutEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";

import "./dropdown.less";

type DropdownItem = {
    label: string;
    onClick?: () => void;
    subItems?: DropdownItem[];
};

interface DropdownProps {
    items: DropdownItem[];
    anchorRef: React.RefObject<HTMLElement>;
    boundaryRef?: React.RefObject<HTMLElement>;
    className?: string;
}

const Dropdown = memo(({ items, anchorRef, boundaryRef, className }: DropdownProps) => {
    const [visibleSubMenus, setVisibleSubMenus] = useState<{ [key: number]: any }>({}); // Track visibility of each submenu (nested object)
    const [subMenuPosition, setSubMenuPosition] = useState<{ [key: number]: { top: number; left: number } }>({});
    const [position, setPosition] = useState({ top: 0, left: 0 });
    const dropdownRef = useRef<HTMLDivElement>(null);
    const subMenuRefs = useRef<Array<React.RefObject<HTMLDivElement>>>([]); // Array of refs for each submenu

    const effectiveBoundaryRef: React.RefObject<HTMLElement> = boundaryRef ?? { current: document.documentElement };
    const width = useWidth(effectiveBoundaryRef);
    const height = useHeight(effectiveBoundaryRef);

    // Add ref for each submenu item dynamically
    if (subMenuRefs.current.length !== items.length) {
        subMenuRefs.current = Array(items.length)
            .fill(null)
            .map((_, i) => subMenuRefs.current[i] || React.createRef<HTMLDivElement>());
    }

    useLayoutEffect(() => {
        if (anchorRef.current && dropdownRef.current) {
            const anchorRect = anchorRef.current.getBoundingClientRect();
            let boundaryRect = effectiveBoundaryRef.current?.getBoundingClientRect() || {
                top: 0,
                left: 0,
                bottom: window.innerHeight,
                right: window.innerWidth,
            };

            let top = anchorRect.bottom;
            let left = anchorRect.left;

            // Adjust if overflowing the right boundary
            if (left + dropdownRef.current.offsetWidth > boundaryRect.right) {
                left = boundaryRect.right - dropdownRef.current.offsetWidth;
            }

            // Adjust if overflowing the bottom boundary
            if (top + dropdownRef.current.offsetHeight > boundaryRect.bottom) {
                top = boundaryRect.bottom - dropdownRef.current.offsetHeight;
            }

            setPosition({ top, left });
        }
    }, [width, height]);

    const handleSubMenuPosition = (
        parentIndex: number,
        index: number,
        itemRect: DOMRect,
        parentRef: React.RefObject<HTMLDivElement> | React.RefObject<HTMLElement>
    ) => {
        const subMenuRef = subMenuRefs.current[index].current;
        const parentMenuRef = parentRef.current;
        if (subMenuRef && parentMenuRef) {
            const boundaryRect = effectiveBoundaryRef.current?.getBoundingClientRect() || {
                top: 0,
                left: 0,
                bottom: window.innerHeight,
                right: window.innerWidth,
            };

            // Position to the right of the hovered item
            let left = itemRect.width - 5;

            // Adjust to the left if overflowing right boundary
            if (left + subMenuRef.offsetWidth > boundaryRect.right) {
                left = itemRect.left - subMenuRef.offsetWidth; // Align left if overflow
            }

            // Calculate top based on parent's position
            const parentRect = parentMenuRef.getBoundingClientRect();
            const top = itemRect.top - parentRect.top;

            setSubMenuPosition((prev) => ({
                ...prev,
                [parentIndex]: {
                    ...prev[parentIndex],
                    [index]: { top, left },
                },
            }));
        }
    };

    // Recursive function to update visibility for multi-level submenus
    const updateVisibility = (currentState: any, parentIndex: number | null, index: number, item: DropdownItem) => {
        // Recursively clone the current state
        const updatedState = { ...currentState };

        // Handle the case where we need to update a nested level (parentIndex is not null)
        if (parentIndex !== null) {
            // Ensure that the parentIndex exists in the state
            if (!updatedState[parentIndex]) {
                updatedState[parentIndex] = {};
            }

            // Reset visibility for all nested submenus at this level
            for (let key in updatedState[parentIndex]) {
                if (updatedState[parentIndex][key]?.visible !== undefined) {
                    updatedState[parentIndex][key].visible = false;
                }
            }

            // Update the submenu at the correct level
            updatedState[parentIndex] = updateVisibility(
                updatedState[parentIndex], // Pass the state for the current level
                null, // Stop recursion when we reach the correct level
                index,
                item
            );
        } else {
            // We're at the correct level (root or no parent), so set all siblings' visibility to false
            for (let key in updatedState) {
                if (updatedState[key]?.visible !== undefined) {
                    updatedState[key].visible = false;
                }
            }
            // Set the current index submenu to visible
            updatedState[index] = { visible: true, label: item.label };
        }

        return updatedState;
    };

    const handleMouseEnterItem = (
        event: React.MouseEvent<HTMLDivElement, MouseEvent>,
        parentIndex: number | null,
        index: number,
        item: DropdownItem,
        parentRef: React.RefObject<HTMLDivElement> | React.RefObject<HTMLElement>,
        reason?: string
    ) => {
        event.stopPropagation();
        setVisibleSubMenus((prev) => {
            return updateVisibility(prev, parentIndex, index, item);
        });

        if (subMenuRefs.current[index].current) {
            const itemRect = subMenuRefs.current[index].current!.parentElement?.getBoundingClientRect();
            if (itemRect) {
                handleSubMenuPosition(parentIndex ?? index, index, itemRect, parentRef);
            }
        }
    };

    const handleMouseLeaveItem = (parentIndex: number | null, index: number) => {
        setTimeout(() => {
            setVisibleSubMenus((prev) => ({
                ...prev,
                [parentIndex ?? index]: {
                    ...prev[parentIndex ?? index],
                    [index]: { visible: false, label: prev[parentIndex ?? index][index].label }, // Maintain label
                },
            })); // Hide the specific submenu
        }, 200);
    };

    // Recursive renderSubMenu to handle multiple nested submenus
    const renderSubMenu = (
        subItems: DropdownItem[],
        parentIndex: number | null,
        index: number,
        parentRef: React.RefObject<HTMLDivElement>
    ) => {
        return (
            <div
                className="dropdown sub-dropdown"
                ref={subMenuRefs.current[index]} // Use unique ref for each submenu
                style={{
                    top: subMenuPosition[parentIndex ?? index]?.[index]?.top || 0,
                    left: subMenuPosition[parentIndex ?? index]?.[index]?.left || 0,
                }}
            >
                {subItems.map((item, idx) => (
                    <div
                        key={`${index}-${idx}`}
                        className="dropdown-item"
                        onMouseOver={(event) =>
                            handleMouseEnterItem(
                                event,
                                index,
                                idx,
                                item,
                                subMenuRefs.current[index],
                                "submenu item hovered"
                            )
                        }
                        onClick={item.onClick}
                    >
                        {item.label}
                        {item.subItems && <span className="arrow">▶</span>}
                        {visibleSubMenus[index]?.[idx]?.visible &&
                            item.subItems &&
                            renderSubMenu(item.subItems, index, idx, subMenuRefs.current[index])}
                    </div>
                ))}
            </div>
        );
    };

    if (!anchorRef?.current) {
        return null;
    }

    return ReactDOM.createPortal(
        <div
            className={clsx("dropdown", className)}
            ref={dropdownRef}
            style={{ top: position.top, left: position.left }}
        >
            {items.map((item, index) => (
                <div
                    key={index}
                    className="dropdown-item"
                    onMouseOver={(event) =>
                        handleMouseEnterItem(event, null, index, item, dropdownRef, "root menu item hovered")
                    }
                    onClick={item.onClick}
                >
                    {item.label}
                    {item.subItems && <span className="arrow">▶</span>}
                    {visibleSubMenus[index]?.visible &&
                        item.subItems &&
                        renderSubMenu(item.subItems, null, index, dropdownRef)}
                </div>
            ))}
        </div>,
        document.body
    );
});

export { Dropdown };
