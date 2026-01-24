// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Options Registry
 *
 * This module provides a registry that maps setting keys to their options providers.
 * It enables dynamic loading of options for select controls based on runtime data.
 */

import type { OptionsProvider } from "./settings-options-provider";
import {
    termThemesProvider,
    aiModeProvider,
    defaultBlockProvider,
    autoUpdateChannelProvider,
    apiTypeProvider,
} from "./settings-options-provider";

/**
 * Map of setting keys to their options providers.
 * Add new entries here when settings need dynamic options.
 */
const optionsProviderMap: Map<string, OptionsProvider> = new Map([
    // Terminal settings
    ["term:theme", termThemesProvider],

    // AI settings
    ["waveai:defaultmode", aiModeProvider],
    ["ai:preset", aiModeProvider],
    ["ai:apitype", apiTypeProvider],

    // App settings
    ["app:defaultnewblock", defaultBlockProvider],

    // Auto-update settings
    ["autoupdate:channel", autoUpdateChannelProvider],
]);

/**
 * Get the options provider for a specific setting key.
 *
 * @param settingKey The setting key to look up.
 * @returns The OptionsProvider for the setting, or null if none is registered.
 */
export function getOptionsProvider(settingKey: string): OptionsProvider | null {
    return optionsProviderMap.get(settingKey) || null;
}

/**
 * Check if a setting has dynamic options.
 *
 * @param settingKey The setting key to check.
 * @returns True if the setting has a registered options provider.
 */
export function hasDynamicOptions(settingKey: string): boolean {
    return optionsProviderMap.has(settingKey);
}

/**
 * Register a new options provider for a setting key.
 * This allows extending the registry at runtime if needed.
 *
 * @param settingKey The setting key to register.
 * @param provider The options provider to use.
 */
export function registerOptionsProvider(settingKey: string, provider: OptionsProvider): void {
    optionsProviderMap.set(settingKey, provider);
}

/**
 * Unregister an options provider for a setting key.
 *
 * @param settingKey The setting key to unregister.
 * @returns True if the provider was removed, false if it wasn't registered.
 */
export function unregisterOptionsProvider(settingKey: string): boolean {
    return optionsProviderMap.delete(settingKey);
}

/**
 * Get all setting keys that have dynamic options.
 *
 * @returns An array of setting keys with registered options providers.
 */
export function getDynamicOptionKeys(): string[] {
    return Array.from(optionsProviderMap.keys());
}
