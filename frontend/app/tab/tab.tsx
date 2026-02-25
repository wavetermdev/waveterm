// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    atoms,
    clearAllTabIndicators,
    clearTabIndicatorFromFocus,
    getTabIndicatorAtom,
    globalStore,
    recordTEvent,
    refocusNode,
    setTabIndicator,
} from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { Button } from "@/element/button";
import { ContextMenuModel } from "@/store/contextmenu";
import { fireAndForget, makeIconClass } from "@/util/util";
import clsx from "clsx";
import { useAtomValue } from "jotai";
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ObjectService } from "../store/services";
import { makeORef, useWaveObjectValue } from "../store/wos";
import "./tab.scss";

interface TabVProps {
    tabId: string;
    tabName: string;
    active: boolean;
    isBeforeActive: boolean;
    isDragging: boolean;
    tabWidth: number;
    isNew: boolean;
    indicator?: TabIndicator | null;
    onClick: () => void;
    onClose: (event: React.MouseEvent<HTMLButtonElement, MouseEvent> | null) => void;
    onDragStart: (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => void;
    onContextMenu: (e: React.MouseEvent<HTMLDivElement>) => void;
    onRename: (newName: string) => void;
    /** Optional ref that TabV populates with a startRename() function for external callers */
    renameRef?: React.RefObject<(() => void) | null>;
}

const TabV = forwardRef<HTMLDivElement, TabVProps>((props, ref) => {
    const {
        tabId,
        tabName,
        active,
        isBeforeActive,
        isDragging,
        tabWidth,
        isNew,
        indicator,
        onClick,
        onClose,
        onDragStart,
        onContextMenu,
        onRename,
        renameRef,
    } = props;
    const [originalName, setOriginalName] = useState(tabName);
    const [isEditable, setIsEditable] = useState(false);

    const editableRef = useRef<HTMLDivElement>(null);
    const editableTimeoutRef = useRef<NodeJS.Timeout>(null);
    const tabRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(ref, () => tabRef.current as HTMLDivElement);

    useEffect(() => {
        setOriginalName(tabName);
    }, [tabName]);

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
        if (!selection) {
            return;
        }
        range.selectNodeContents(editableRef.current);
        selection.removeAllRanges();
        selection.addRange(range);
    }, []);

    const startRename = useCallback(() => {
        setIsEditable(true);
        editableTimeoutRef.current = setTimeout(() => {
            selectEditableText();
        }, 50);
    }, [selectEditableText]);

    const handleRenameTab: React.MouseEventHandler<HTMLDivElement> = useCallback(
        (event) => {
            event?.stopPropagation();
            startRename();
        },
        [startRename]
    );

    // Expose startRename to external callers (e.g. context menu in TabInner)
    if (renameRef != null) {
        renameRef.current = startRename;
    }

    const handleBlur = () => {
        if (!editableRef.current) return;
        let newText = editableRef.current.innerText.trim();
        newText = newText || originalName;
        editableRef.current.innerText = newText;
        setIsEditable(false);
        onRename(newText);
    };

    const handleKeyDown: React.KeyboardEventHandler<HTMLDivElement> = (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "a") {
            event.preventDefault();
            selectEditableText();
            return;
        }
        if (!editableRef.current) return;
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
        if (tabRef.current && isNew) {
            const initialWidth = `${(tabWidth / 3) * 2}px`;
            tabRef.current.style.setProperty("--initial-tab-width", initialWidth);
            tabRef.current.style.setProperty("--final-tab-width", `${tabWidth}px`);
        }
    }, [isNew, tabWidth]);

    const handleMouseDownOnClose = (event: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
        event.stopPropagation();
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
            onClick={onClick}
            onContextMenu={onContextMenu}
            data-tab-id={tabId}
        >
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
                    {tabName}
                </div>
                {indicator && (
                    <div
                        className="tab-indicator pointer-events-none"
                        style={{ color: indicator.color || "#fbbf24" }}
                        title="Activity notification"
                    >
                        <i className={makeIconClass(indicator.icon, true, { defaultIcon: "bell" })} />
                    </div>
                )}
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
});

TabV.displayName = "TabV";

function buildTabContextMenu(
    id: string,
    renameRef: React.RefObject<(() => void) | null>,
    onClose: (event: React.MouseEvent<HTMLButtonElement, MouseEvent> | null) => void
): ContextMenuItem[] {
    const menu: ContextMenuItem[] = [];
    const currentIndicator = globalStore.get(getTabIndicatorAtom(id));
    if (currentIndicator) {
        menu.push(
            {
                label: "Clear Tab Indicator",
                click: () => setTabIndicator(id, null),
            },
            {
                label: "Clear All Indicators",
                click: () => clearAllTabIndicators(),
            },
            { type: "separator" }
        );
    }
    menu.push(
        { label: "Rename Tab", click: () => renameRef.current?.() },
        {
            label: "Copy TabId",
            click: () => fireAndForget(() => navigator.clipboard.writeText(id)),
        },
        { type: "separator" }
    );
    const fullConfig = globalStore.get(atoms.fullConfigAtom);
    const bgPresets: string[] = [];
    for (const key in fullConfig?.presets ?? {}) {
        if (key.startsWith("bg@") && fullConfig.presets[key] != null) {
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
            // preset cannot be null (filtered above)
            const preset = fullConfig.presets[presetName];
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
    return menu;
}

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

const TabInner = forwardRef<HTMLDivElement, TabProps>((props, ref) => {
    const { id, active, isBeforeActive, isDragging, tabWidth, isNew, onLoaded, onSelect, onClose, onDragStart } = props;
    const [tabData, _] = useWaveObjectValue<Tab>(makeORef("tab", id));
    const indicator = useAtomValue(getTabIndicatorAtom(id));

    const loadedRef = useRef(false);
    const renameRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        if (!loadedRef.current) {
            onLoaded();
            loadedRef.current = true;
        }
    }, [onLoaded]);

    const handleTabClick = () => {
        const currentIndicator = globalStore.get(getTabIndicatorAtom(id));
        if (currentIndicator?.clearonfocus) {
            clearTabIndicatorFromFocus(id);
        }
        onSelect();
    };

    const handleContextMenu = useCallback(
        (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
            e.preventDefault();
            const menu = buildTabContextMenu(id, renameRef, onClose);
            ContextMenuModel.getInstance().showContextMenu(menu, e);
        },
        [id, onClose]
    );

    const handleRename = useCallback(
        (newName: string) => {
            fireAndForget(() => ObjectService.UpdateTabName(id, newName));
            setTimeout(() => refocusNode(null), 10);
        },
        [id]
    );

    return (
        <TabV
            ref={ref}
            tabId={id}
            tabName={tabData?.name ?? ""}
            active={active}
            isBeforeActive={isBeforeActive}
            isDragging={isDragging}
            tabWidth={tabWidth}
            isNew={isNew}
            indicator={indicator}
            onClick={handleTabClick}
            onClose={onClose}
            onDragStart={onDragStart}
            onContextMenu={handleContextMenu}
            onRename={handleRename}
            renameRef={renameRef}
        />
    );
});
const Tab = memo(TabInner);
Tab.displayName = "Tab";

export { Tab, TabV };
