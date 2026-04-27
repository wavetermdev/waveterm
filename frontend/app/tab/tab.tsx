// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getTabBadgeAtom } from "@/app/store/badge";
import { refocusNode } from "@/app/store/global";
import { getTabModelByTabId } from "@/app/store/tab-model";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { WaveEnv, WaveEnvSubset, useWaveEnv } from "@/app/waveenv/waveenv";
import { Button } from "@/element/button";
import { validateCssColor } from "@/util/color-validator";
import { fireAndForget } from "@/util/util";
import clsx from "clsx";
import { useAtomValue } from "jotai";
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { makeORef } from "../store/wos";
import { TabBadges } from "./tabbadges";
import "./tab.scss";
import { buildTabContextMenu } from "./tabcontextmenu";

export type TabEnv = WaveEnvSubset<{
    rpc: {
        ActivityCommand: WaveEnv["rpc"]["ActivityCommand"];
        SetConfigCommand: WaveEnv["rpc"]["SetConfigCommand"];
        SetMetaCommand: WaveEnv["rpc"]["SetMetaCommand"];
        UpdateTabNameCommand: WaveEnv["rpc"]["UpdateTabNameCommand"];
    };
    atoms: {
        fullConfigAtom: WaveEnv["atoms"]["fullConfigAtom"];
    };
    wos: WaveEnv["wos"];
    getSettingsKeyAtom: WaveEnv["getSettingsKeyAtom"];
    showContextMenu: WaveEnv["showContextMenu"];
}>;

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
    const MaxTabNameLength = 14;
    const truncateTabName = (name: string) => [...(name ?? "")].slice(0, MaxTabNameLength).join("");
    const displayName = truncateTabName(tabName);
    const [originalName, setOriginalName] = useState(displayName);
    const [isEditable, setIsEditable] = useState(false);

    const editableRef = useRef<HTMLDivElement>(null);
    const editableTimeoutRef = useRef<NodeJS.Timeout>(null);
    const tabRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(ref, () => tabRef.current as HTMLDivElement);

    useEffect(() => {
        setOriginalName(truncateTabName(tabName));
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
            const selection = window.getSelection();
            if (!selection || selection.isCollapsed) {
                event.preventDefault();
                event.stopPropagation();
            }
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
                    {displayName}
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
    const env = useWaveEnv<TabEnv>();
    const [tabData, _] = env.wos.useWaveObjectValue<Tab>(makeORef("tab", id));
    const badges = useAtomValue(getTabBadgeAtom(id, env));

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
    const tabModel = getTabModelByTabId(id, env);

    useEffect(() => {
        if (!loadedRef.current) {
            onLoaded();
            loadedRef.current = true;
        }
    }, [onLoaded]);

    useEffect(() => {
        const cb = () => renameRef.current?.();
        tabModel.startRenameCallback = cb;
        return () => {
            if (tabModel.startRenameCallback === cb) {
                tabModel.startRenameCallback = null;
            }
        };
    }, [tabModel]);

    const handleTabClick = () => {
        onSelect();
    };

    const handleContextMenu = useCallback(
        (e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
            e.preventDefault();
            const menu = buildTabContextMenu(id, renameRef, onClose, env);
            env.showContextMenu(menu, e);
        },
        [id, onClose, env]
    );

    const handleRename = useCallback(
        (newName: string) => {
            fireAndForget(() => env.rpc.UpdateTabNameCommand(TabRpcClient, id, newName));
            setTimeout(() => refocusNode(null), 10);
        },
        [id, env]
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
