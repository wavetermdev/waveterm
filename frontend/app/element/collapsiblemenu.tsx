// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import clsx from "clsx";
import React, { memo, useState } from "react";
import "./collapsiblemenu.scss";

interface VerticalNavProps {
    items: MenuItem[];
    className?: string;
    renderItem?: (
        item: MenuItem,
        isOpen: boolean,
        handleClick: (e: React.MouseEvent<any>, item: MenuItem, itemKey: string) => void
    ) => React.ReactNode;
}

const CollapsibleMenu = memo(({ items, className, renderItem }: VerticalNavProps) => {
    const [open, setOpen] = useState<{ [key: string]: boolean }>({});

    // Helper function to generate a unique key for each item based on its path in the hierarchy
    const getItemKey = (item: MenuItem, path: string) => `${path}-${item.label}`;

    const handleClick = (e: React.MouseEvent<any>, item: MenuItem, itemKey: string) => {
        setOpen((prevState) => ({ ...prevState, [itemKey]: !prevState[itemKey] }));
        if (item.onClick) {
            item.onClick(e);
        }
    };

    const renderListItem = (item: MenuItem, index: number, path: string) => {
        const itemKey = getItemKey(item, path);
        const isOpen = open[itemKey] === true;
        const hasChildren = item.subItems && item.subItems.length > 0;

        return (
            <li key={itemKey} className="collapsible-menu-item">
                {renderItem ? (
                    renderItem(item, isOpen, (e) => handleClick(e, item, itemKey))
                ) : (
                    <div className="collapsible-menu-item-button" onClick={(e) => handleClick(e, item, itemKey)}>
                        <div
                            className={clsx("collapsible-menu-item-content", {
                                "has-children": hasChildren,
                                "is-open": isOpen && hasChildren,
                            })}
                        >
                            {item.icon && <div className="collapsible-menu-item-icon">{item.icon}</div>}
                            <div className="collapsible-menu-item-text ellipsis">{item.label}</div>
                        </div>
                        {hasChildren && (
                            <i className={`fa-sharp fa-solid ${isOpen ? "fa-angle-up" : "fa-angle-down"}`}></i>
                        )}
                    </div>
                )}
                {hasChildren && (
                    <ul className={`nested-list ${isOpen ? "open" : "closed"}`}>
                        {item.subItems.map((child, childIndex) =>
                            renderListItem(child, childIndex, `${path}-${index}`)
                        )}
                    </ul>
                )}
            </li>
        );
    };

    return (
        <ul className={clsx("collapsible-menu", className)} role="navigation">
            {items.map((item, index) => renderListItem(item, index, "root"))}
        </ul>
    );
});

CollapsibleMenu.displayName = "CollapsibleMenu";

export { CollapsibleMenu };
