// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useLongClick } from "@/app/hook/useLongClick";
import * as util from "@/util/util";
import clsx from "clsx";
import * as React from "react";

export const colorRegex = /^((#[0-9a-f]{6,8})|([a-z]+))$/;

export function blockViewToIcon(view: string): string {
    if (view == "term") {
        return "terminal";
    }
    if (view == "preview") {
        return "file";
    }
    if (view == "web") {
        return "globe";
    }
    if (view == "waveai") {
        return "sparkles";
    }
    if (view == "help") {
        return "circle-question";
    }
    return "square";
}

export function blockViewToName(view: string): string {
    if (util.isBlank(view)) {
        return "(No View)";
    }
    if (view == "term") {
        return "Terminal";
    }
    if (view == "preview") {
        return "Preview";
    }
    if (view == "web") {
        return "Web";
    }
    if (view == "waveai") {
        return "WaveAI";
    }
    if (view == "help") {
        return "Help";
    }
    return view;
}

export function processTitleString(titleString: string): React.ReactNode[] {
    if (titleString == null) {
        return null;
    }
    const tagRegex = /<(\/)?([a-z]+)(?::([#a-z0-9@-]+))?>/g;
    let lastIdx = 0;
    let match;
    let partsStack = [[]];
    while ((match = tagRegex.exec(titleString)) != null) {
        const lastPart = partsStack[partsStack.length - 1];
        const before = titleString.substring(lastIdx, match.index);
        lastPart.push(before);
        lastIdx = match.index + match[0].length;
        const [_, isClosing, tagName, tagParam] = match;
        if (tagName == "icon" && !isClosing) {
            if (tagParam == null) {
                continue;
            }
            const iconClass = util.makeIconClass(tagParam, false);
            if (iconClass == null) {
                continue;
            }
            lastPart.push(<i key={match.index} className={iconClass} />);
            continue;
        }
        if (tagName == "c" || tagName == "color") {
            if (isClosing) {
                if (partsStack.length <= 1) {
                    continue;
                }
                partsStack.pop();
                continue;
            }
            if (tagParam == null) {
                continue;
            }
            if (!tagParam.match(colorRegex)) {
                continue;
            }
            let children = [];
            const rtag = React.createElement("span", { key: match.index, style: { color: tagParam } }, children);
            lastPart.push(rtag);
            partsStack.push(children);
            continue;
        }
        if (tagName == "i" || tagName == "b") {
            if (isClosing) {
                if (partsStack.length <= 1) {
                    continue;
                }
                partsStack.pop();
                continue;
            }
            let children = [];
            const rtag = React.createElement(tagName, { key: match.index }, children);
            lastPart.push(rtag);
            partsStack.push(children);
            continue;
        }
    }
    partsStack[partsStack.length - 1].push(titleString.substring(lastIdx));
    return partsStack[0];
}

export function getBlockHeaderIcon(blockIcon: string, blockData: Block): React.ReactNode {
    let blockIconElem: React.ReactNode = null;
    if (util.isBlank(blockIcon)) {
        blockIcon = "square";
    }
    let iconColor = blockData?.meta?.["icon:color"];
    if (iconColor && !iconColor.match(colorRegex)) {
        iconColor = null;
    }
    let iconStyle = null;
    if (!util.isBlank(iconColor)) {
        iconStyle = { color: iconColor };
    }
    const iconClass = util.makeIconClass(blockIcon, true);
    if (iconClass != null) {
        blockIconElem = <i key="icon" style={iconStyle} className={clsx(`block-frame-icon`, iconClass)} />;
    }
    return blockIconElem;
}

export function getBlockHeaderText(blockIcon: string, blockData: Block, settings: SettingsConfigType): React.ReactNode {
    if (!blockData) {
        return "no block data";
    }
    let blockIdStr = "";
    if (settings?.blockheader?.showblockids) {
        blockIdStr = ` [${blockData.oid.substring(0, 8)}]`;
    }
    let blockIconElem = getBlockHeaderIcon(blockIcon, blockData);
    if (!util.isBlank(blockData?.meta?.title)) {
        try {
            const rtn = processTitleString(blockData.meta.title) ?? [];
            return [blockIconElem, ...rtn, blockIdStr == "" ? null : blockIdStr];
        } catch (e) {
            console.error("error processing title", blockData.meta.title, e);
            return [blockIconElem, blockData.meta.title + blockIdStr];
        }
    }
    let viewString = blockData?.meta?.view;
    if (blockData?.meta?.controller == "cmd") {
        viewString = "cmd";
    }
    return [blockIconElem, viewString + blockIdStr];
}

export const IconButton = React.memo(({ decl, className }: { decl: HeaderIconButton; className?: string }) => {
    const buttonRef = React.useRef<HTMLDivElement>(null);
    useLongClick(buttonRef, decl.click, decl.longClick);
    return (
        <div ref={buttonRef} className={clsx("iconbutton", className)} title={decl.title}>
            {typeof decl.icon === "string" ? <i className={util.makeIconClass(decl.icon, true)} /> : decl.icon}
        </div>
    );
});

export const Input = React.memo(({ decl, className }: { decl: HeaderInput; className: string }) => {
    const { value, ref, isDisabled, onChange, onKeyDown, onFocus, onBlur } = decl;
    return (
        <div className="input-wrapper">
            <input
                ref={ref}
                disabled={isDisabled}
                className={className}
                value={value}
                onChange={(e) => onChange(e)}
                onKeyDown={(e) => onKeyDown(e)}
                onFocus={(e) => onFocus(e)}
                onBlur={(e) => onBlur(e)}
            />
        </div>
    );
});
