// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/element/button";
import { ContextMenuModel } from "@/store/contextmenu";
import { clsx } from "clsx";
import { atom, useAtom, useAtomValue } from "jotai";
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

import { atoms, globalStore, refocusNode } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { ObjectService } from "../store/services";
import { makeORef, useWaveObjectValue } from "../store/wos";

import "./tab.scss";

const adjacentTabsAtom = atom<Set<string>>(new Set<string>());

interface TabProps {
    id: string;
    isActive: boolean;
    isFirst: boolean;
    isBeforeActive: boolean;
    isDragging: boolean;
    tabWidth: number;
    isNew: boolean;
    isPinned: boolean;
    tabIds: string[];
    tabRefs: React.MutableRefObject<React.RefObject<HTMLDivElement>[]>;
    onClick: () => void;
    onClose: (event: React.MouseEvent<HTMLButtonElement, MouseEvent> | null) => void;
    onMouseDown: (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => void;
    onLoaded: () => void;
    onPinChange: () => void;
    // onMouseEnter: (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => void;
    // onMouseLeave: (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => void;
}

const Tab = memo(
    forwardRef<HTMLDivElement, TabProps>(
        (
            {
                id,
                isActive,
                isFirst,
                isPinned,
                isBeforeActive,
                isDragging,
                tabWidth,
                isNew,
                tabIds,
                tabRefs,
                onLoaded,
                onClick,
                onClose,
                onMouseDown,
                // onMouseEnter,
                // onMouseLeave,
                onPinChange,
            },
            ref
        ) => {
            const [tabData, _] = useWaveObjectValue<Tab>(makeORef("tab", id));
            const [originalName, setOriginalName] = useState("");
            const [isEditable, setIsEditable] = useState(false);

            const editableRef = useRef<HTMLDivElement>(null);
            const editableTimeoutRef = useRef<NodeJS.Timeout>();
            const loadedRef = useRef(false);
            const tabRef = useRef<HTMLDivElement>(null);
            const adjacentTabsRef = useRef<Set<string>>(new Set());

            const tabIndicesMoved = useAtomValue<number[]>(atoms.tabIndicesMoved);
            const tabs = document.querySelectorAll(".tab");
            const [adjacentTabs, setAdjacentTabs] = useAtom(adjacentTabsAtom);

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

            const handleRenameTab = (event) => {
                event?.stopPropagation();
                setIsEditable(true);
                editableTimeoutRef.current = setTimeout(() => {
                    if (editableRef.current) {
                        editableRef.current.focus();
                        document.execCommand("selectAll", false);
                    }
                }, 0);
            };

            const handleBlur = () => {
                let newText = editableRef.current.innerText.trim();
                newText = newText || originalName;
                editableRef.current.innerText = newText;
                setIsEditable(false);
                ObjectService.UpdateTabName(id, newText);
                setTimeout(() => refocusNode(null), 10);
            };

            const handleKeyDown = (event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "a") {
                    event.preventDefault();
                    if (editableRef.current) {
                        const range = document.createRange();
                        const selection = window.getSelection();
                        range.selectNodeContents(editableRef.current);
                        selection.removeAllRanges();
                        selection.addRange(range);
                    }
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

            const handleContextMenu = useCallback(
                (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
                    e.preventDefault();
                    let menu: ContextMenuItem[] = [
                        { label: isPinned ? "Unpin Tab" : "Pin Tab", click: () => onPinChange() },
                        { label: "Rename Tab", click: () => handleRenameTab(null) },
                        { label: "Copy TabId", click: () => navigator.clipboard.writeText(id) },
                        { type: "separator" },
                    ];
                    const fullConfig = globalStore.get(atoms.fullConfigAtom);
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
                                click: () => {
                                    ObjectService.UpdateObjectMeta(oref, preset);
                                    RpcApi.ActivityCommand(TabRpcClient, { settabtheme: 1 });
                                },
                            });
                        }
                        menu.push({ label: "Backgrounds", type: "submenu", submenu }, { type: "separator" });
                    }
                    menu.push({ label: "Close Tab", click: () => onClose(null) });
                    ContextMenuModel.showContextMenu(menu, e);
                },
                [onPinChange, handleRenameTab, id, onClose, isPinned]
            );

            if (isDragging) {
                console.log("isDragging", isDragging);
                console.log("dragging tab idx>>>>>>", id);
                const draggingTabIdx = tabIds.indexOf(id);

                // Add the dragging tab and its right adjacent tab to the Set
                adjacentTabsRef.current.add(id);
                if (draggingTabIdx + 1 < tabIds.length) {
                    adjacentTabsRef.current.add(tabIds[draggingTabIdx + 1]);
                }
            }

