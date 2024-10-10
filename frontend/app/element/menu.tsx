// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import clsx from "clsx";
import React, { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";

import { useDimensionsWithExistingRef } from "@/app/hook/useDimensions";
import "./menu.less";

type MenuItem = {
    label: string;
    subItems?: MenuItem[];
    onClick?: (e) => void;
};

const SubMenu = memo(
    ({
        subItems,
        parentKey,
        subMenuPosition,
        visibleSubMenus,
        hoveredItems,
        subMenuRefs,
        handleMouseEnterItem,
        handleOnClick,
        renderMenu,
        renderMenuItem,
    }: {
        subItems: MenuItem[];
        parentKey: string;
        subMenuPosition: {
            [key: string]: { top: number; left: number; label: string };
        };
        visibleSubMenus: { [key: string]: any };
        hoveredItems: string[];
        subMenuRefs: React.MutableRefObject<{ [key: string]: React.RefObject<HTMLDivElement> }>;
        handleMouseEnterItem: (
            event: React.MouseEvent<HTMLDivElement, MouseEvent>,
            parentKey: string | null,
            index: number,
            item: MenuItem
        ) => void;
        handleOnClick: (e: React.MouseEvent<HTMLDivElement>, item: MenuItem) => void;
        renderMenu?: (subMenu: JSX.Element, props: any) => JSX.Element;
        renderMenuItem?: (item: MenuItem, props: any) => JSX.Element;
    }) => {
        subItems.forEach((_, idx) => {
            const newKey = `${parentKey}-${idx}`;
            if (!subMenuRefs.current[newKey]) {
                subMenuRefs.current[newKey] = React.createRef<HTMLDivElement>();
            }
        });

        const position = subMenuPosition[parentKey];
        const isPositioned = position && position.top !== undefined && position.left !== undefined;

        const subMenu = (
            <div
                className="menu sub-menu"
                ref={subMenuRefs.current[parentKey]}
                style={{
                    top: position?.top || 0,
                    left: position?.left || 0,
                    position: "absolute",
                    zIndex: 1000,
                    visibility: visibleSubMenus[parentKey]?.visible && isPositioned ? "visible" : "hidden",
                }}
            >
                {subItems.map((item, idx) => {
                    const newKey = `${parentKey}-${idx}`;
                    const isActive = hoveredItems.includes(newKey);

                    const menuItemProps = {
                        className: clsx("menu-item", { active: isActive }),
                        onMouseEnter: (event: React.MouseEvent<HTMLDivElement, MouseEvent>) =>
                            handleMouseEnterItem(event, parentKey, idx, item),
                        onClick: (e: React.MouseEvent<HTMLDivElement>) => handleOnClick(e, item),
                    };

                    const renderedItem = renderMenuItem ? (
                        renderMenuItem(item, menuItemProps) // Remove portal here
                    ) : (
                        <div key={newKey} {...menuItemProps}>
                            <span className="label">{item.label}</span>
                            {item.subItems && <i className="fa-sharp fa-solid fa-chevron-right"></i>}
                        </div>
                    );

                    return (
                        <React.Fragment key={newKey}>
                            {renderedItem}
                            {visibleSubMenus[newKey]?.visible && item.subItems && (
                                <SubMenu
                                    subItems={item.subItems}
                                    parentKey={newKey}
                                    subMenuPosition={subMenuPosition}
                                    visibleSubMenus={visibleSubMenus}
                                    hoveredItems={hoveredItems}
                                    handleMouseEnterItem={handleMouseEnterItem}
                                    handleOnClick={handleOnClick}
                                    subMenuRefs={subMenuRefs}
                                    renderMenu={renderMenu}
                                    renderMenuItem={renderMenuItem}
                                />
                            )}
                        </React.Fragment>
                    );
                })}
            </div>
        );

        return ReactDOM.createPortal(renderMenu ? renderMenu(subMenu, { parentKey }) : subMenu, document.body);
    }
);

const Menu = memo(
    ({
        items,
        anchorRef,
        scopeRef,
        initialPosition,
        className,
        setVisibility,
        renderMenu,
        renderMenuItem,
    }: {
        items: MenuItem[];
        anchorRef: React.RefObject<any>;
        scopeRef?: React.RefObject<HTMLElement>;
        initialPosition?: { top: number; left: number };
        className?: string;
        setVisibility: (_: boolean) => void;
        renderMenu?: (subMenu: JSX.Element, props: any) => JSX.Element;
        renderMenuItem?: (item: MenuItem, props: any) => JSX.Element;
    }) => {
        const [visibleSubMenus, setVisibleSubMenus] = useState<{ [key: string]: any }>({});
        const [hoveredItems, setHoveredItems] = useState<string[]>([]);
        const [subMenuPosition, setSubMenuPosition] = useState<{
            [key: string]: { top: number; left: number; label: string };
        }>({});
        const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
        const menuRef = useRef<HTMLDivElement>(null);
        const subMenuRefs = useRef<{ [key: string]: React.RefObject<HTMLDivElement> }>({});
        const domRect = useDimensionsWithExistingRef(scopeRef, 30);
        const width = domRect?.width ?? 0;
        const height = domRect?.height ?? 0;

        items.forEach((_, idx) => {
            const key = `${idx}`;
            if (!subMenuRefs.current[key]) {
                subMenuRefs.current[key] = React.createRef<HTMLDivElement>();
            }
        });

        useLayoutEffect(() => {
            const shadowOffset = 10; // Adjust for box shadow space

            if (initialPosition) {
                // Adjust position if initialPosition is provided
                let { top, left } = initialPosition;

                const scrollTop = window.scrollY || document.documentElement.scrollTop;
                const scrollLeft = window.scrollX || document.documentElement.scrollLeft;

                const menuWidth = menuRef.current?.offsetWidth || 0;
                const menuHeight = menuRef.current?.offsetHeight || 0;

                const boundaryTop = 0;
                const boundaryLeft = 0;
                const boundaryRight = window.innerWidth + scrollLeft;
                const boundaryBottom = window.innerHeight + scrollTop;

                // Adjust if the menu overflows the right boundary
                if (left + menuWidth > boundaryRight) {
                    left = boundaryRight - menuWidth - shadowOffset; // Shift left more for shadow
                }

                // Adjust if the menu overflows the bottom boundary: move the menu upwards so its bottom edge aligns with the initial position
                if (top + menuHeight > boundaryBottom) {
                    top = initialPosition.top - menuHeight - shadowOffset; // Shift up for shadow
                }

                // Adjust if the menu overflows the left boundary
                if (left < boundaryLeft) {
                    left = boundaryLeft + shadowOffset; // Add shadow offset from the left edge
                }

                // Adjust if the menu overflows the top boundary
                if (top < boundaryTop) {
                    top = boundaryTop + shadowOffset; // Add shadow offset from the top edge
                }

                setPosition({ top, left });
            } else if (anchorRef.current && menuRef.current) {
                // Calculate position based on anchorRef if it exists
                const anchorRect = anchorRef.current.getBoundingClientRect();
                const scrollTop = window.scrollY || document.documentElement.scrollTop;
                const scrollLeft = window.scrollX || document.documentElement.scrollLeft;

                let top = anchorRect.bottom + scrollTop;
                let left = anchorRect.left + scrollLeft;

                const menuWidth = menuRef.current.offsetWidth;
                const menuHeight = menuRef.current.offsetHeight;

                const boundaryTop = 0;
                const boundaryLeft = 0;
                const boundaryRight = window.innerWidth + scrollLeft;
                const boundaryBottom = window.innerHeight + scrollTop;

                // Adjust if the menu overflows the right boundary
                if (left + menuWidth > boundaryRight) {
                    left = boundaryRight - menuWidth;
                }

                // Adjust if the menu overflows the bottom boundary: move the menu upwards so its bottom edge aligns with the anchor top
                if (top + menuHeight > boundaryBottom) {
                    top = anchorRect.top + scrollTop - menuHeight;
                }

                // Adjust if the menu overflows the left boundary
                if (left < boundaryLeft) {
                    left = boundaryLeft;
                }

                // Adjust if the menu overflows the top boundary
                if (top < boundaryTop) {
                    top = boundaryTop;
                }

                setPosition({ top, left });
            } else {
                console.warn("Neither initialPosition nor anchorRef provided. Defaulting to { top: 0, left: 0 }.");
            }
        }, [width, height, initialPosition]);

        useEffect(() => {
            const handleClickOutside = (event: MouseEvent) => {
                const isClickInsideDropdown = menuRef.current && menuRef.current.contains(event.target as Node);

                const isClickInsideAnchor = anchorRef?.current
                    ? anchorRef.current.contains(event.target as Node)
                    : false;

                const isClickInsideSubMenus = Object.keys(subMenuRefs.current).some(
                    (key) =>
                        subMenuRefs.current[key]?.current &&
                        subMenuRefs.current[key]?.current.contains(event.target as Node)
                );

                if (!isClickInsideDropdown && !isClickInsideAnchor && !isClickInsideSubMenus) {
                    setVisibility(false);
                }
            };

            scopeRef?.current?.addEventListener("mousedown", handleClickOutside);

            return () => {
                scopeRef?.current?.removeEventListener("mousedown", handleClickOutside);
            };
        }, []);

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

                const submenuWidth = subMenuRef.offsetWidth;
                const submenuHeight = subMenuRef.offsetHeight;

                let left = itemRect.right + scrollLeft - 2; // Adjust for horizontal scroll
                let top = itemRect.top - 2 + scrollTop; // Adjust for vertical scroll

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
            item: MenuItem
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

            const newHoveredItems = key.split("-").reduce((acc, part, idx) => {
                if (idx === 0) return [part];
                return [...acc, `${acc[idx - 1]}-${part}`];
            }, [] as string[]);

            setHoveredItems(newHoveredItems);

            const itemRect = event.currentTarget.getBoundingClientRect();
            handleSubMenuPosition(key, itemRect, menuRef, item.label);
        };

        const handleOnClick = (e: React.MouseEvent<HTMLDivElement>, item: MenuItem) => {
            e.stopPropagation();
            item.onClick && item.onClick(e);
        };

        // const handleKeyDown = useCallback(
        //     (waveEvent: WaveKeyboardEvent): boolean => {
        //         if (keyutil.checkKeyPressed(waveEvent, "ArrowDown")) {
        //             setFocusedIndex((prev) => (prev + 1) % items.length); // Move down
        //             return true;
        //         }
        //         if (keyutil.checkKeyPressed(waveEvent, "ArrowUp")) {
        //             setFocusedIndex((prev) => (prev - 1 + items.length) % items.length); // Move up
        //             return true;
        //         }
        //         if (keyutil.checkKeyPressed(waveEvent, "ArrowRight")) {
        //             if (items[focusedIndex].subItems) {
        //                 setSubmenuOpen(focusedIndex); // Open the submenu
        //             }
        //             return true;
        //         }
        //         if (keyutil.checkKeyPressed(waveEvent, "ArrowLeft")) {
        //             if (submenuOpen !== null) {
        //                 setSubmenuOpen(null); // Close the submenu
        //             }
        //             return true;
        //         }
        //         if (keyutil.checkKeyPressed(waveEvent, "Enter") || keyutil.checkKeyPressed(waveEvent, " ")) {
        //             if (items[focusedIndex].onClick) {
        //                 items[focusedIndex].onClick(); // Trigger click
        //             }
        //             return true;
        //         }
        //         if (keyutil.checkKeyPressed(waveEvent, "Escape")) {
        //             setVisibility(false); // Close the menu
        //             return true;
        //         }
        //         return false;
        //     },
        //     [focusedIndex, submenuOpen, items, setVisibility]
        // );

        const menuMenu = (
            <div className={clsx("menu", className)} ref={menuRef} style={{ top: position.top, left: position.left }}>
                {items.map((item, index) => {
                    const key = `${index}`;
                    const isActive = hoveredItems.includes(key);

                    const menuItemProps = {
                        className: clsx("menu-item", { active: isActive }),
                        onMouseEnter: (event: React.MouseEvent<HTMLDivElement, MouseEvent>) =>
                            handleMouseEnterItem(event, null, index, item),
                        onClick: (e: React.MouseEvent<HTMLDivElement>) => handleOnClick(e, item),
                    };

                    const renderedItem = renderMenuItem ? (
                        renderMenuItem(item, menuItemProps)
                    ) : (
                        <div key={key} {...menuItemProps}>
                            <span className="label">{item.label}</span>
                            {item.subItems && <i className="fa-sharp fa-solid fa-chevron-right"></i>}
                        </div>
                    );

                    return (
                        <React.Fragment key={key}>
                            {renderedItem}
                            {visibleSubMenus[key]?.visible && item.subItems && (
                                <SubMenu
                                    subItems={item.subItems}
                                    parentKey={key}
                                    subMenuPosition={subMenuPosition}
                                    visibleSubMenus={visibleSubMenus}
                                    hoveredItems={hoveredItems}
                                    handleMouseEnterItem={handleMouseEnterItem}
                                    handleOnClick={handleOnClick}
                                    subMenuRefs={subMenuRefs}
                                    renderMenu={renderMenu}
                                    renderMenuItem={renderMenuItem}
                                />
                            )}
                        </React.Fragment>
                    );
                })}
            </div>
        );

        return ReactDOM.createPortal(renderMenu ? renderMenu(menuMenu, { parentKey: null }) : menuMenu, document.body);
    }
);

export { Menu };
