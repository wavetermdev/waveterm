// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/element/button";
import { ContextMenuModel } from "@/store/contextmenu";
import * as services from "@/store/services";
import * as WOS from "@/store/wos";
import { clsx } from "clsx";
import * as React from "react";
import { forwardRef, useEffect, useRef, useState } from "react";

import "./tab.less";

interface TabProps {
    id: string;
    active: boolean;
    isFirst: boolean;
    isBeforeActive: boolean;
    isDragging: boolean;
    onSelect: () => void;
    onClose: (event: React.MouseEvent<HTMLButtonElement, MouseEvent> | null) => void;
    onDragStart: (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => void;
    onLoaded: () => void;
}

const Tab = React.memo(
    forwardRef<HTMLDivElement, TabProps>(
        ({ id, active, isFirst, isBeforeActive, isDragging, onLoaded, onSelect, onClose, onDragStart }, ref) => {
            const [tabData, tabLoading] = WOS.useWaveObjectValue<Tab>(WOS.makeORef("tab", id));
            const [originalName, setOriginalName] = useState("");
            const [isEditable, setIsEditable] = useState(false);

            const editableRef = useRef<HTMLDivElement>(null);
            const editableTimeoutRef = useRef<NodeJS.Timeout>();
            const loadedRef = useRef(false);

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

            const handleDoubleClick = (event) => {
                event.stopPropagation();
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
                services.ObjectService.UpdateTabName(id, newText);
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

                if (event.key === "Enter") {
                    event.preventDefault();
                    if (editableRef.current.innerText.trim() === "") {
                        editableRef.current.innerText = originalName;
                    }
                    editableRef.current.blur();
                } else if (event.key === "Escape") {
                    editableRef.current.innerText = originalName;
                    editableRef.current.blur();
                } else if (
                    editableRef.current.innerText.length >= 8 &&
                    !["Backspace", "Delete", "ArrowLeft", "ArrowRight"].includes(event.key)
                ) {
                    event.preventDefault();
                }
            };

            useEffect(() => {
                if (!loadedRef.current) {
                    onLoaded();
                    loadedRef.current = true;
                }
            }, [onLoaded]);

            // Prevent drag from being triggered on mousedown
            const handleMouseDownOnClose = (event: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
                event.stopPropagation();
            };

            function handleContextMenu(e: React.MouseEvent<HTMLDivElement, MouseEvent>) {
                e.preventDefault();
                let menu: ContextMenuItem[] = [];
                menu.push({ label: "Copy TabId", click: () => navigator.clipboard.writeText(id) });
                menu.push({ type: "separator" });
                menu.push({ label: "Close Tab", click: () => onClose(null) });
                ContextMenuModel.showContextMenu(menu, e);
            }

            return (
                <div
                    ref={ref}
                    className={clsx("tab", { active, isDragging, "before-active": isBeforeActive })}
                    onMouseDown={onDragStart}
                    onClick={onSelect}
                    onContextMenu={handleContextMenu}
                    data-tab-id={id}
                >
                    {/* {isFirst && <div className="vertical-line first" />}
                    <div
                        ref={editableRef}
                        className={clsx("name", { focused: isEditable })}
                        contentEditable={isEditable}
                        onDoubleClick={handleDoubleClick}
                        onBlur={handleBlur}
                        onKeyDown={handleKeyDown}
                        suppressContentEditableWarning={true}
                    >
                        {tabData?.name}
                    </div>
                    {!isDragging && <div className="vertical-line" />}
                    {active && <div className="mask" />}
                    <Button className="secondary ghost close" onClick={onClose} onMouseDown={handleMouseDownOnClose}>
                        <i className="fa fa-solid fa-xmark" />
                    </Button> */}
                    <div className="tab-inner">
                        <div
                            ref={editableRef}
                            className={clsx("name", { focused: isEditable })}
                            contentEditable={isEditable}
                            onDoubleClick={handleDoubleClick}
                            onBlur={handleBlur}
                            onKeyDown={handleKeyDown}
                            suppressContentEditableWarning={true}
                        >
                            {tabData?.name}
                        </div>
                        {active && <div className="mask" />}
                        <Button
                            className="secondary ghost close"
                            onClick={onClose}
                            onMouseDown={handleMouseDownOnClose}
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
