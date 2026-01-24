// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Settings Options Hook
 *
 * A React hook for loading dynamic options for select controls.
 * Handles async loading, caching, and change subscriptions.
 */

import { useEffect, useState } from "react";
import type { SelectOption } from "@/app/store/settings-options-provider";
import { getOptionsProvider } from "@/app/store/options-registry";

/**
 * Return type for the useSettingOptions hook.
 */
interface UseSettingOptionsResult {
    /** The loaded options */
    options: SelectOption[];
    /** Whether options are currently loading */
    loading: boolean;
    /** Error message if loading failed */
    error: string | null;
    /** Function to manually refresh options */
    refresh: () => void;
}

/**
 * Hook for loading dynamic options for a setting.
 *
 * This hook handles:
 * - Async loading of options from the provider
 * - Loading and error states
 * - Subscriptions to option changes (if supported by provider)
 * - Manual refresh capability
 *
 * @param settingKey The setting key to load options for.
 * @returns An object containing options, loading state, error state, and refresh function.
 *
 * @example
 * ```tsx
 * function ThemeSelector() {
 *   const { options, loading, error } = useSettingOptions("term:theme");
 *
 *   if (loading) return <Spinner />;
 *   if (error) return <ErrorMessage message={error} />;
 *
 *   return (
 *     <Select options={options} />
 *   );
 * }
 * ```
 */
export function useSettingOptions(settingKey: string): UseSettingOptionsResult {
    const [options, setOptions] = useState<SelectOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [refreshTrigger, setRefreshTrigger] = useState(0);

    useEffect(() => {
        const provider = getOptionsProvider(settingKey);

        if (!provider) {
            // No provider registered for this setting
            setLoading(false);
            setOptions([]);
            return;
        }

        let mounted = true;

        const loadOptions = async () => {
            try {
                setLoading(true);
                setError(null);
                const opts = await provider.getOptions();
                if (mounted) {
                    setOptions(opts);
                    setLoading(false);
                }
            } catch (err) {
                if (mounted) {
                    const message = err instanceof Error ? err.message : "Failed to load options";
                    setError(message);
                    setLoading(false);
                    setOptions([]);
                }
            }
        };

        loadOptions();

        // Subscribe to changes if provider supports it
        const unsubscribe = provider.subscribeToChanges?.(() => {
            loadOptions();
        });

        return () => {
            mounted = false;
            unsubscribe?.();
        };
    }, [settingKey, refreshTrigger]);

    const refresh = () => {
        setRefreshTrigger((prev) => prev + 1);
    };

    return { options, loading, error, refresh };
}

/**
 * Hook for checking if a setting has dynamic options.
 *
 * @param settingKey The setting key to check.
 * @returns True if the setting has a registered options provider.
 */
export function useHasDynamicOptions(settingKey: string): boolean {
    const provider = getOptionsProvider(settingKey);
    return provider !== null;
}
