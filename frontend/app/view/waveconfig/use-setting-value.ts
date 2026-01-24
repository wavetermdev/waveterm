// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Hook for managing individual setting values with optimistic updates.
 */

import { useAtom, useAtomValue } from "jotai";
import { useCallback, useMemo } from "react";
import {
    allSettingsAtom,
    getSettingAtom,
    getSettingHasPendingAtom,
    isSavingAtom,
    saveErrorAtom,
} from "@/app/store/settings-atoms";
import { settingsService } from "@/app/store/settings-service";
import { getDefaultValue, getSettingMetadata } from "@/app/store/settings-registry";

interface UseSettingValueResult<T> {
    /** Current value of the setting (includes pending changes) */
    value: T | undefined;
    /** Set the setting value (triggers debounced save) */
    setValue: (value: T) => void;
    /** Whether this setting has been modified from its default */
    isModified: boolean;
    /** Whether a save is currently in progress */
    isSaving: boolean;
    /** Current error message, if any */
    error: string | null;
    /** Reset the setting to its default value */
    reset: () => void;
    /** Whether there are pending changes for this setting */
    hasPendingChanges: boolean;
    /** The default value for this setting */
    defaultValue: T | undefined;
    /** The setting metadata */
    metadata: SettingMetadata | undefined;
}

/**
 * Hook for reading and writing a single setting value.
 *
 * Provides:
 * - Current value (with optimistic updates)
 * - setValue function (triggers debounced save)
 * - isModified state (compared to default)
 * - isSaving state
 * - error state
 * - reset function
 *
 * @example
 * ```tsx
 * const { value, setValue, isModified, reset } = useSettingValue<number>("term:fontsize");
 *
 * return (
 *   <Slider
 *     value={value ?? 12}
 *     onChange={setValue}
 *     showReset={isModified}
 *     onReset={reset}
 *   />
 * );
 * ```
 */
export function useSettingValue<T>(key: string): UseSettingValueResult<T> {
    // Get the per-setting atom for efficient updates
    const settingAtom = useMemo(() => getSettingAtom(key), [key]);
    const hasPendingAtom = useMemo(() => getSettingHasPendingAtom(key), [key]);

    const [value, setAtomValue] = useAtom(settingAtom);
    const hasPendingChanges = useAtomValue(hasPendingAtom);
    const isSaving = useAtomValue(isSavingAtom);
    const error = useAtomValue(saveErrorAtom);

    // Get metadata and default value
    const metadata = useMemo(() => getSettingMetadata(key), [key]);
    const defaultValue = useMemo(() => getDefaultValue(key) as T | undefined, [key]);

    // Check if modified from default
    const isModified = useMemo(() => {
        return settingsService.isModified(key);
    }, [key, value]);

    // Set value with debounced save
    const setValue = useCallback(
        (newValue: T) => {
            // Update the atom (optimistic update)
            setAtomValue(newValue);
            // Trigger debounced save via service
            settingsService.setSetting(key, newValue);
        },
        [key, setAtomValue]
    );

    // Reset to default value
    const reset = useCallback(() => {
        if (defaultValue !== undefined) {
            setValue(defaultValue);
        } else {
            // For settings without explicit defaults, set to empty/null
            settingsService.resetSetting(key);
        }
    }, [key, defaultValue, setValue]);

    return {
        value: value as T | undefined,
        setValue,
        isModified,
        isSaving,
        error,
        reset,
        hasPendingChanges,
        defaultValue,
        metadata,
    };
}

/**
 * Hook for watching all settings at once.
 * Useful for components that need to react to any settings change.
 */
export function useAllSettings(): Record<string, unknown> {
    return useAtomValue(allSettingsAtom);
}

/**
 * Hook for getting the save error state.
 */
export function useSaveError(): string | null {
    return useAtomValue(saveErrorAtom);
}

/**
 * Hook for getting the saving state.
 */
export function useIsSaving(): boolean {
    return useAtomValue(isSavingAtom);
}
