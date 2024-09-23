import { useHeight } from "@/app/hook/useHeight";
import { useWidth } from "@/app/hook/useWidth";
import clsx from "clsx";
import React, { memo, useLayoutEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import "./dropdown.less";

const SubMenu = ({
    subItems,
    parentKey,
    subMenuPosition,
    visibleSubMenus,
    handleMouseEnterItem,
    subMenuRefs,
}: {
    subItems: DropdownItem[];
    parentKey: string;
    subMenuPosition: any;
    visibleSubMenus: any;
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
                return (
                    <div
                        key={newKey}
                        className="dropdown-item"
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
};

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
    const [visibleSubMenus, setVisibleSubMenus] = useState<{ [key: string]: any }>({});
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

    // Position submenus based on available space
    const handleSubMenuPosition = (
        key: string,
        itemRect: DOMRect,
        parentRef: React.RefObject<HTMLDivElement>,
        label: string
    ) => {
        setTimeout(() => {
            const subMenuRef = subMenuRefs.current[key]?.current;
            if (!subMenuRef) return;

            const boundaryRect = effectiveBoundaryRef.current?.getBoundingClientRect() || {
                top: 0,
                left: 0,
                bottom: window.innerHeight,
                right: window.innerWidth,
            };

            const submenuWidth = subMenuRef.offsetWidth;
            const submenuHeight = subMenuRef.offsetHeight;

            let left = itemRect.right;
            let top = itemRect.top;

            // Adjust to the left if overflowing the right boundary
            if (left + submenuWidth > window.innerWidth) {
                left = itemRect.left - submenuWidth;
            }

            // Adjust if the submenu overflows the bottom boundary
            if (top + submenuHeight > window.innerHeight) {
                top = window.innerHeight - submenuHeight - 10;
            }

            setSubMenuPosition((prev) => ({
                ...prev,
                [key]: { top, left, label },
            }));
        }, 0);
    };

    const updateVisibility = (currentState: any, key: string, item: DropdownItem) => {
        const updatedState = Object.keys(currentState).reduce((acc, k) => {
            acc[k] = { ...currentState[k], visible: false };
            return acc;
        }, {} as any);

        updatedState[key] = { visible: true, label: item.label };
        return updatedState;
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
            return updatedState;
        });

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
                return (
                    <div
                        key={key}
                        className="dropdown-item"
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
});

export { Dropdown };
