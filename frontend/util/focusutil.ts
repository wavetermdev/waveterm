// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0s

import * as util from "./util";

export function findBlockId(element: HTMLElement): string | null {
    let current: HTMLElement = element;
    while (current) {
        if (current.hasAttribute("data-blockid")) {
            return current.getAttribute("data-blockid");
        }
        current = current.parentElement;
    }
    return null;
}

export function getElemAsStr(elem: EventTarget) {
    if (elem == null) {
        return "null";
    }
    if (!(elem instanceof HTMLElement)) {
        if (elem instanceof Text) {
            elem = elem.parentElement;
        }
        if (!(elem instanceof HTMLElement)) {
            return "unknown";
        }
    }
    const blockId = findBlockId(elem);
    let rtn = elem.tagName.toLowerCase();
    if (!util.isBlank(elem.id)) {
        rtn += "#" + elem.id;
    }
    if (!util.isBlank(elem.className)) {
        rtn += "." + elem.className;
    }
    if (blockId != null) {
        rtn += ` [${blockId.substring(0, 8)}]`;
    }
    return rtn;
}

export function hasSelection() {
    const sel = document.getSelection();
    return sel && sel.rangeCount > 0 && !sel.isCollapsed;
}

export function focusedBlockId(): string {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement) {
        const blockId = findBlockId(focused);
        if (blockId) {
            return blockId;
        }
    }
    const sel = document.getSelection();
    if (sel && sel.anchorNode && sel.rangeCount > 0 && !sel.isCollapsed) {
        let anchor = sel.anchorNode;
        if (anchor instanceof Text) {
            anchor = anchor.parentElement;
        }
        if (anchor instanceof HTMLElement) {
            const blockId = findBlockId(anchor);
            if (blockId) {
                return blockId;
            }
        }
    }
    return null;
}
