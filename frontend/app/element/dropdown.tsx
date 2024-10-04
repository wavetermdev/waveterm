// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import clsx from "clsx";
import { memo, useRef, useState } from "react";
import { Button } from "./button";
import { ContextMenu, MenuItem } from "./contextmenu";

import "./dropdown.less";

interface DropdownProps {
    label: string;
    items: MenuItem[];
    scopeRef: React.RefObject<any>;
    className?: string;
}

const Dropdown = memo(({ label, className, items, scopeRef }: DropdownProps) => {
    const anchorRef = useRef<HTMLButtonElement>(null);
    const [isMenuVisible, setIsMenuVisible] = useState(false);

    const handleAnchorClick = () => {
        setIsMenuVisible((prev) => !prev);
    };

    const mapItemsWithClick = (items: any[]) => {
        return items.map((item) => ({
            ...item,
            onClick: () => {
                if (item.onClick) {
                    item.onClick();
                    setIsMenuVisible(false);
                }
            },
            subItems: item.subItems ? mapItemsWithClick(item.subItems) : undefined,
        }));
    };

    return (
        <div className={clsx("dropdown", className)}>
            <Button
                ref={anchorRef}
                className="grey border-radius-3 vertical-padding-6 horizontal-padding-8"
                style={{ borderColor: isMenuVisible ? "var(--accent-color)" : "transparent" }}
                onClick={handleAnchorClick}
            >
                {label}
                <i className="fa-sharp fa-solid fa-angle-down" style={{ marginLeft: 4 }}></i>
            </Button>
            {isMenuVisible && (
                <ContextMenu
                    items={items}
                    setVisibility={(visible) => setIsMenuVisible(visible)}
                    anchorRef={anchorRef}
                    scopeRef={scopeRef}
                />
            )}
        </div>
    );
});

Dropdown.displayName = "Dropdown";

export { Dropdown };
