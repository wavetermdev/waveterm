// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Settings Options Provider
 *
 * This module provides interfaces and implementations for dynamically loading
 * options for select controls that depend on runtime data (terminal themes,
 * AI modes, font families, etc.).
 */

import { atoms } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";

/**
 * Represents a single option in a select control.
 */
export interface SelectOption {
    value: string;
    label: string;
    description?: string;
}

/**
 * Interface for providers that supply options for select controls.
 */
export interface OptionsProvider {
    /**
     * Fetches the available options.
     * @returns A promise that resolves to an array of SelectOption objects.
     */
    getOptions(): Promise<SelectOption[]>;

    /**
     * Optional method to subscribe to changes in the options.
     * @param callback Function to call when options change.
     * @returns A cleanup function to unsubscribe.
     */
    subscribeToChanges?(callback: () => void): () => void;
}

/**
 * Provider for terminal themes.
 * Fetches themes from the fullConfig and returns them as SelectOption objects.
 */
class TermThemesProvider implements OptionsProvider {
    async getOptions(): Promise<SelectOption[]> {
        try {
            // First try to get from the atom (cached config)
            let fullConfig = globalStore.get(atoms.fullConfigAtom);

            // If not available, fetch from RPC
            if (!fullConfig) {
                fullConfig = await RpcApi.GetFullConfigCommand(TabRpcClient);
            }

            const themes = fullConfig?.termthemes || {};
            return Object.entries(themes)
                .map(([key, theme]: [string, TermThemeType]) => ({
                    value: key,
                    label: theme?.["display:name"] || key,
                }))
                .sort((a, b) => a.label.localeCompare(b.label));
        } catch (error) {
            console.error("Failed to load term themes:", error);
            return [];
        }
    }
}

/**
 * Provider for AI modes.
 * Fetches AI mode configurations and returns them as SelectOption objects.
 */
class AIModeProvider implements OptionsProvider {
    async getOptions(): Promise<SelectOption[]> {
        try {
            // First try to get from the atom (cached config)
            let fullConfig = globalStore.get(atoms.fullConfigAtom);

            // If not available, fetch from RPC
            if (!fullConfig) {
                fullConfig = await RpcApi.GetFullConfigCommand(TabRpcClient);
            }

            const modes = fullConfig?.waveai || {};
            return Object.entries(modes)
                .map(([key, mode]: [string, AIModeConfigType]) => ({
                    value: key,
                    label: mode?.["display:name"] || key,
                    description: mode?.["display:description"],
                }))
                .sort((a, b) => {
                    // Sort by display:order if available, otherwise by label
                    const orderA = (a as any).order ?? Number.MAX_SAFE_INTEGER;
                    const orderB = (b as any).order ?? Number.MAX_SAFE_INTEGER;
                    if (orderA !== orderB) {
                        return orderA - orderB;
                    }
                    return a.label.localeCompare(b.label);
                });
        } catch (error) {
            console.error("Failed to load AI modes:", error);
            return [];
        }
    }
}

/**
 * Provider for static options that don't change at runtime.
 */
class StaticOptionsProvider implements OptionsProvider {
    constructor(private options: SelectOption[]) {}

    async getOptions(): Promise<SelectOption[]> {
        return this.options;
    }
}

// Default block type options
const defaultBlockOptions: SelectOption[] = [
    { value: "term", label: "Terminal" },
    { value: "preview", label: "Preview" },
    { value: "web", label: "Web Browser" },
    { value: "waveai", label: "Wave AI" },
];

// Auto-update channel options
const autoUpdateChannelOptions: SelectOption[] = [
    { value: "stable", label: "Stable" },
    { value: "beta", label: "Beta" },
    { value: "nightly", label: "Nightly" },
];

// API type options
const apiTypeOptions: SelectOption[] = [
    { value: "openai", label: "OpenAI" },
    { value: "anthropic", label: "Anthropic" },
    { value: "azure", label: "Azure OpenAI" },
    { value: "google-gemini", label: "Google Gemini" },
    { value: "openai-responses", label: "OpenAI Responses" },
    { value: "openai-chat", label: "OpenAI Chat" },
];

// Export provider instances
export const termThemesProvider = new TermThemesProvider();
export const aiModeProvider = new AIModeProvider();
export const defaultBlockProvider = new StaticOptionsProvider(defaultBlockOptions);
export const autoUpdateChannelProvider = new StaticOptionsProvider(autoUpdateChannelOptions);
export const apiTypeProvider = new StaticOptionsProvider(apiTypeOptions);

// Re-export the static options for convenience
export { defaultBlockOptions, autoUpdateChannelOptions, apiTypeOptions };
