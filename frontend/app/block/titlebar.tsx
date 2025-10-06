// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { IconButton } from "@/app/element/iconbutton";
import { atoms, WOS } from "@/store/global";
import { RpcApi } from "@/store/wshclientapi";
import { TabRpcClient } from "@/store/wshrpcutil";
import { fireAndForget, isBlank, makeIconClass } from "@/util/util";
import clsx from "clsx";
import { useAtomValue } from "jotai";
import { memo, useState } from "react";
import "./titlebar.scss";

interface TitleBarProps {
    blockId: string;
    blockMeta: MetaType;
    title?: string;
    icon?: string;
    color?: string;
    onTitleChange?: (newTitle: string) => void;
}

const TitleBar = memo(({ blockId, blockMeta, title, icon, color, onTitleChange }: TitleBarProps) => {
    const [isEditing, setIsEditing] = useState(false);
    const [localTitle, setLocalTitle] = useState(title || "");
    const fullConfig = useAtomValue(atoms.fullConfigAtom);

    // Check if pane labels are enabled
    const paneLabelSettings = fullConfig?.settings?.["pane-labels"];
    const isEnabled = paneLabelSettings?.enabled ?? false;
    const displayMode = paneLabelSettings?.["display-mode"] ?? "always";
    const showIcons = paneLabelSettings?.["show-icons"] ?? true;
    const maxLength = paneLabelSettings?.["max-length"] ?? 50;

    // Check if this specific pane has labels hidden
    const hideOverride = blockMeta?.["pane-title:hide"];

    const [isHovered, setIsHovered] = useState(false);

    // Don't render if disabled globally or hidden for this pane
    if (!isEnabled || hideOverride) {
        return null;
    }

    // Handle display mode
    if (displayMode === "never") return null;
    if (displayMode === "on-hover" && !isHovered) return null;

    const handleSave = () => {
        setIsEditing(false);
        const trimmedTitle = localTitle.trim();
        if (trimmedTitle !== title) {
            fireAndForget(async () => {
                await RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("block", blockId),
                    meta: { "pane-title": trimmedTitle },
                });
            });
            onTitleChange?.(trimmedTitle);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            e.preventDefault();
            handleSave();
        } else if (e.key === "Escape") {
            e.preventDefault();
            setLocalTitle(title || "");
            setIsEditing(false);
        }
    };

    const displayTitle = localTitle.length > maxLength ? localTitle.slice(0, maxLength) + "..." : localTitle;
    const effectiveIcon = icon || blockMeta?.["pane-title:icon"];
    const effectiveColor = color || blockMeta?.["pane-title:color"];

    return (
        <div
            className={clsx("pane-title-bar", { "is-editing": isEditing, "is-hovered": isHovered })}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            {showIcons && effectiveIcon && !isBlank(effectiveIcon) && (
                <div className="pane-title-icon" style={{ color: effectiveColor }}>
                    <i className={makeIconClass(effectiveIcon, false, { defaultIcon: "square" })} />
                </div>
            )}
            {isEditing ? (
                <input
                    className="pane-title-input"
                    value={localTitle}
                    onChange={(e) => setLocalTitle(e.target.value)}
                    onBlur={handleSave}
                    onKeyDown={handleKeyDown}
                    maxLength={maxLength}
                    autoFocus
                    placeholder="Enter pane title..."
                />
            ) : (
                <span
                    className="pane-title-text"
                    onClick={() => setIsEditing(true)}
                    title={localTitle.length > maxLength ? localTitle : undefined}
                >
                    {displayTitle || "Untitled Pane"}
                </span>
            )}
            {isHovered && !isEditing && (
                <IconButton
                    className="pane-title-edit-btn"
                    decl={{ elemtype: "iconbutton", icon: "pencil" }}
                    onClick={() => setIsEditing(true)}
                />
            )}
        </div>
    );
});

export { TitleBar };
