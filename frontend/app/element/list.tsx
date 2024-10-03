// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import clsx from "clsx";
import React, { memo, useState } from "react";
import "./list.less";

interface ListItem {
    text: string;
    icon: React.ReactNode;
    children?: ListItem[];
    onClick?: () => void;
}

interface ListProps {
    items: ListItem[];
    className?: string;
    renderItem?: (item: ListItem, isOpen: boolean, handleClick: () => void) => React.ReactNode;
}

const List = memo(({ items, className, renderItem }: ListProps) => {
    const [open, setOpen] = useState<{ [key: string]: boolean }>({});

    // Helper function to generate a unique key for each item based on its path in the hierarchy
    const getItemKey = (item: ListItem, path: string) => `${path}-${item.text}`;

    const handleClick = (item: ListItem, itemKey: string) => {
        setOpen((prevState) => ({ ...prevState, [itemKey]: !prevState[itemKey] }));
        if (item.onClick) {
            item.onClick();
        }
    };

    const renderListItem = (item: ListItem, index: number, path: string) => {
        const itemKey = getItemKey(item, path); // Generate unique key based on the path
        const isOpen = open[itemKey] === true;
        const hasChildren = item.children && item.children.length > 0;

        return (
            <li key={itemKey} className={clsx("list-item", className)}>
                {renderItem ? (
                    renderItem(item, isOpen, () => handleClick(item, itemKey))
                ) : (
                    <div className="list-item-button" onClick={() => handleClick(item, itemKey)}>
                        <div className="list-item-content">
                            <div className="list-item-icon">{item.icon}</div>
                            <div className="list-item-text">{item.text}</div>
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

    return <ul className="list">{items.map((item, index) => renderListItem(item, index, "root"))}</ul>;
});

List.displayName = "List";

export { List };
