// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getTabMetaKeyAtom, globalStore } from "@/app/store/global";

// Amber padlock tint shown on locked tabs.
export const TabLockedColor = "#FFB400";

export function isTabLocked(tabId: string): boolean {
    if (!tabId) {
        return false;
    }
    return !!globalStore.get(getTabMetaKeyAtom(tabId, "tab:locked"));
}
