import { useHeight } from "@/app/hook/useHeight";
import { useWidth } from "@/app/hook/useWidth";
import clsx from "clsx";
import React, { memo, useLayoutEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import "./dropdown.less";

const SubMenu = memo(
    ({
        subItems,
        parentKey,
        subMenuPosition,
        visibleSubMenus,
        hoveredItems,
        handleMouseEnterItem,
        subMenuRefs,
    }: {
        subItems: DropdownItem[];
        parentKey: string;
        subMenuPosition: any;
        visibleSubMenus: any;
        hoveredItems: string[];
        handleMouseEnterItem: any;
        subMenuRefs: any;
    }) => {
        // Ensure a ref exists for each submenu
        subItems.forEach((_, idx) => {
            const newKey = `${parentKey}-${idx}`;
            if (!subMenuRefs.current[newKey]) {
                subMenuRefs.current[newKey] = React.createRef<HTMLDivElement>();
            }
        });

        const subMenu = (
            <div
                className="dropdown sub-dropdown"
                ref={subMenuRefs.current[parentKey]}
                style={{
                    top: subMenuPosition[parentKey]?.top || 0,
                    left: subMenuPosition[parentKey]?.left || 0,
                    position: "absolute",
                    zIndex: 1000,
                    opacity: visibleSubMenus[parentKey]?.visible ? 1 : 0,
                }}
            >
                {subItems.map((item, idx) => {
                    const newKey = `${parentKey}-${idx}`; // Full hierarchical key
                    const isActive = hoveredItems.includes(newKey); // Check if this item is hovered or in the hierarchy

                    return (
                        <div
                            key={newKey}
                            className={clsx("dropdown-item", { active: isActive })} // Add "active" class if the item or ancestor is hovered
                            onMouseEnter={(event) => handleMouseEnterItem(event, parentKey, idx, item)}
                        >
                            {item.label}
                            {item.subItems && <span className="arrow">▶</span>}
                            {visibleSubMenus[newKey]?.visible && item.subItems && (
                                <SubMenu
                                    subItems={item.subItems}
                                    parentKey={newKey}
                                    subMenuPosition={subMenuPosition}
                                    visibleSubMenus={visibleSubMenus}
                                    hoveredItems={hoveredItems} // Pass hoveredItems to submenus
                                    handleMouseEnterItem={handleMouseEnterItem}
                                    subMenuRefs={subMenuRefs}
                                />
                            )}
                        </div>
                    );
                })}
            </div>
        );
        return ReactDOM.createPortal(subMenu, document.body);
    }
);

type DropdownItem = {
    label: string;
    onClick?: () => void;
    subItems?: DropdownItem[];
};

const Dropdown = memo(
    ({
        items,
        anchorRef,
        boundaryRef,
        className,
    }: {
        items: DropdownItem[];
        anchorRef: React.RefObject<HTMLElement>;
        boundaryRef?: React.RefObject<HTMLElement>;
        className?: string;
    }) => {
        const [visibleSubMenus, setVisibleSubMenus] = useState<{ [key: string]: any }>({});
        const [hoveredItems, setHoveredItems] = useState<string[]>([]); // Track hovered items and ancestors
        const [subMenuPosition, setSubMenuPosition] = useState<{
            [key: string]: { top: number; left: number; label: string };
        }>({});
        const [position, setPosition] = useState({ top: 0, left: 0 });
        const dropdownRef = useRef<HTMLDivElement>(null);
        const subMenuRefs = useRef<{ [key: string]: React.RefObject<HTMLDivElement> }>({});

        const effectiveBoundaryRef: React.RefObject<HTMLElement> = boundaryRef ?? { current: document.documentElement };
        const width = useWidth(effectiveBoundaryRef);
        const height = useHeight(effectiveBoundaryRef);

        // Add refs for top-level menus
        items.forEach((_, idx) => {
            const key = `${idx}`;
            if (!subMenuRefs.current[key]) {
                subMenuRefs.current[key] = React.createRef<HTMLDivElement>();
            }
        });

        console.log("hoveredItems", hoveredItems);

        useLayoutEffect(() => {
            if (anchorRef.current && dropdownRef.current) {
                const anchorRect = anchorRef.current.getBoundingClientRect();
                const scrollTop = window.scrollY || document.documentElement.scrollTop;
                const scrollLeft = window.scrollX || document.documentElement.scrollLeft;

                let top = anchorRect.bottom + scrollTop; // Adjust top for scroll position
                let left = anchorRect.left + scrollLeft; // Adjust left for scroll position

                const boundaryRect = effectiveBoundaryRef.current?.getBoundingClientRect() || {
                    top: 0,
                    left: 0,
                    bottom: window.innerHeight,
                    right: window.innerWidth,
                };

                // Adjust if overflowing the right boundary
                if (left + dropdownRef.current.offsetWidth > boundaryRect.right + scrollLeft) {
                    left = boundaryRect.right + scrollLeft - dropdownRef.current.offsetWidth;
                }

                // Adjust if overflowing the bottom boundary
                if (top + dropdownRef.current.offsetHeight > boundaryRect.bottom + scrollTop) {
                    top = boundaryRect.bottom + scrollTop - dropdownRef.current.offsetHeight;
                }

                setPosition({ top, left });
            }
        }, [width, height]);

        // Position submenus based on available space and scroll position
        const handleSubMenuPosition = (
            key: string,
            itemRect: DOMRect,
            parentRef: React.RefObject<HTMLDivElement>,
            label: string
        ) => {
            setTimeout(() => {
                const subMenuRef = subMenuRefs.current[key]?.current;
                if (!subMenuRef) return;

                const scrollTop = window.scrollY || document.documentElement.scrollTop;
                const scrollLeft = window.scrollX || document.documentElement.scrollLeft;

                const boundaryRect = effectiveBoundaryRef.current?.getBoundingClientRect() || {
                    top: 0,
                    left: 0,
                    bottom: window.innerHeight,
                    right: window.innerWidth,
                };

                const submenuWidth = subMenuRef.offsetWidth;
                const submenuHeight = subMenuRef.offsetHeight;

                let left = itemRect.right + scrollLeft - 2; // Adjust for horizontal scroll
                let top = itemRect.top + scrollTop; // Adjust for vertical scroll

                // Adjust to the left if overflowing the right boundary
                if (left + submenuWidth > window.innerWidth + scrollLeft) {
                    left = itemRect.left + scrollLeft - submenuWidth;
                }

                // Adjust if the submenu overflows the bottom boundary
                if (top + submenuHeight > window.innerHeight + scrollTop) {
                    top = window.innerHeight + scrollTop - submenuHeight - 10;
                }

                setSubMenuPosition((prev) => ({
                    ...prev,
                    [key]: { top, left, label },
                }));
            }, 0);
        };

        const handleMouseEnterItem = (
            event: React.MouseEvent<HTMLDivElement, MouseEvent>,
            parentKey: string | null,
            index: number,
            item: DropdownItem
        ) => {
            event.stopPropagation();

            const key = parentKey ? `${parentKey}-${index}` : `${index}`;

            setVisibleSubMenus((prev) => {
                const updatedState = { ...prev };
                updatedState[key] = { visible: true, label: item.label };

                const ancestors = key.split("-").reduce((acc, part, idx) => {
                    if (idx === 0) return [part];
                    return [...acc, `${acc[idx - 1]}-${part}`];
                }, [] as string[]);

                ancestors.forEach((ancestorKey) => {
                    if (updatedState[ancestorKey]) {
                        updatedState[ancestorKey].visible = true;
                    }
                });

                for (const pkey in updatedState) {
                    if (!ancestors.includes(pkey) && pkey !== key) {
                        updatedState[pkey].visible = false;
                    }
                }

                return updatedState;
            });

            // Update the hovered items state (including ancestors)
            const newHoveredItems = key.split("-").reduce((acc, part, idx) => {
                if (idx === 0) return [part];
                return [...acc, `${acc[idx - 1]}-${part}`];
            }, [] as string[]);

            setHoveredItems(newHoveredItems);

            const itemRect = event.currentTarget.getBoundingClientRect();
            handleSubMenuPosition(key, itemRect, dropdownRef, item.label);
        };

        return ReactDOM.createPortal(
            <div
                className={clsx("dropdown", className)}
                ref={dropdownRef}
                style={{ top: position.top, left: position.left }}
            >
                {items.map((item, index) => {
                    const key = `${index}`;
                    const isActive = hoveredItems.includes(key); // Check if the current item is hovered or in the hierarchy

                    return (
                        <div
                            key={key}
                            className={clsx("dropdown-item", { active: isActive })} // Highlight hovered items and ancestors
                            onMouseEnter={(event) => handleMouseEnterItem(event, null, index, item)}
                        >
                            {item.label}
                            {item.subItems && <span className="arrow">▶</span>}
                            {visibleSubMenus[key]?.visible && item.subItems && (
                                <SubMenu
                                    subItems={item.subItems}
                                    parentKey={key}
                                    subMenuPosition={subMenuPosition}
                                    visibleSubMenus={visibleSubMenus}
                                    hoveredItems={hoveredItems} // Pass hoveredItems to submenus
                                    handleMouseEnterItem={handleMouseEnterItem}
                                    subMenuRefs={subMenuRefs}
                                />
                            )}
                        </div>
                    );
                })}
            </div>,
            document.body
        );
    }
);

export { Dropdown };
