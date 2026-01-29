// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { fireAndForget } from "@/util/util";
import { globalStore } from "./jotaiStore";
import { activeTabIdAtom, getTabModelByTabId } from "./tab-model";
import { validateTabBasedir } from "./tab-basedir-validator";
import * as WOS from "./wos";

const DEBOUNCE_INTERVAL_MS = 500; // Minimum time between validations

// Validate tab basedir when tab is activated
async function validateActiveTabBasedir(tabId: string): Promise<void> {
    if (!tabId) return;

    const tabModel = getTabModelByTabId(tabId);
    const lastValidationTime = globalStore.get(tabModel.lastValidationTimeAtom);
    const now = Date.now();

    // Debounce: skip if validated recently
    if (now - lastValidationTime < DEBOUNCE_INTERVAL_MS) {
        return;
    }

    // Get tab data
    const tabAtom = WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId));
    const tabData = globalStore.get(tabAtom);

    if (!tabData) {
        return;
    }

    const basedir = tabData.meta?.["tab:basedir"];

    // Skip validation if no basedir set
    if (!basedir || basedir.trim() === "") {
        return;
    }

    // Update validation state to pending
    globalStore.set(tabModel.basedirValidationAtom, "pending");
    globalStore.set(tabModel.lastValidationTimeAtom, now);

    // Perform validation
    const result = await validateTabBasedir(tabId, basedir);

    if (result.valid) {
        // Update validation state to valid
        globalStore.set(tabModel.basedirValidationAtom, "valid");
    } else {
        // Update validation state to invalid
        globalStore.set(tabModel.basedirValidationAtom, "invalid");

        // Handle stale basedir (will clear and notify)
        if (result.reason) {
            const { handleStaleBasedir } = await import("./tab-basedir-validator");
            await handleStaleBasedir(tabId, basedir, result.reason);
        }
    }
}

// Initialize tab validation hook
export function initTabBasedirValidation(): void {
    // Subscribe to activeTabIdAtom changes
    globalStore.sub(activeTabIdAtom, () => {
        const activeTabId = globalStore.get(activeTabIdAtom);
        if (activeTabId) {
            fireAndForget(() => validateActiveTabBasedir(activeTabId));
        }
    });

    // Also validate the initial active tab
    const initialActiveTabId = globalStore.get(activeTabIdAtom);
    if (initialActiveTabId) {
        fireAndForget(() => validateActiveTabBasedir(initialActiveTabId));
    }
}
