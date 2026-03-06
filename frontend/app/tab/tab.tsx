// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getTabBadgeAtom, sortBadgesForTab } from "@/app/store/badge";
import { atoms, getOrefMetaKeyAtom, globalStore, recordTEvent, refocusNode } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { Button } from "@/element/button";
import { ContextMenuModel } from "@/store/contextmenu";
import { validateCssColor } from "@/util/color-validator";
import { fireAndForget, makeIconClass } from "@/util/util";
import clsx from "clsx";
import { useAtomValue } from "jotai";
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { v7 as uuidv7 } from "uuid";
import { ObjectService } from "../store/services";
import { makeORef, useWaveObjectValue } from "../store/wos";
import "./tab.scss";

interface TabVProps {
    tabId: string;
    tabName: string;
    active: boolean;
    showDivider: boolean;
    isDragging: boolean;
    tabWidth: number;
    isNew: boolean;
    badges?: Badge[] | null;
    flagColor?: string | null;
    onClick: () => void;
    onClose: (event: React.MouseEvent<HTMLButtonElement, MouseEvent> | null) => void;
    onDragStart: (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => void;
    onContextMenu: (e: React.MouseEvent<HTMLDivElement>) => void;
    onRename: (newName: string) => void;
    /** Optional ref that TabV populates with a startRename() function for external callers */
    renameRef?: React.RefObject<(() => void) | null>;
}

interface TabBadgesProps {
    badges?: Badge[] | null;
    flagColor?: string | null;
}

function TabBadges({ badges, flagColor }: TabBadgesProps) {
    const flagBadgeId = useMemo(() => uuidv7(), []);
    const allBadges = useMemo(() => {
        const base = badges ?? [];
        if (!flagColor) {
            return base;
        }
        const flagBadge: Badge = { icon: "flag", color: flagColor, priority: 0, badgeid: flagBadgeId };
        return sortBadgesForTab([...base, flagBadge]);
    }, [badges, flagColor, flagBadgeId]);
    if (!allBadges[0]) {
        return null;
    }
    const firstBadge = allBadges[0];
    const extraBadges = allBadges.slice(1, 3);
    return (
        <div className="pointer-events-none absolute left-[4px] top-1/2 z-[3] flex h-[20px] w-[20px] -translate-y-1/2 items-center justify-center px-[2px] py-[1px]">
            <i
                className={makeIconClass(firstBadge.icon, true, { defaultIcon: "circle-small" }) + " text-[12px]"}
                style={{ color: firstBadge.color || "#fbbf24" }}
            />
            {extraBadges.length > 0 && (
                <div className="flex flex-col items-center justify-center gap-[2px] ml-[2px]">
                    {extraBadges.map((badge, idx) => (
                        <div
                            key={idx}
                            className="w-[4px] h-[4px] rounded-full"
                            style={{ backgroundColor: badge.color || "#fbbf24" }}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

const TabV = forwardRef<HTMLDivElement, TabVProps>((props, ref) => {
    const {
        tabId,
        tabName,
        active,
        showDivider,
        isDragging,
        tabWidth,
        isNew,
        badges,
        flagColor,
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
                "new-tab": isNew,
            })}
            onMouseDown={onDragStart}
            onClick={onClick}
            onContextMenu={onContextMenu}
            data-tab-id={tabId}
        >
            {showDivider && <div className="tab-divider" />}
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
                <TabBadges badges={badges} flagColor={flagColor} />
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

const FlagColors: { label: string; value: string }[] = [
    { label: "Green", value: "#58C142" },
    { label: "Teal", value: "#00FFDB" },
    { label: "Blue", value: "#429DFF" },
    { label: "Purple", value: "#BF55EC" },
    { label: "Red", value: "#FF453A" },
    { label: "Orange", value: "#FF9500" },
    { label: "Yellow", value: "#FFE900" },
];

function buildTabContextMenu(
    id: string,
    renameRef: React.RefObject<(() => void) | null>,
    onClose: (event: React.MouseEvent<HTMLButtonElement, MouseEvent> | null) => void
): ContextMenuItem[] {
    const menu: ContextMenuItem[] = [];
    menu.push(
        { label: "Rename Tab", click: () => renameRef.current?.() },
        {
            label: "Copy TabId",
            click: () => fireAndForget(() => navigator.clipboard.writeText(id)),
        },
        { type: "separator" }
    );
    const tabORef = makeORef("tab", id);
    const currentFlagColor = globalStore.get(getOrefMetaKeyAtom(tabORef, "tab:flagcolor")) ?? null;
    const flagSubmenu: ContextMenuItem[] = [
        {
            label: "None",
            type: "checkbox",
            checked: currentFlagColor == null,
            click: () => fireAndForget(() => ObjectService.UpdateObjectMeta(tabORef, { "tab:flagcolor": null })),
        },
        ...FlagColors.map((fc) => ({
            label: fc.label,
            type: "checkbox" as const,
            checked: currentFlagColor === fc.value,
            click: () => fireAndForget(() => ObjectService.UpdateObjectMeta(tabORef, { "tab:flagcolor": fc.value })),
        })),
    ];
    menu.push({ label: "Flag Tab", type: "submenu", submenu: flagSubmenu }, { type: "separator" });
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
    showDivider: boolean;
    isDragging: boolean;
    tabWidth: number;
    isNew: boolean;
    onSelect: () => void;
    onClose: (event: React.MouseEvent<HTMLButtonElement, MouseEvent> | null) => void;
    onDragStart: (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => void;
    onLoaded: () => void;
}

const TabInner = forwardRef<HTMLDivElement, TabProps>((props, ref) => {
    const { id, active, showDivider, isDragging, tabWidth, isNew, onLoaded, onSelect, onClose, onDragStart } = props;
    const [tabData, _] = useWaveObjectValue<Tab>(makeORef("tab", id));
    const badges = useAtomValue(getTabBadgeAtom(id));

    const rawFlagColor = tabData?.meta?.["tab:flagcolor"];
    let flagColor: string | null = null;
    if (rawFlagColor) {
        try {
            validateCssColor(rawFlagColor);
            flagColor = rawFlagColor;
        } catch {
            flagColor = null;
        }
    }

    const loadedRef = useRef(false);
    const renameRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        if (!loadedRef.current) {
            onLoaded();
            loadedRef.current = true;
        }
    }, [onLoaded]);

    const handleTabClick = () => {
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
            showDivider={showDivider}
            isDragging={isDragging}
            tabWidth={tabWidth}
            isNew={isNew}
            badges={badges}
            flagColor={flagColor}
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
