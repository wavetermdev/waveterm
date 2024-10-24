// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    ExpandableMenu,
    ExpandableMenuItem,
    ExpandableMenuItemData,
    ExpandableMenuItemGroup,
    ExpandableMenuItemGroupTitle,
    ExpandableMenuItemLeftElement,
    ExpandableMenuItemRightElement,
} from "@/element/expandablemenu";
import { Input } from "@/element/input";
import { Popover, PopoverButton, PopoverContent } from "@/element/popover";
import { makeIconClass } from "@/util/util";
import clsx from "clsx";
import { memo, useState } from "react";
import ThunderSVG from "../asset/thunder.svg";
import WorskpaceSVG from "../asset/workspace.svg";

import "./workspaceswitcher.less";

interface ColorSelectorProps {
    colors: string[];
    selectedColor?: string;
    onSelect: (color: string) => void;
    className?: string;
}

const ColorSelector = memo(({ colors, selectedColor, onSelect, className }: ColorSelectorProps) => {
    const [activeColor, setActiveColor] = useState<string | undefined>(selectedColor);

    const handleColorClick = (color: string) => {
        setActiveColor(color);
        onSelect(color);
    };

    return (
        <div className={clsx("color-selector", className)}>
            {colors.map((color) => (
                <div
                    key={color}
                    className={clsx("color-circle", { selected: activeColor === color })}
                    style={{ backgroundColor: color }}
                    onClick={() => handleColorClick(color)}
                />
            ))}
        </div>
    );
});

interface IconSelectorProps {
    icons: string[];
    selectedIcon?: string;
    onSelect: (icon: string) => void;
    className?: string;
}

const IconSelector = memo(({ icons, selectedIcon, onSelect, className }: IconSelectorProps) => {
    const [activeIcon, setActiveIcon] = useState<string | undefined>(selectedIcon);

    const handleIconClick = (icon: string) => {
        setActiveIcon(icon);
        onSelect(icon);
    };

    return (
        <div className={clsx("icon-selector", className)}>
            {icons.map((icon) => {
                const iconClass = makeIconClass(icon, false);
                return (
                    <i
                        key={icon}
                        className={clsx(iconClass, "icon-item", { selected: activeIcon === icon })}
                        onClick={() => handleIconClick(icon)}
                    />
                );
            })}
        </div>
    );
});

const ColorAndIconSelector = memo(() => {
    return (
        <div className="color-icon-selector">
            <Input className="vertical-padding-3" />
            <ColorSelector
                colors={["#e91e63", "#8bc34a", "#ff9800", "#ffc107", "#03a9f4", "#3f51b5", "#f44336"]}
                onSelect={(color) => console.log("Selected color:", color)}
            />
            <IconSelector
                icons={[
                    "triangle",
                    "star",
                    "cube",
                    "gem",
                    "chess-knight",
                    "heart",
                    "plane",
                    "rocket",
                    "shield-cat",
                    "paw-simple",
                    "umbrella",
                    "graduation-cap",
                    "mug-hot",
                    "circle",
                ]}
                onSelect={(icon) => console.log("Selected icon:", icon)}
            />
        </div>
    );
});

const dummyData: ExpandableMenuItemData[] = [
    {
        id: "596e76eb-d87d-425e-9f6e-1519069ee447",
        type: "group",
        title: {
            leftElement: <i className="fa-sharp fa-solid fa-shield-cat"></i>,
            label: "Cat Space",
        },
        children: [
            {
                id: "7cc2a2df-37d8-426e-9235-c1a0902d5843",
                type: "item",
                content: <ColorAndIconSelector />,
            },
        ],
    },
];

const WorkspaceSwitcher = () => {
    const renderExpandableMenu = (menuItems: ExpandableMenuItemData[]) => {
        return menuItems.map((item) => {
            if (item.type === "item") {
                return (
                    <ExpandableMenuItem key={item.id} withHoverEffect={typeof item.content === "string"}>
                        {item.leftElement && (
                            <ExpandableMenuItemLeftElement>{item.leftElement}</ExpandableMenuItemLeftElement>
                        )}
                        <div className="content">{item.content}</div>
                        {item.rightElement && (
                            <ExpandableMenuItemRightElement>{item.rightElement}</ExpandableMenuItemRightElement>
                        )}
                    </ExpandableMenuItem>
                );
            } else if (item.type === "group") {
                return (
                    <ExpandableMenuItemGroup key={item.id} defaultExpanded={item.defaultExpanded}>
                        <ExpandableMenuItemGroupTitle>
                            {item.title.leftElement && (
                                <ExpandableMenuItemLeftElement>{item.title.leftElement}</ExpandableMenuItemLeftElement>
                            )}
                            <div className="label">{item.title.label}</div>
                            {item.title.rightElement && (
                                <ExpandableMenuItemRightElement>
                                    {item.title.rightElement}
                                </ExpandableMenuItemRightElement>
                            )}
                        </ExpandableMenuItemGroupTitle>
                        {item.children && renderExpandableMenu(item.children)}
                    </ExpandableMenuItemGroup>
                );
            }
        });
    };

    return (
        <Popover className="workspace-switcher-popover">
            <PopoverButton className="workspace-switcher-button grey" as="div">
                <span className="icon-left">
                    <WorskpaceSVG></WorskpaceSVG>
                </span>
                <span className="divider" />
                <span className="icon-right">
                    <ThunderSVG></ThunderSVG>
                </span>
            </PopoverButton>
            <PopoverContent className="workspace-switcher-content">
                <div className="title">Switch workspace</div>
                <ExpandableMenu noIndent>{renderExpandableMenu(dummyData)}</ExpandableMenu>
            </PopoverContent>
        </Popover>
    );
};

export { WorkspaceSwitcher };
