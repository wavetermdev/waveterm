// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export function findWaveAIPanel(element: HTMLElement): HTMLElement | null {
    let current: HTMLElement = element;
    while (current) {
        if (current.hasAttribute("data-waveai-panel")) {
            return current;
        }
        current = current.parentElement;
    }
    return null;
}

export function waveAIHasFocusWithin(focusTarget?: Element | null): boolean {
    if (focusTarget !== undefined) {
        if (focusTarget instanceof HTMLElement) {
            return findWaveAIPanel(focusTarget) != null;
        }
        return false;
    }

    const focused = document.activeElement;
    if (focused instanceof HTMLElement) {
        const waveAIPanel = findWaveAIPanel(focused);
        if (waveAIPanel) return true;
    }

    const sel = document.getSelection();
    if (sel && sel.anchorNode && sel.rangeCount > 0 && !sel.isCollapsed) {
        let anchor = sel.anchorNode;
        if (anchor instanceof Text) {
            anchor = anchor.parentElement;
        }
        if (anchor instanceof HTMLElement) {
            const waveAIPanel = findWaveAIPanel(anchor);
            if (waveAIPanel) return true;
        }
    }

    return false;
}

export function waveAIHasSelection(): boolean {
    const sel = document.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        return false;
    }

    let anchor = sel.anchorNode;
    if (anchor instanceof Text) {
        anchor = anchor.parentElement;
    }
    if (anchor instanceof HTMLElement) {
        return findWaveAIPanel(anchor) != null;
    }

    return false;
}