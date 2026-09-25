// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getTabMetaKeyAtom, globalStore } from "@/app/store/global";

// Amber padlock tint shown on locked tabs.
export const TabLockedColor = "#FFB400";

/**
 * Returns whether a tab is currently locked (close-protected).
 *
 * Reads the `tab:locked` meta synchronously from the global store so it can be
 * called from non-reactive close handlers (button, context menu, keybinding)
 * to short-circuit a close before it reaches the backend.
 */
export function isTabLocked(tabId: string): boolean {
    if (!tabId) {
        return false;
    }
    return !!globalStore.get(getTabMetaKeyAtom(tabId, "tab:locked"));
}
