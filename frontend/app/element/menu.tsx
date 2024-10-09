// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import clsx from "clsx";
import React, { memo, useState } from "react";
import "./menu.less";

export interface MenuItem {
    text: string;
    icon?: string | React.ReactNode;
    children?: MenuItem[];
    onClick?: () => void;
}

interface MenuProps {
    items: MenuItem[];
    className?: string;
    renderItem?: (item: MenuItem, isOpen: boolean, handleClick: () => void) => React.ReactNode;
}

const Menu = memo(({ items, className, renderItem }: MenuProps) => {
    const [open, setOpen] = useState<{ [key: string]: boolean }>({});

    // Helper function to generate a unique key for each item based on its path in the hierarchy
    const getItemKey = (item: MenuItem, path: string) => `${path}-${item.text}`;

    const handleClick = (item: MenuItem, itemKey: string) => {
        setOpen((prevState) => ({ ...prevState, [itemKey]: !prevState[itemKey] }));
        if (item.onClick) {
            item.onClick();
        }
    };

    const renderListItem = (item: MenuItem, index: number, path: string) => {
        const itemKey = getItemKey(item, path);
        const isOpen = open[itemKey] === true;
        const hasChildren = item.children && item.children.length > 0;

        return (
            <li key={itemKey} className="menu-item">
                {renderItem ? (
                    renderItem(item, isOpen, () => handleClick(item, itemKey))
                ) : (
                    <div className="menu-item-button" onClick={() => handleClick(item, itemKey)}>
                        <div
                            className={clsx("menu-item-content", {
                                "has-children": hasChildren,
                                "is-open": isOpen && hasChildren,
                            })}
                        >
                            {item.icon && <div className="menu-item-icon">{item.icon}</div>}
                            <div className="menu-item-text">{item.text}</div>
                        </div>
                        {hasChildren && (
                            <i className={`fa-sharp fa-solid ${isOpen ? "fa-angle-up" : "fa-angle-down"}`}></i>
                        )}
                    </div>
                )}
                {hasChildren && (
                    <ul className={`nested-list ${isOpen ? "open" : "closed"}`}>
                        {item.children.map((child, childIndex) =>
                            renderListItem(child, childIndex, `${path}-${index}`)
                        )}
                    </ul>
                )}
            </li>
        );
    };

    return (
        <ul className={clsx("menu", className)} role="menu">
            {items.map((item, index) => renderListItem(item, index, "root"))}
        </ul>
    );
});

Menu.displayName = "Menu";

export { Menu };
