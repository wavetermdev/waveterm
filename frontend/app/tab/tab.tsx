// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms, getApi, globalStore, recordTEvent, refocusNode } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { Button } from "@/element/button";
import { ContextMenuModel } from "@/store/contextmenu";
import { fireAndForget } from "@/util/util";
import clsx from "clsx";
import React, { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ObjectService } from "../store/services";
import { TabStatusType } from "../store/tab-model";
import { makeORef, useWaveObjectValue } from "../store/wos";
import { addPresetSubmenu } from "./tab-menu";
import "./tab.scss";

// Tab color palette for the context menu
const TAB_COLORS = [
    { name: "Red", value: "#ef4444" },
    { name: "Orange", value: "#f97316" },
    { name: "Yellow", value: "#eab308" },
    { name: "Green", value: "#22c55e" },
    { name: "Cyan", value: "#06b6d4" },
    { name: "Blue", value: "#3b82f6" },
    { name: "Purple", value: "#a855f7" },
    { name: "Pink", value: "#ec4899" },
];

interface TabProps {
    id: string;
    active: boolean;
    isFirst: boolean;
    isBeforeActive: boolean;
    isDragging: boolean;
    tabWidth: number;
    isNew: boolean;
    onSelect: () => void;
    onClose: (event: React.MouseEvent<HTMLButtonElement, MouseEvent> | null) => void;
    onDragStart: (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => void;
    onLoaded: () => void;
}

const Tab = memo(
    forwardRef<HTMLDivElement, TabProps>(
        (
            { id, active, isBeforeActive, isDragging, tabWidth, isNew, onLoaded, onSelect, onClose, onDragStart },
            ref
        ) => {
            const [tabData, _] = useWaveObjectValue<Tab>(makeORef("tab", id));
            const [originalName, setOriginalName] = useState("");
            const [isEditable, setIsEditable] = useState(false);

            const editableRef = useRef<HTMLDivElement>(null);
            const editableTimeoutRef = useRef<NodeJS.Timeout>(null);
            const loadedRef = useRef(false);
            const tabRef = useRef<HTMLDivElement>(null);

            // Read terminal status from tab metadata (synced across webviews)
            // Status shown on ALL tabs including active
            const tabStatus = (tabData?.meta?.["tab:termstatus"] as TabStatusType) || null;

            // Clear status after a delay when tab becomes active AND webview is visible
            // "finished" clears after 2 seconds, "stopped" clears after 3 seconds
            // We must check document.visibilityState because each tab has its own webview,
            // and the "active" prop is always true for the owning webview even when in background
            const [isDocVisible, setIsDocVisible] = useState(document.visibilityState === "visible");
            useEffect(() => {
                const handleVisibilityChange = () => {
                    setIsDocVisible(document.visibilityState === "visible");
                };
                document.addEventListener("visibilitychange", handleVisibilityChange);
                return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
            }, []);

            useEffect(() => {
                // Only clear status when:
                // 1. This tab is marked as active (matches this webview's staticTabId)
                // 2. This webview is actually visible to the user (not a background webview)
                // 3. Status is finished or stopped
                if (active && isDocVisible && (tabStatus === "finished" || tabStatus === "stopped")) {
                    const delay = tabStatus === "stopped" ? 3000 : 2000;
                    const timer = setTimeout(() => {
                        ObjectService.UpdateObjectMeta(makeORef("tab", id), {
                            "tab:termstatus": null,
                        });
                    }, delay);
                    return () => clearTimeout(timer);
                }
            }, [active, isDocVisible, tabStatus, id]);

            useImperativeHandle(ref, () => tabRef.current as HTMLDivElement);

            useEffect(() => {
                if (tabData?.name) {
                    setOriginalName(tabData.name);
                }
            }, [tabData]);

            useEffect(() => {
                return () => {
                    if (editableTimeoutRef.current) {
                        clearTimeout(editableTimeoutRef.current);
                    }
                };
            }, []);

            const selectEditableText = useCallback(() => {
                if (!editableRef.current) {
                    return;
                }
                editableRef.current.focus();
                const range = document.createRange();
                const selection = window.getSelection();
                range.selectNodeContents(editableRef.current);
                selection.removeAllRanges();
                selection.addRange(range);
            }, []);

            const handleRenameTab: React.MouseEventHandler<HTMLDivElement> = (event) => {
                event?.stopPropagation();
                setIsEditable(true);
                editableTimeoutRef.current = setTimeout(() => {
                    selectEditableText();
                }, 50);
            };

            const handleBlur = () => {
                let newText = editableRef.current.innerText.trim();
                newText = newText || originalName;
                editableRef.current.innerText = newText;
                setIsEditable(false);
                fireAndForget(() => ObjectService.UpdateTabName(id, newText));
                setTimeout(() => refocusNode(null), 10);
            };

            const handleKeyDown: React.KeyboardEventHandler<HTMLDivElement> = (event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "a") {
                    event.preventDefault();
                    selectEditableText();
                    return;
                }
                // this counts glyphs, not characters
                const curLen = Array.from(editableRef.current.innerText).length;
                if (event.key === "Enter") {
                    event.preventDefault();
                    event.stopPropagation();
                    if (editableRef.current.innerText.trim() === "") {
                        editableRef.current.innerText = originalName;
                    }
                    editableRef.current.blur();
                } else if (event.key === "Escape") {
                    editableRef.current.innerText = originalName;
                    editableRef.current.blur();
                    event.preventDefault();
                    event.stopPropagation();
                } else if (curLen >= 14 && !["Backspace", "Delete", "ArrowLeft", "ArrowRight"].includes(event.key)) {
                    event.preventDefault();
                    event.stopPropagation();
                }
            };

            useEffect(() => {
                if (!loadedRef.current) {
                    onLoaded();
                    loadedRef.current = true;
                }
            }, [onLoaded]);

            useEffect(() => {
                if (tabRef.current && isNew) {
                    const initialWidth = `${(tabWidth / 3) * 2}px`;
                    tabRef.current.style.setProperty("--initial-tab-width", initialWidth);
                    tabRef.current.style.setProperty("--final-tab-width", `${tabWidth}px`);
                }
            }, [isNew, tabWidth]);

            // Prevent drag from being triggered on mousedown
            const handleMouseDownOnClose = (event: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
                event.stopPropagation();
            };

            /**
             * Opens a native directory picker dialog and sets the tab's base directory.
             *
             * The selected directory becomes the default working directory for all
             * terminals and file preview widgets launched within this tab.
             *
             * @remarks
             * - Uses Electron's native dialog for cross-platform file picking
             * - Defaults to current base directory if set, otherwise home (~)
             * - Does NOT set the lock flag - allows smart auto-detection to continue
             *
             * @see handleClearBaseDir - To remove the base directory
             * @see handleToggleLock - To prevent auto-detection
             */
            const handleSetBaseDir = useCallback(() => {
                const currentDir = tabData?.meta?.["tab:basedir"] || "";
                fireAndForget(async () => {
                    const newDir = await getApi().showOpenDialog({
                        title: "Set Tab Base Directory",
                        defaultPath: currentDir || "~",
                        properties: ["openDirectory"],
                    });
                    if (newDir && newDir.length > 0) {
                        await ObjectService.UpdateObjectMeta(makeORef("tab", id), {
                            "tab:basedir": newDir[0],
                        });
                    }
                });
            }, [id, tabData]);

            /**
             * Clears the tab's base directory, restoring default behavior.
             *
             * After clearing:
             * - New terminals use the default directory (typically home ~)
             * - Smart auto-detection from OSC 7 is re-enabled
             *
             * @remarks
             * Only clears `tab:basedir`, does NOT touch `tab:basedirlock`
             */
            const handleClearBaseDir = useCallback(() => {
                fireAndForget(async () => {
                    await ObjectService.UpdateObjectMeta(makeORef("tab", id), {
                        "tab:basedir": null,
                    });
                });
            }, [id]);

            /**
             * Toggles the base directory lock state.
             *
             * Lock semantics:
             * - **Unlocked (default):** OSC 7 smart auto-detection can update `tab:basedir`
             * - **Locked:** OSC 7 updates are blocked; only manual setting changes directory
             *
             * Use cases for locking:
             * - Working in multiple directories within same tab
             * - Preventing cd commands from changing tab context
             * - Maintaining a fixed project root despite navigation
             *
             * @see tab:basedirlock - The underlying metadata key
             */
            const handleToggleLock = useCallback(() => {
                const currentLock = tabData?.meta?.["tab:basedirlock"] || false;
                fireAndForget(async () => {
                    await ObjectService.UpdateObjectMeta(makeORef("tab", id), {
                        "tab:basedirlock": !currentLock,
                    });
                });
            }, [id, tabData]);

            /**
             * Sets the tab's color for visual identification.
             *
             * @param color - Hex color value or null to clear
             */
            const handleSetTabColor = useCallback(
                (color: string | null) => {
                    fireAndForget(async () => {
                        await ObjectService.UpdateObjectMeta(makeORef("tab", id), {
                            "tab:color": color,
                        });
                    });
                },
                [id]
            );

            const handleContextMenu = useCallback(
                (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
                    e.preventDefault();
                    const currentBaseDir = tabData?.meta?.["tab:basedir"];
                    const isLocked = tabData?.meta?.["tab:basedirlock"] || false;

                    let menu: ContextMenuItem[] = [
                        { label: "Rename Tab", click: () => handleRenameTab(null) },
                        {
                            label: "Copy TabId",
                            click: () => fireAndForget(() => navigator.clipboard.writeText(id)),
                        },
                        { type: "separator" },
                    ];

                    // Base Directory submenu
                    const baseDirSubmenu: ContextMenuItem[] = [
                        {
                            label: "Set Base Directory...",
                            click: handleSetBaseDir,
                        },
                    ];

                    if (currentBaseDir) {
                        baseDirSubmenu.push({
                            label: "Clear Base Directory",
                            click: handleClearBaseDir,
                        });
                        baseDirSubmenu.push({ type: "separator" });
                        baseDirSubmenu.push({
                            label: isLocked ? "Unlock (Enable Smart Detection)" : "Lock (Disable Smart Detection)",
                            click: handleToggleLock,
                        });
                    }

                    menu.push({ label: "Base Directory", type: "submenu", submenu: baseDirSubmenu }, { type: "separator" });

                    // Tab Color submenu
                    const currentTabColor = tabData?.meta?.["tab:color"];
                    const colorSubmenu: ContextMenuItem[] = TAB_COLORS.map((color) => ({
                        label: color.name,
                        type: "checkbox" as const,
                        checked: currentTabColor === color.value,
                        click: () => handleSetTabColor(color.value),
                    }));
                    colorSubmenu.push({ type: "separator" });
                    colorSubmenu.push({
                        label: "Clear",
                        click: () => handleSetTabColor(null),
                    });

                    menu.push({ label: "Tab Color", type: "submenu", submenu: colorSubmenu }, { type: "separator" });

                    const fullConfig = globalStore.get(atoms.fullConfigAtom);
                    const oref = makeORef("tab", id);

                    // Tab Variables presets
                    addPresetSubmenu(menu, fullConfig, oref, "Tab Variables", {
                        prefix: "tabvar@",
                        stripPrefixFromLabel: true,
                    });

                    // Background presets
                    addPresetSubmenu(menu, fullConfig, oref, "Backgrounds", {
                        prefix: "bg@",
                        sortByOrder: true,
                        onApply: () => {
                            RpcApi.ActivityCommand(TabRpcClient, { settabtheme: 1 }, { noresponse: true });
                            recordTEvent("action:settabtheme");
                        },
                    });
                    menu.push({ label: "Close Tab", click: () => onClose(null) });
                    ContextMenuModel.showContextMenu(menu, e);
                },
                [handleRenameTab, id, onClose, tabData, handleSetBaseDir, handleClearBaseDir, handleToggleLock, handleSetTabColor]
            );

            const tabColor = tabData?.meta?.["tab:color"];

            /**
             * Gets the status class name for the tab element.
             * Used for VS Code style text coloring.
             */
            const getStatusClassName = (): string | null => {
                switch (tabStatus) {
                    case "stopped":
                        return "status-stopped";
                    case "finished":
                        return "status-finished";
                    case "running":
                        return "status-running";
                    default:
                        return null;
                }
            };

            const statusClassName = getStatusClassName();

            return (
                <div
                    ref={tabRef}
                    className={clsx("tab", statusClassName, {
                        active,
                        dragging: isDragging,
                        "before-active": isBeforeActive,
                        "new-tab": isNew,
                        "has-color": !!tabColor,
                    })}
                    onMouseDown={onDragStart}
                    onClick={onSelect}
                    onContextMenu={handleContextMenu}
                    data-tab-id={id}
                >
                    {/* Top stripe for manual color only (VS Code style) */}
                    {tabColor && <div className="tab-color-stripe" style={{ backgroundColor: tabColor }} />}
                    <div className="tab-inner">
                        <div className="tab-name-wrapper">
                            <div
                                ref={editableRef}
                                className={clsx("name", { focused: isEditable })}
                                contentEditable={isEditable}
                                onDoubleClick={handleRenameTab}
                                onBlur={handleBlur}
                                onKeyDown={handleKeyDown}
                                suppressContentEditableWarning={true}
                            >
                                {tabData?.name}
                            </div>
                        </div>
                        <Button
                            className="ghost grey close"
                            onClick={onClose}
                            onMouseDown={handleMouseDownOnClose}
                            title="Close Tab"
                        >
                            <i className="fa fa-solid fa-xmark" />
                        </Button>
                    </div>
                </div>
            );
        }
    )
);

export { Tab };
