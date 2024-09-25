import { useHeight } from "@/app/hook/useHeight";
import { useWidth } from "@/app/hook/useWidth";
import clsx from "clsx";
import React, { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import "./dropdown.less";

type DropdownItem = {
    label: string;
    subItems?: DropdownItem[];
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
        subItems: DropdownItem[];
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
            item: DropdownItem
        ) => void;
        handleOnClick: (e: React.MouseEvent<HTMLDivElement>, item: DropdownItem) => void;
        renderMenu?: (subMenu: JSX.Element, props: any) => JSX.Element;
        renderMenuItem?: (item: DropdownItem, props: any) => JSX.Element;
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
                className="dropdown sub-dropdown"
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
                        className: clsx("dropdown-item", { active: isActive }),
                        onMouseEnter: (event: React.MouseEvent<HTMLDivElement, MouseEvent>) =>
                            handleMouseEnterItem(event, parentKey, idx, item),
                        onClick: (e: React.MouseEvent<HTMLDivElement>) => handleOnClick(e, item),
                    };

                    const renderedItem = renderMenuItem ? (
                        renderMenuItem(item, menuItemProps) // Remove portal here
                    ) : (
                        <div key={newKey} {...menuItemProps}>
                            {item.label}
                            {item.subItems && <span className="arrow">▶</span>}
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

const Dropdown = memo(
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
        items: DropdownItem[];
        anchorRef: React.RefObject<HTMLElement>;
        scopeRef?: React.RefObject<HTMLElement>;
        initialPosition?: { top: number; left: number };
        className?: string;
        setVisibility: (_: boolean) => void;
        renderMenu?: (subMenu: JSX.Element, props: any) => JSX.Element;
        renderMenuItem?: (item: DropdownItem, props: any) => JSX.Element;
    }) => {
        const [visibleSubMenus, setVisibleSubMenus] = useState<{ [key: string]: any }>({});
        const [hoveredItems, setHoveredItems] = useState<string[]>([]);
        const [subMenuPosition, setSubMenuPosition] = useState<{
            [key: string]: { top: number; left: number; label: string };
        }>({});
        const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
        const dropdownRef = useRef<HTMLDivElement>(null);
        const subMenuRefs = useRef<{ [key: string]: React.RefObject<HTMLDivElement> }>({});

        const width = useWidth(scopeRef);
        const height = useHeight(scopeRef);

        items.forEach((_, idx) => {
            const key = `${idx}`;
            if (!subMenuRefs.current[key]) {
                subMenuRefs.current[key] = React.createRef<HTMLDivElement>();
            }
        });

        useLayoutEffect(() => {
            if (initialPosition) {
                setPosition(initialPosition);
            } else if (anchorRef.current && dropdownRef.current) {
                // Calculate position based on anchorRef if it exists
                const anchorRect = anchorRef.current.getBoundingClientRect();
                const scrollTop = window.scrollY || document.documentElement.scrollTop;
                const scrollLeft = window.scrollX || document.documentElement.scrollLeft;

                let top = anchorRect.bottom + scrollTop;
                let left = anchorRect.left + scrollLeft;

                const boundaryRect = {
                    top: 0,
                    left: 0,
                    bottom: window.innerHeight,
                    right: window.innerWidth,
                };

                if (left + dropdownRef.current.offsetWidth > boundaryRect.right + scrollLeft) {
                    left = boundaryRect.right + scrollLeft - dropdownRef.current.offsetWidth;
                }

                if (top + dropdownRef.current.offsetHeight > boundaryRect.bottom + scrollTop) {
                    top = boundaryRect.bottom + scrollTop - dropdownRef.current.offsetHeight;
                }

                setPosition({ top, left });
            } else {
                console.warn("Neither initialPosition nor anchorRef provided. Defaulting to { top: 0, left: 0 }.");
            }
        }, [width, height, initialPosition]);

        useEffect(() => {
            const handleClickOutside = (event: MouseEvent) => {
                const isClickInsideDropdown = dropdownRef.current && dropdownRef.current.contains(event.target as Node);

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

            const newHoveredItems = key.split("-").reduce((acc, part, idx) => {
                if (idx === 0) return [part];
                return [...acc, `${acc[idx - 1]}-${part}`];
            }, [] as string[]);

            setHoveredItems(newHoveredItems);

            const itemRect = event.currentTarget.getBoundingClientRect();
            handleSubMenuPosition(key, itemRect, dropdownRef, item.label);
        };

        const handleOnClick = (e: React.MouseEvent<HTMLDivElement>, item: DropdownItem) => {
            e.stopPropagation();
            item.onClick && item.onClick(e);
        };

        const dropdownMenu = (
            <div
                className={clsx("dropdown", className)}
                ref={dropdownRef}
                style={{ top: position.top, left: position.left }}
            >
                {items.map((item, index) => {
                    const key = `${index}`;
                    const isActive = hoveredItems.includes(key);

                    const menuItemProps = {
                        className: clsx("dropdown-item", { active: isActive }),
                        onMouseEnter: (event: React.MouseEvent<HTMLDivElement, MouseEvent>) =>
                            handleMouseEnterItem(event, null, index, item),
                        onClick: (e: React.MouseEvent<HTMLDivElement>) => handleOnClick(e, item),
                    };

                    const renderedItem = renderMenuItem ? (
                        renderMenuItem(item, menuItemProps)
                    ) : (
                        <div key={key} {...menuItemProps}>
                            {item.label}
                            {item.subItems && <span className="arrow">▶</span>}
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

        return ReactDOM.createPortal(
            renderMenu ? renderMenu(dropdownMenu, { parentKey: null }) : dropdownMenu,
            document.body
        );
    }
);

export { Dropdown };
