// Copyright 2024, Command Line
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/element/button";
import {
    ExpandableMenu,
    ExpandableMenuItem,
    ExpandableMenuItemData,
    ExpandableMenuItemGroup,
    ExpandableMenuItemGroupTitle,
    ExpandableMenuItemGroupTitleType,
    ExpandableMenuItemLeftElement,
    ExpandableMenuItemRightElement,
} from "@/element/expandablemenu";
import { Input } from "@/element/input";
import { Popover, PopoverButton, PopoverContent } from "@/element/popover";
import { makeIconClass } from "@/util/util";
import clsx from "clsx";
import { colord } from "colord";
import { atom, useAtom } from "jotai";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { memo, useEffect, useRef } from "react";
import WorkspaceSVG from "../asset/workspace.svg";

import "./workspaceswitcher.scss";

interface ColorSelectorProps {
    colors: string[];
    selectedColor?: string;
    onSelect: (color: string) => void;
    className?: string;
}

const ColorSelector = memo(({ colors, selectedColor, onSelect, className }: ColorSelectorProps) => {
    const handleColorClick = (color: string) => {
        onSelect(color);
    };

    return (
        <div className={clsx("color-selector", className)}>
            {colors.map((color) => (
                <div
                    key={color}
                    className={clsx("color-circle", { selected: selectedColor === color })}
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
    const handleIconClick = (icon: string) => {
        onSelect(icon);
    };

    return (
        <div className={clsx("icon-selector", className)}>
            {icons.map((icon) => {
                const iconClass = makeIconClass(icon, false);
                return (
                    <i
                        key={icon}
                        className={clsx(iconClass, "icon-item", { selected: selectedIcon === icon })}
                        onClick={() => handleIconClick(icon)}
                    />
                );
            })}
        </div>
    );
});

interface ColorAndIconSelectorProps {
    title: string;
    icon: string;
    color: string;
    focusInput: boolean;
    onTitleChange: (newTitle: string) => void;
    onColorChange: (newColor: string) => void;
    onIconChange: (newIcon: string) => void;
    onDeleteWorkspace: () => void;
}
const ColorAndIconSelector = memo(
    ({
        title,
        icon,
        color,
        focusInput,
        onTitleChange,
        onColorChange,
        onIconChange,
        onDeleteWorkspace,
    }: ColorAndIconSelectorProps) => {
        const inputRef = useRef<HTMLInputElement>(null);

        useEffect(() => {
            if (focusInput && inputRef.current) {
                inputRef.current.focus();
            }
        }, [focusInput]);

        return (
            <div className="color-icon-selector">
                <Input ref={inputRef} className="vertical-padding-3" onChange={onTitleChange} value={title} autoFocus />
                <ColorSelector
                    selectedColor={color}
                    colors={["#e91e63", "#8bc34a", "#ff9800", "#ffc107", "#03a9f4", "#3f51b5", "#f44336"]}
                    onSelect={onColorChange}
                />
                <IconSelector
                    selectedIcon={icon}
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
                    onSelect={onIconChange}
                />
                <div className="delete-ws-btn-wrapper">
                    <Button className="ghost grey font-size-12" onClick={onDeleteWorkspace}>
                        Delete workspace
                    </Button>
                </div>
            </div>
        );
    }
);

interface WorkspaceDataType {
    id: string;
    icon: string;
    label: string;
    color: string;
    isActive: boolean;
}

// Define the global Jotai atom for menuData
const workspaceData: WorkspaceDataType[] = [
    {
        id: "596e76eb-d87d-425e-9f6e-1519069ee446",
        icon: "",
        label: "Default",
        color: "",
        isActive: false,
    },
    {
        id: "596e76eb-d87d-425e-9f6e-1519069ee447",
        icon: "shield-cat",
        label: "Cat Space",
        color: "#e91e63",
        isActive: true,
    },
    {
        id: "596e76eb-d87d-425e-9f6e-1519069ee448",
        icon: "paw-simple",
        label: "Bear Space",
        color: "#ffc107",
        isActive: false,
    },
];

export const menuDataAtom = atom<WorkspaceDataType[]>(workspaceData);

const WorkspaceSwitcher = () => {
    const [menuData, setMenuData] = useAtom(menuDataAtom);

    const handleTitleChange = (id: string, newTitle: string) => {
        // This should call a service
        setMenuData((prevMenuData) =>
            prevMenuData.map((item) => {
                if (item.id === id) {
                    return {
                        ...item,
                        label: newTitle,
                    };
                }
                return item;
            })
        );
    };

    const handleColorChange = (id: string, newColor: string) => {
        // This should call a service
        setMenuData((prevMenuData) =>
            prevMenuData.map((item) => {
                if (item.id === id) {
                    return {
                        ...item,
                        color: newColor,
                    };
                }
                return item;
            })
        );
    };

    const handleIconChange = (id: string, newIcon: string) => {
        // This should call a service
        setMenuData((prevMenuData) =>
            prevMenuData.map((item) => {
                if (item.id === id) {
                    return {
                        ...item,
                        icon: newIcon,
                    };
                }
                return item;
            })
        );
    };

    const setActiveWorkspace = (id: string) => {
        // This should call a service
        setMenuData((prevMenuData) =>
            prevMenuData.map((item) => {
                if (item.id === id) {
                    return {
                        ...item,
                        isActive: true,
                    };
                }
                return {
                    ...item,
                    isActive: false,
                };
            })
        );
    };

    const handleAddNewWorkspace = () => {
        // This should call a service
        const id = `group-${Math.random().toString(36).substr(2, 9)}`;
        setMenuData((prevMenuData) => {
            const updatedMenuData = prevMenuData.map((item) => ({
                ...item,
                isActive: false,
            }));

            const newWorkspace = {
                id,
                icon: "circle",
                label: "New Workspace",
                color: "#8bc34a",
                isActive: true,
            };

            return [...updatedMenuData, newWorkspace];
        });
    };

    const handleDeleteWorkspace = (id: string) => {
        console.log("got here!!!");
        // This should call a service
        setMenuData((prevMenuData) => {
            const updatedMenuData = prevMenuData.filter((item) => item.id !== id);
            console.log("updatedMenuData", updatedMenuData);

            const isAnyActive = updatedMenuData.some((item) => item.isActive);

            if (!isAnyActive && updatedMenuData.length > 0) {
                updatedMenuData[0] = { ...updatedMenuData[0], isActive: true };
            }

            return updatedMenuData;
        });
    };

    const activeWorkspace = menuData.find((workspace) => workspace.isActive);

    const data = menuData.map((item): ExpandableMenuItemData => {
        const { id, icon, label, color, isActive } = item;
        const title: ExpandableMenuItemGroupTitleType = { label };
        const leftElement = icon ? (
            <i className={clsx("left-icon", makeIconClass(icon, false))} style={{ color: color }}></i>
        ) : null;
        title.leftElement = leftElement;
        title.rightElement = isActive ? <i className="fa-sharp fa-solid fa-check" style={{ color: color }}></i> : null;

        if (label === "Default") {
            return {
                id,
                type: "group",
                title: {
                    leftElement: <WorkspaceSVG></WorkspaceSVG>,
                    label: "Default",
                    rightElement: isActive ? <i className="fa-sharp fa-solid fa-check"></i> : null,
                },
            };
        }
        return {
            id,
            type: "group",
            title,
            isOpen: isActive,
            children: [
                {
                    type: "item",
                    content: ({ isOpen }: { isOpen: boolean }) => (
                        <ColorAndIconSelector
                            title={label}
                            icon={icon}
                            color={color}
                            focusInput={isOpen}
                            onTitleChange={(title) => handleTitleChange(id, title)}
                            onColorChange={(color) => handleColorChange(id, color)}
                            onIconChange={(icon) => handleIconChange(id, icon)}
                            onDeleteWorkspace={() => handleDeleteWorkspace(id)}
                        />
                    ),
                },
            ],
        };
    });

    const modWorkspaceColor =
        activeWorkspace.label === "Default"
            ? "rgba(0, 0, 0, .2)"
            : colord(activeWorkspace.color).alpha(0.1).toRgbString();

    const renderExpandableMenu = (menuItems: ExpandableMenuItemData[], parentIsOpen?: boolean) => {
        return menuItems.map((item, index) => {
            if (item.type === "item") {
                let contentElement;
                if (typeof item.content === "function") {
                    contentElement = item.content({ isOpen: parentIsOpen });
                } else {
                    contentElement = item.content;
                }
                return (
                    <ExpandableMenuItem key={item.id ?? index} withHoverEffect={false}>
                        {item.leftElement && (
                            <ExpandableMenuItemLeftElement>{item.leftElement}</ExpandableMenuItemLeftElement>
                        )}
                        <div className="content">{contentElement}</div>
                        {item.rightElement && (
                            <ExpandableMenuItemRightElement>{item.rightElement}</ExpandableMenuItemRightElement>
                        )}
                    </ExpandableMenuItem>
                );
            } else if (item.type === "group") {
                return (
                    <ExpandableMenuItemGroup
                        key={item.id}
                        isOpen={item.isOpen}
                        className={clsx({ "is-active": item.id === activeWorkspace.id })}
                    >
                        <ExpandableMenuItemGroupTitle onClick={() => setActiveWorkspace(item.id)}>
                            <div
                                className="menu-group-title-wrapper"
                                style={{
                                    backgroundColor: item.id === activeWorkspace.id ? modWorkspaceColor : "transparent",
                                }}
                            >
                                {item.title.leftElement && (
                                    <ExpandableMenuItemLeftElement>
                                        {item.title.leftElement}
                                    </ExpandableMenuItemLeftElement>
                                )}
                                <div className="label">{item.title.label}</div>
                                {item.title.rightElement && (
                                    <ExpandableMenuItemRightElement>
                                        {item.title.rightElement}
                                    </ExpandableMenuItemRightElement>
                                )}
                            </div>
                        </ExpandableMenuItemGroupTitle>
                        {item.children && item.children.length > 0 && renderExpandableMenu(item.children, item.isOpen)}
                    </ExpandableMenuItemGroup>
                );
            }
            return null;
        });
    };

    let workspaceIcon = (
        <i className={makeIconClass(activeWorkspace.icon, false)} style={{ color: activeWorkspace.color }}></i>
    );
    if (activeWorkspace.label == "Default") {
        workspaceIcon = <WorkspaceSVG></WorkspaceSVG>;
    }

    return (
        <Popover className="workspace-switcher-popover">
            <PopoverButton className="workspace-switcher-button grey" as="div">
                <span className="workspace-icon">{workspaceIcon}</span>
                {/* <span className="divider" />
                <span className="icon-right">
                    <ThunderSVG></ThunderSVG>
                </span> */}
            </PopoverButton>
            <PopoverContent className="workspace-switcher-content">
                <div className="title">Switch workspace</div>
                <OverlayScrollbarsComponent className={"scrollable"} options={{ scrollbars: { autoHide: "leave" } }}>
                    <ExpandableMenu noIndent singleOpen>
                        {renderExpandableMenu(data)}
                    </ExpandableMenu>
                </OverlayScrollbarsComponent>

                <div className="actions">
                    <ExpandableMenuItem onClick={() => handleAddNewWorkspace()}>
                        <ExpandableMenuItemLeftElement>
                            <i className="fa-sharp fa-solid fa-plus"></i>
                        </ExpandableMenuItemLeftElement>
                        <div className="content">New workspace</div>
                    </ExpandableMenuItem>
                </div>
            </PopoverContent>
        </Popover>
    );
};

export { WorkspaceSwitcher };
