// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { FloatingPortal, type Placement, useDismiss, useFloating, useInteractions } from "@floating-ui/react";
import clsx from "clsx";
import { createRef, Fragment, memo, ReactNode, useRef, useState } from "react";
import ReactDOM from "react-dom";

import "./flyoutmenu.scss";

type MenuProps = {
    items: MenuItem[];
    className?: string;
    placement?: Placement;
    onOpenChange?: (isOpen: boolean) => void;
    children: ReactNode | ReactNode[];
    renderMenu?: (subMenu: React.ReactElement, props: any) => React.ReactElement;
    renderMenuItem?: (item: MenuItem, props: any) => React.ReactElement;
};

const FlyoutMenuComponent = memo(
    ({ items, children, className, placement, onOpenChange, renderMenu, renderMenuItem }: MenuProps) => {
        const [visibleSubMenus, setVisibleSubMenus] = useState<{ [key: string]: any }>({});
        const [hoveredItems, setHoveredItems] = useState<string[]>([]);
        const [subMenuPosition, setSubMenuPosition] = useState<{
            [key: string]: { top: number; left: number; label: string };
        }>({});
        const subMenuRefs = useRef<{ [key: string]: React.RefObject<HTMLDivElement> }>({});

        const [isOpen, setIsOpen] = useState(false);
        const onOpenChangeMenu = (isOpen: boolean) => {
            setIsOpen(isOpen);
            onOpenChange?.(isOpen);
        };
        const { refs, floatingStyles, context } = useFloating({
            placement: placement ?? "bottom-start",
            open: isOpen,
            onOpenChange: onOpenChangeMenu,
        });
        const dismiss = useDismiss(context);
        const { getReferenceProps, getFloatingProps } = useInteractions([dismiss]);

        items.forEach((_, idx) => {
            const key = `${idx}`;
            if (!subMenuRefs.current[key]) {
                subMenuRefs.current[key] = createRef<HTMLDivElement>();
            }
        });

        // Position submenus based on available space and scroll position
        const handleSubMenuPosition = (key: string, itemRect: DOMRect, label: string) => {
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
            handleSubMenuPosition(key, itemRect, item.label);
        };

        const handleOnClick = (e: React.MouseEvent<HTMLDivElement>, item: MenuItem) => {
            e.stopPropagation();
            onOpenChangeMenu(false);
            item.onClick?.(e);
        };

        return (
            <>
                <div
                    className="menu-anchor"
                    ref={refs.setReference}
                    {...getReferenceProps()}
                    onClick={() => onOpenChangeMenu(!isOpen)}
                >
                    {children}
                </div>
                {isOpen && (
                    <FloatingPortal>
                        <div
                            className={clsx("menu", className)}
                            ref={refs.setFloating}
                            style={floatingStyles}
                            {...getFloatingProps()}
                        >
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
                                    <Fragment key={key}>
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
                                    </Fragment>
                                );
                            })}
                        </div>
                    </FloatingPortal>
                )}
            </>
        );
    }
);

const FlyoutMenu = memo(FlyoutMenuComponent) as typeof FlyoutMenuComponent;

type SubMenuProps = {
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
    renderMenu?: (subMenu: React.ReactElement, props: any) => React.ReactElement;
    renderMenuItem?: (item: MenuItem, props: any) => React.ReactElement;
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
    }: SubMenuProps) => {
        subItems.forEach((_, idx) => {
            const newKey = `${parentKey}-${idx}`;
            if (!subMenuRefs.current[newKey]) {
                subMenuRefs.current[newKey] = createRef<HTMLDivElement>();
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
                        <Fragment key={newKey}>
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
                        </Fragment>
                    );
                })}
            </div>
        );

        return ReactDOM.createPortal(renderMenu ? renderMenu(subMenu, { parentKey }) : subMenu, document.body);
    }
);

export { FlyoutMenu };
