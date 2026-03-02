// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { makeIconClass } from "@/util/util";
import { cn } from "@/util/util";

export interface VTabIndicator {
    icon: string;
    color?: string;
}

export interface VTabItem {
    id: string;
    name: string;
    indicator?: VTabIndicator | null;
}

interface VTabProps {
    tab: VTabItem;
    active: boolean;
    isDragging: boolean;
    isDropTarget: boolean;
    onSelect: () => void;
    onClose?: () => void;
    onDragStart: (event: React.DragEvent<HTMLDivElement>) => void;
    onDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
    onDrop: (event: React.DragEvent<HTMLDivElement>) => void;
    onDragEnd: () => void;
}

export function VTab({
    tab,
    active,
    isDragging,
    isDropTarget,
    onSelect,
    onClose,
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd,
}: VTabProps) {
    return (
        <div
            draggable
            onClick={onSelect}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onDragEnd={onDragEnd}
            className={cn(
                "group flex h-9 w-full cursor-pointer items-center gap-2 rounded-md border px-2 text-sm transition-colors select-none",
                "whitespace-nowrap",
                active
                    ? "border-accent/40 bg-accent/20 text-primary"
                    : "border-transparent bg-transparent text-secondary hover:border-border hover:bg-hover",
                isDragging && "opacity-50",
                isDropTarget && "border-accent/70"
            )}
            title={tab.name}
        >
            <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{tab.name}</span>
            {tab.indicator && (
                <span className="shrink-0 text-xs" style={{ color: tab.indicator.color || "#fbbf24" }}>
                    <i className={makeIconClass(tab.indicator.icon, true, { defaultIcon: "bell" })} />
                </span>
            )}
            {onClose && (
                <button
                    type="button"
                    className="shrink-0 cursor-pointer rounded p-1 text-secondary opacity-0 transition group-hover:opacity-100 hover:bg-hoverbg hover:text-primary"
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