            if (isActive) {
                const activeTabIdx = tabIds.indexOf(id);

                // Add the active tab and its right adjacent tab to the Set
                adjacentTabsRef.current.add(id);
                if (activeTabIdx + 1 < tabIds.length) {
                    adjacentTabsRef.current.add(tabIds[activeTabIdx + 1]);
                }
            }

            useEffect(() => {
                console.log("triggered!!!!");
                if ((isDragging || isActive) && tabIndicesMoved.length) {
                    // Find the index of the current tab ID
                    const currentIndex = tabIds.indexOf(id);

                    console.log("tabIds", tabIds);
                    console.log("id", id);

                    // Get the right adjacent ID
                    const rightAdjacentId = tabIds[currentIndex + 1];
                    // Get the left adjacent ID
                    const leftAdjacentId = tabIds[currentIndex - 1];

                    // console.log("rightAdjacentId", rightAdjacentId);

                    // Set the opacity of the separator for the current tab
                    if (currentIndex !== -1) {
                        const currentTabElement = document.querySelector(`[data-tab-id="${id}"]`) as HTMLElement;
                        if (currentTabElement) {
                            const separator = currentTabElement.querySelector(".separator") as HTMLElement;
                            if (separator) {
                                console.log("1");
                                separator.style.opacity = "0"; // Always hide the separator of the current tab
                            }
                        }
                    }

                    // Set the opacity of the separator for the right adjacent tab
                    if (rightAdjacentId) {
                        const rightAdjacentTabElement = document.querySelector(
                            `[data-tab-id="${rightAdjacentId}"]`
                        ) as HTMLElement;
                        if (rightAdjacentTabElement) {
                            const separator = rightAdjacentTabElement.querySelector(".separator") as HTMLElement;
                            if (separator) {
                                console.log("2");
                                separator.style.opacity = "0"; // Hide the separator of the right adjacent tab
                            }
                        }
                    }

                    // Cleanup function to reset opacity
                    return () => {
                        if (!isActive && currentIndex !== -1) {
                            const currentTabElement = document.querySelector(`[data-tab-id="${id}"]`) as HTMLElement;

                            // To check if leftAdjacentId is the active tab
                            const leftAdjacentElement = document.querySelector(
                                `[data-tab-id="${leftAdjacentId}"]`
                            ) as HTMLElement;
                            if (
                                currentTabElement &&
                                leftAdjacentElement &&
                                !leftAdjacentElement.classList.contains("active")
                            ) {
                                console.log(
                                    "currentTabElement>>>>>>",
                                    currentTabElement,
                                    currentTabElement &&
                                        leftAdjacentElement &&
                                        !leftAdjacentElement.classList.contains("active")
                                );
                                const separator = currentTabElement.querySelector(".separator") as HTMLElement;
                                if (separator) {
                                    separator.style.opacity = "1"; // Reset opacity for the current tab only if not active
                                }
                            }
                        }

                        if (rightAdjacentId) {
                            const rightAdjacentTabElement = document.querySelector(
                                `[data-tab-id="${rightAdjacentId}"]`
                            ) as HTMLElement;
                            console.log("rightAdjacentId!!!!!", rightAdjacentId);
                            if (rightAdjacentTabElement) {
                                const separator = rightAdjacentTabElement.querySelector(".separator") as HTMLElement;
                                if (separator) {
                                    separator.style.opacity = "1"; // Reset opacity for the right adjacent tab
                                }
                            }
                        }
                    };
                }
            }, [id, tabIds, isFirst, isActive, tabIndicesMoved]);

            return (
                <div
                    ref={tabRef}
                    className={clsx("tab", {
                        active: isActive,
                        isDragging,
                        "before-active": isBeforeActive,
                        "new-tab": isNew,
                    })}
                    onMouseDown={onMouseDown}
                    onClick={onClick}
                    onContextMenu={handleContextMenu}
                    // onMouseEnter={onMouseEnter}
                    // onMouseLeave={onMouseLeave}
                    data-tab-id={id}
                >
                    <div className="separator"></div>
                    <div className="tab-inner">
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
                            {id.substring(id.length - 3)}
                        </div>
                        {isPinned ? (
                            <Button
                                className="ghost grey pin"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onPinChange();
                                }}
                            >
                                <i className="fa fa-solid fa-thumbtack" />
                            </Button>
                        ) : (
                            <Button className="ghost grey close" onClick={onClose} onMouseDown={handleMouseDownOnClose}>
                                <i className="fa fa-solid fa-xmark" />
                            </Button>
                        )}
                    </div>
                </div>
            );
        }
    )
);

export { Tab };
