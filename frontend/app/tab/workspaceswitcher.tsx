// Copyright 2024, Command Line
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/element/button";
import {
    ExpandableMenu,
    ExpandableMenuItem,
    ExpandableMenuItemGroup,
    ExpandableMenuItemGroupTitle,
    ExpandableMenuItemLeftElement,
    ExpandableMenuItemRightElement,
} from "@/element/expandablemenu";
import { Input } from "@/element/input";
import { Popover, PopoverButton, PopoverContent } from "@/element/popover";
import { makeIconClass, useAtomValueSafe } from "@/util/util";
import clsx from "clsx";
import { useAtom } from "jotai";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { CSSProperties, memo, useCallback, useEffect, useRef, useState } from "react";
import WorkspaceSVG from "../asset/workspace.svg";
import { atoms, getApi } from "../store/global";
import { WorkspaceService } from "../store/services";
import { getWaveObjectAtom, makeORef, setObjectValue } from "../store/wos";
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

type WorkspaceMapEntry = {
    windowId: string;
    workspaceAtom: WritableWaveObjectAtom<Workspace>;
};

type WorkspaceMap = Record<string, WorkspaceMapEntry>;

const WorkspaceSwitcher = () => {
    const [workspaceMap, setWorkspaceMap] = useState<WorkspaceMap>({});

    const activeWorkspace = useAtomValueSafe(atoms.workspace);

    const updateWorkspaceMap = useCallback(() => {
        WorkspaceService.ListWorkspaces()
            .then((workspaceList) => {
                const newMap = { ...workspaceMap };
                if (!workspaceList) {
                    return;
                }
                console.log(workspaceList);
                for (const entry of workspaceList) {
                    if (newMap[entry.workspaceid]) {
                        newMap[entry.workspaceid].windowId = entry.windowid;
                    } else {
                        newMap[entry.workspaceid] = {
                            windowId: entry.windowid,
                            workspaceAtom: getWaveObjectAtom(makeORef("workspace", entry.workspaceid)),
                        };
                    }
                }
                setWorkspaceMap(newMap);
            })
            .catch((e) => {
                console.error("Failed to update workspace map", e);
            });
    }, []);

    useEffect(() => {
        updateWorkspaceMap();
    }, []);

    const workspaceIcon = activeWorkspace.icon ? (
        <i className={makeIconClass(activeWorkspace.icon, false)} style={{ color: activeWorkspace.color }}></i>
    ) : (
        <WorkspaceSVG />
    );

    const saveWorkspace = () => {
        setObjectValue({ ...activeWorkspace, name: "New Workspace", icon: "circle", color: "green" }, undefined, true);
        setTimeout(() => {
            updateWorkspaceMap();
        }, 10);
    };

    const isActiveWorkspaceEphemeral = !activeWorkspace.name || !activeWorkspace.icon;

    return (
        <Popover className="workspace-switcher-popover">
            <PopoverButton className="workspace-switcher-button grey" as="div" onClick={() => updateWorkspaceMap()}>
                <span className="workspace-icon">{workspaceIcon}</span>
            </PopoverButton>
            <PopoverContent className="workspace-switcher-content">
                <div className="title">Switch workspace</div>
                <OverlayScrollbarsComponent className={"scrollable"} options={{ scrollbars: { autoHide: "leave" } }}>
                    <ExpandableMenu noIndent singleOpen>
                        {Object.entries(workspaceMap).map((entry) => (
                            <WorkspaceSwitcherItem key={entry[0]} entry={entry[1]} />
                        ))}
                    </ExpandableMenu>
                </OverlayScrollbarsComponent>

                {isActiveWorkspaceEphemeral && (
                    <div className="actions">
                        <ExpandableMenuItem onClick={() => saveWorkspace()}>
                            <ExpandableMenuItemLeftElement>
                                <i className="fa-sharp fa-solid fa-floppy-disk"></i>
                            </ExpandableMenuItemLeftElement>
                            <div className="content">Save workspace</div>
                        </ExpandableMenuItem>
                    </div>
                )}
            </PopoverContent>
        </Popover>
    );
};

const WorkspaceSwitcherItem = memo(({ entry }: { entry: WorkspaceMapEntry }) => {
    const [workspace, setWorkspace] = useAtom(entry.workspaceAtom);
    const [isOpen, setIsOpen] = useState(false);

    const isActive = !!entry.windowId;

    return (
        <ExpandableMenuItemGroup key={workspace.oid} isOpen={isOpen} className={clsx({ "is-active": isActive })}>
            <ExpandableMenuItemGroupTitle onClick={() => !entry.windowId && getApi().switchWorkspace(workspace.oid)}>
                <div
                    className="menu-group-title-wrapper"
                    style={
                        {
                            "--background-color": workspace.color,
                        } as CSSProperties
                    }
                >
                    <ExpandableMenuItemLeftElement>
                        <i
                            className={clsx("left-icon", makeIconClass(workspace.icon, false))}
                            style={{ color: workspace.color }}
                        />
                    </ExpandableMenuItemLeftElement>
                    <div className="label">{workspace.name}</div>
                    <ExpandableMenuItemRightElement>
                        {isActive ? (
                            <>
                                <i
                                    className="fa-sharp fa-solid fa-pencil"
                                    style={{ color: workspace.color }}
                                    onClick={() => setIsOpen(true)}
                                />
                                <i className="fa-sharp fa-solid fa-check" style={{ color: workspace.color }} />
                            </>
                        ) : null}
                    </ExpandableMenuItemRightElement>
                </div>
            </ExpandableMenuItemGroupTitle>
            <ExpandableMenuItem>
                <ColorAndIconSelector
                    title={workspace.name}
                    icon={workspace.icon}
                    color={workspace.color}
                    focusInput={isOpen}
                    onTitleChange={(title) => setWorkspace({ ...workspace, name: title })}
                    onColorChange={(color) => setWorkspace({ ...workspace, color })}
                    onIconChange={(icon) => setWorkspace({ ...workspace, icon })}
                    onDeleteWorkspace={() => getApi().deleteWorkspace(workspace.oid)}
                />
            </ExpandableMenuItem>
        </ExpandableMenuItemGroup>
    );
});

export { WorkspaceSwitcher };
