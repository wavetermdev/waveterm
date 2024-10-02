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

    const handleClick = (item: ListItem) => {
        setOpen((prevState) => ({ ...prevState, [item.text]: !prevState[item.text] }));
        if (item.onClick) {
            item.onClick();
        }
    };

    const renderListItem = (item: ListItem, index: number) => {
        const isOpen = open[item.text] === true;
        const hasChildren = item.children && item.children.length > 0;

        return (
            <li key={index} className={clsx("list-item", className)}>
                {renderItem ? (
                    renderItem(item, isOpen, () => handleClick(item))
                ) : (
                    <div className="list-item-button" onClick={() => handleClick(item)}>
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
                        {item.children.map((child, childIndex) => renderListItem(child, childIndex))}
                    </ul>
                )}
            </li>
        );
    };

    return <ul className="list">{items.map((item, index) => renderListItem(item, index))}</ul>;
});

List.displayName = "List";

export { List };
