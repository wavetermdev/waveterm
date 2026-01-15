// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms, globalStore, recordTEvent, refocusNode } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { Button } from "@/element/button";
import { ContextMenuModel } from "@/store/contextmenu";
import { fireAndForget } from "@/util/util";
import clsx from "clsx";
import React, { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ObjectService } from "../store/services";
import { makeORef, useWaveObjectValue } from "../store/wos";
import "./tab.scss";

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

            const handleClearBaseDir = useCallback(() => {
                fireAndForget(async () => {
                    await ObjectService.UpdateObjectMeta(makeORef("tab", id), {
                        "tab:basedir": null,
                    });
                });
            }, [id]);

            const handleToggleLock = useCallback(() => {
                const currentLock = tabData?.meta?.["tab:basedirlock"] || false;
                fireAndForget(async () => {
                    await ObjectService.UpdateObjectMeta(makeORef("tab", id), {
                        "tab:basedirlock": !currentLock,
                    });
                });
            }, [id, tabData]);

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

                    const fullConfig = globalStore.get(atoms.fullConfigAtom);

                    // Tab Variables presets
                    const tabVarPresets: string[] = [];
                    for (const key in fullConfig?.presets ?? {}) {
                        if (key.startsWith("tabvar@")) {
                            tabVarPresets.push(key);
                        }
                    }
                    if (tabVarPresets.length > 0) {
                        const tabVarSubmenu: ContextMenuItem[] = [];
                        const oref = makeORef("tab", id);
                        for (const presetName of tabVarPresets) {
                            const preset = fullConfig.presets[presetName];
                            if (preset == null) {
                                continue;
                            }
                            const displayName = preset["display:name"] ?? presetName.replace("tabvar@", "");
                            tabVarSubmenu.push({
                                label: displayName,
                                click: () =>
                                    fireAndForget(async () => {
                                        await ObjectService.UpdateObjectMeta(oref, preset);
                                    }),
                            });
                        }
                        menu.push({ label: "Tab Variables", type: "submenu", submenu: tabVarSubmenu }, { type: "separator" });
                    }

                    // Background presets
                    const bgPresets: string[] = [];
                    for (const key in fullConfig?.presets ?? {}) {
                        if (key.startsWith("bg@")) {
                            bgPresets.push(key);
                        }
                    }
                    bgPresets.sort((a, b) => {
                        const aOrder = fullConfig.presets[a]["display:order"] ?? 0;
                        const bOrder = fullConfig.presets[b]["display:order"] ?? 0;
                        return aOrder - bOrder;
                    });
                    if (bgPresets.length > 0) {
                        const submenu: ContextMenuItem[] = [];
                        const oref = makeORef("tab", id);
                        for (const presetName of bgPresets) {
                            const preset = fullConfig.presets[presetName];
                            if (preset == null) {
                                continue;
                            }
                            submenu.push({
                                label: preset["display:name"] ?? presetName,
                                click: () =>
                                    fireAndForget(async () => {
                                        await ObjectService.UpdateObjectMeta(oref, preset);
                                        RpcApi.ActivityCommand(TabRpcClient, { settabtheme: 1 }, { noresponse: true });
                                        recordTEvent("action:settabtheme");
                                    }),
                            });
                        }
                        menu.push({ label: "Backgrounds", type: "submenu", submenu }, { type: "separator" });
                    }
                    menu.push({ label: "Close Tab", click: () => onClose(null) });
                    ContextMenuModel.showContextMenu(menu, e);
                },
                [handleRenameTab, id, onClose, tabData, handleSetBaseDir, handleClearBaseDir, handleToggleLock]
            );

            const baseDir = tabData?.meta?.["tab:basedir"];
            const isBaseDirLocked = tabData?.meta?.["tab:basedirlock"] || false;

            // Shorten base directory path for display
            const getShortPath = (path: string) => {
                if (!path) return "";
                if (path.startsWith("~")) return path;
                const parts = path.split(/[\/\\]/);
                if (parts.length <= 2) return path;
                return ".../" + parts.slice(-2).join("/");
            };

            return (
                <div
                    ref={tabRef}
                    className={clsx("tab", {
                        active,
                        dragging: isDragging,
                        "before-active": isBeforeActive,
                        "new-tab": isNew,
                    })}
                    onMouseDown={onDragStart}
                    onClick={onSelect}
                    onContextMenu={handleContextMenu}
                    data-tab-id={id}
                >
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
                            {baseDir && (
                                <div className="tab-basedir" title={baseDir}>
                                    <i className="fa fa-folder" />
                                    <span className="tab-basedir-path">{getShortPath(baseDir)}</span>
                                    {isBaseDirLocked && (
                                        <i
                                            className="fa fa-lock tab-basedir-lock"
                                            title="Base directory locked (smart detection disabled)"
                                            onClick={(e: React.MouseEvent) => {
                                                e.stopPropagation();
                                                handleToggleLock();
                                            }}
                                        />
                                    )}
                                    {!isBaseDirLocked && (
                                        <i
                                            className="fa fa-unlock tab-basedir-lock unlocked"
                                            title="Base directory unlocked (smart detection enabled)"
                                            onClick={(e: React.MouseEvent) => {
                                                e.stopPropagation();
                                                handleToggleLock();
                                            }}
                                        />
                                    )}
                                </div>
                            )}
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
