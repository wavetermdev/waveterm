// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { makeIconClass } from "@/util/util";
import { cn } from "@/util/util";
import { useCallback, useEffect, useRef, useState } from "react";

const RenameFocusDelayMs = 50;

export interface VTabItem {
    id: string;
    name: string;
    indicator?: TabIndicator | null;
}

interface VTabProps {
    tab: VTabItem;
    active: boolean;
    isDragging: boolean;
    isReordering: boolean;
    onSelect: () => void;
    onClose?: () => void;
    onRename?: (newName: string) => void;
    onDragStart: (event: React.DragEvent<HTMLDivElement>) => void;
    onDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
    onDrop: (event: React.DragEvent<HTMLDivElement>) => void;
    onDragEnd: () => void;
}

export function VTab({
    tab,
    active,
    isDragging,
    isReordering,
    onSelect,
    onClose,
    onRename,
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd,
}: VTabProps) {
    const [originalName, setOriginalName] = useState(tab.name);
    const [isEditable, setIsEditable] = useState(false);
    const editableRef = useRef<HTMLDivElement>(null);
    const editableTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        setOriginalName(tab.name);
    }, [tab.name]);

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
        if (onRename == null || isReordering) {
            return;
        }
        if (editableTimeoutRef.current) {
            clearTimeout(editableTimeoutRef.current);
        }
        setIsEditable(true);
        editableTimeoutRef.current = setTimeout(() => {
            selectEditableText();
        }, RenameFocusDelayMs);
    }, [isReordering, onRename, selectEditableText]);

    const handleBlur = () => {
        if (!editableRef.current) {
            return;
        }
        const newText = editableRef.current.textContent?.trim() || originalName;
        editableRef.current.textContent = newText;
        setIsEditable(false);
        if (newText !== originalName) {
            onRename?.(newText);
        }
    };

    const handleKeyDown: React.KeyboardEventHandler<HTMLDivElement> = (event) => {
        if (!editableRef.current) {
            return;
        }
        if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            editableRef.current.blur();
            return;
        }
        if (event.key !== "Escape") {
            return;
        }
        editableRef.current.textContent = originalName;
        editableRef.current.blur();
        event.preventDefault();
        event.stopPropagation();
    };

    return (
        <div
            draggable
            onClick={onSelect}
            onDoubleClick={(event) => {
                event.stopPropagation();
                startRename();
            }}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onDragEnd={onDragEnd}
            className={cn(
                "group relative flex h-9 w-full cursor-pointer items-center border-b border-border/70 pl-2 text-sm transition-colors select-none",
                "whitespace-nowrap",
                active
                    ? "bg-accent/20 text-primary"
                    : isReordering
                      ? "bg-transparent text-secondary"
                      : "bg-transparent text-secondary hover:bg-hover",
                isDragging && "opacity-50"
            )}
        >
            {tab.indicator && (
                <span className="mr-1 shrink-0 text-xs" style={{ color: tab.indicator.color || "#fbbf24" }}>
                    <i className={makeIconClass(tab.indicator.icon, true, { defaultIcon: "bell" })} />
                </span>
            )}
            <div
                ref={editableRef}
                className={cn(
                    "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap transition-[padding-right]",
                    onClose && !isReordering && "group-hover:pr-[18px]",
                    isEditable && "rounded-[2px] bg-white/15 outline-none"
                )}
                contentEditable={isEditable}
                role="textbox"
                aria-label="Tab name"
                aria-readonly={!isEditable}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                suppressContentEditableWarning={true}
            >
                {tab.name}
            </div>
            {onClose && (
                <button
                    type="button"
                    className={cn(
                        "absolute top-1/2 right-0 shrink-0 -translate-y-1/2 cursor-pointer py-1 pl-1 pr-1.5 text-secondary transition",
                        isReordering ? "opacity-0" : "opacity-0 group-hover:opacity-100 hover:text-primary"
                    )}
                    onClick={(event) => {
                        event.stopPropagation();
                        onClose();
                    }}
                    aria-label="Close tab"
                >
                    <i className="fa fa-solid fa-xmark" />
                </button>
            )}
        </div>
    );
}
