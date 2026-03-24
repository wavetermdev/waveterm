// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export function findBuilderAppPanel(element: HTMLElement): HTMLElement | null {
    let current: HTMLElement = element;
    while (current) {
        if (current.hasAttribute("data-builder-app-panel")) {
            return current;
        }
        current = current.parentElement;
    }
    return null;
}

export function builderAppHasFocusWithin(focusTarget?: Element | null): boolean {
    if (focusTarget !== undefined) {
        if (focusTarget instanceof HTMLElement) {
            return findBuilderAppPanel(focusTarget) != null;
        }
        return false;
    }

    const focused = document.activeElement;
    if (focused instanceof HTMLElement) {
        const appPanel = findBuilderAppPanel(focused);
        if (appPanel) return true;
    }

    const sel = document.getSelection();
    if (sel && sel.anchorNode && sel.rangeCount > 0 && !sel.isCollapsed) {
        let anchor = sel.anchorNode;
        if (anchor instanceof Text) {
            anchor = anchor.parentElement;
        }
        if (anchor instanceof HTMLElement) {
            const appPanel = findBuilderAppPanel(anchor);
            if (appPanel) return true;
        }
    }

    return false;
}

export function builderAppHasSelection(): boolean {
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        return false;
    }

    let anchor = sel.anchorNode;
    if (anchor instanceof Text) {
        anchor = anchor.parentElement;
    }
    if (anchor instanceof HTMLElement) {
        return findBuilderAppPanel(anchor) != null;
    }

    return false;
}