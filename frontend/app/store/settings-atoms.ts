// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Settings Atoms
 *
 * Jotai atoms for settings state management.
 */

import { atom } from "jotai";

/**
 * Settings that have been saved to disk.
 */
export const savedSettingsAtom = atom<Record<string, unknown>>({});

/**
 * Pending settings changes that haven't been saved yet.
 */
export const pendingSettingsAtom = atom<Record<string, unknown>>({});

/**
 * Combined view of settings (pending overrides saved).
 */
export const allSettingsAtom = atom((get) => {
    const saved = get(savedSettingsAtom);
    const pending = get(pendingSettingsAtom);
    return { ...saved, ...pending };
});

/**
 * Whether there are unsaved changes.
 */
export const hasUnsavedChangesAtom = atom((get) => {
    const pending = get(pendingSettingsAtom);
    return Object.keys(pending).length > 0;
});

/**
 * Current save error, if any.
 */
export const saveErrorAtom = atom<string | null>(null);

/**
 * Search query for filtering settings.
 */
export const settingsSearchQueryAtom = atom<string>("");

/**
 * Currently selected category in the settings view.
 */
export const selectedCategoryAtom = atom<string | null>(null);

/**
 * Currently selected subcategory in the settings view.
 */
export const selectedSubcategoryAtom = atom<string | null>(null);

/**
 * Combined selection state for category navigation.
 */
export const selectedSectionAtom = atom(
    (get) => ({
        category: get(selectedCategoryAtom),
        subcategory: get(selectedSubcategoryAtom),
    }),
    (get, set, value: { category: string | null; subcategory: string | null }) => {
        set(selectedCategoryAtom, value.category);
        set(selectedSubcategoryAtom, value.subcategory);
    }
);

/**
 * Whether a save is currently in progress.
 */
export const isSavingAtom = atom<boolean>(false);

/**
 * Create atoms for individual settings.
 * Uses a Map-based cache for efficient per-setting atoms.
 */
const settingAtomCache = new Map<string, ReturnType<typeof createSettingAtom>>();

function createSettingAtom(key: string) {
    return atom(
        (get) => {
            const allSettings = get(allSettingsAtom);
            return allSettings[key];
        },
        (get, set, newValue: unknown) => {
            const pending = get(pendingSettingsAtom);
            set(pendingSettingsAtom, { ...pending, [key]: newValue });
        }
    );
}

/**
 * Get or create an atom for a specific setting key.
 * This provides efficient per-setting reactivity.
 */
export function getSettingAtom(key: string) {
    if (!settingAtomCache.has(key)) {
        settingAtomCache.set(key, createSettingAtom(key));
    }
    return settingAtomCache.get(key)!;
}

/**
 * Atom for checking if a specific setting has pending changes.
 */
const settingHasPendingCache = new Map<string, ReturnType<typeof createHasPendingAtom>>();

function createHasPendingAtom(key: string) {
    return atom((get) => {
        const pending = get(pendingSettingsAtom);
        return key in pending;
    });
}

/**
 * Get or create an atom to check if a setting has pending changes.
 */
export function getSettingHasPendingAtom(key: string) {
    if (!settingHasPendingCache.has(key)) {
        settingHasPendingCache.set(key, createHasPendingAtom(key));
    }
    return settingHasPendingCache.get(key)!;
}
