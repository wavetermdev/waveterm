// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from "react";

import "./list.less"; // Assuming you have your LESS styles

interface ListItem {
    text: string;
    icon: React.ReactNode;
    link?: string;
    children?: ListItem[];
}

interface ListProps {
    items: ListItem[];
    renderItem?: (item: ListItem, isOpen: boolean, handleClick: () => void) => React.ReactNode;
    onClick?: (item: ListItem) => void;
}

const List = ({ items, renderItem, onClick }: ListProps) => {
    const [open, setOpen] = useState<{ [key: string]: boolean }>({});

    const handleClick = (item: ListItem) => {
        setOpen((prevState) => ({ ...prevState, [item.text]: !prevState[item.text] }));
        if (onClick) {
            onClick(item); // Notify the consumer that the item was clicked
        }
    };

    const renderListItem = (item: ListItem, index: number) => {
        const isOpen = open[item.text] === true;
        const hasChildren = item.children && item.children.length > 0;

        return (
            <li key={index} className="list-item">
                {renderItem ? (
                    renderItem(item, isOpen, () => handleClick(item))
                ) : (
                    <div className="list-item-button" onClick={() => handleClick(item)}>
                        <span className="list-item-icon">{item.icon}</span>
                        <span className="list-item-text">
                            {item.link ? <a href={item.link}>{item.text}</a> : item.text}
                        </span>
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
};

export { List };
