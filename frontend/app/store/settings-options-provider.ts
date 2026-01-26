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

/**
 * Provider for Oh-My-Posh themes.
 * Provides a static list of official OMP themes with color previews.
 * Future: Fetch from GitHub API or local installation.
 */
class OmpThemesProvider implements OptionsProvider {
    private static OFFICIAL_THEMES = [
        "1_shell", "M365Princess", "agnoster", "agnoster.minimal", "agnosterplus",
        "aliens", "amro", "atomic", "atomicBit", "avit", "blue-owl", "blueish",
        "bubbles", "bubblesextra", "bubblesline", "capr4n", "catppuccin",
        "catppuccin_frappe", "catppuccin_latte", "catppuccin_macchiato",
        "catppuccin_mocha", "cert", "chips", "cinnamon", "clean-detailed",
        "cloud-context", "cloud-native-azure", "cobalt2", "craver", "darkblood",
        "devious-diamonds", "di4am0nd", "dracula", "easy-term", "emodipt",
        "emodipt-extend", "fish", "free-ukraine", "froczh", "glowsticks", "gmay",
        "grandpa-style", "gruvbox", "half-life", "honukai", "hotstick.minimal",
        "hul10", "hunk", "huvix", "if_tea", "illusi0n", "iterm2", "jandedobbeleer",
        "jblab_2021", "jonnychipz", "json", "jtracey93", "jv_sitecorian", "kali",
        "kushal", "lambda", "lambdageneration", "larserikfinholt", "lightgreen",
        "marcduiker", "markbull", "material", "microverse-power", "mojada",
        "montys", "mt", "multiverse-neon", "negligible", "neko", "night-owl",
        "nordtron", "nu4a", "onehalf.minimal", "paradox", "pararussel",
        "patriksvensson", "peru", "pixelrobots", "plague", "poshmon",
        "powerlevel10k_classic", "powerlevel10k_lean", "powerlevel10k_modern",
        "powerlevel10k_rainbow", "powerline", "probua.minimal", "pure",
        "quick-term", "remk", "robbyrussell", "rudolfs-dark", "rudolfs-light",
        "sim-web", "slim", "slimfat", "smoothie", "sonicboom_dark",
        "sonicboom_light", "sorin", "space", "spaceship", "star", "stelbent",
        "stelbent-compact.minimal", "takuya", "the-unnamed", "thecyberden",
        "tiwahu", "tokyo", "tokyonight_storm", "tonybaloney", "uew", "unicorn",
        "velvet", "wholespace", "wopian", "xtoys", "ys", "zash"
    ];

    // Color palettes for known themes
    private static THEME_COLORS: Record<string, string[]> = {
        dracula: ["#282a36", "#ff5555", "#50fa7b", "#f1fa8c", "#bd93f9", "#ff79c6", "#8be9fd", "#f8f8f2"],
        catppuccin: ["#1e1e2e", "#f38ba8", "#a6e3a1", "#f9e2af", "#89b4fa", "#cba6f7", "#94e2d5", "#cdd6f4"],
        catppuccin_frappe: ["#303446", "#e78284", "#a6d189", "#e5c890", "#8caaee", "#ca9ee6", "#81c8be", "#c6d0f5"],
        catppuccin_latte: ["#eff1f5", "#d20f39", "#40a02b", "#df8e1d", "#1e66f5", "#8839ef", "#179299", "#4c4f69"],
        catppuccin_macchiato: ["#24273a", "#ed8796", "#a6da95", "#eed49f", "#8aadf4", "#c6a0f6", "#8bd5ca", "#cad3f5"],
        catppuccin_mocha: ["#1e1e2e", "#f38ba8", "#a6e3a1", "#f9e2af", "#89b4fa", "#cba6f7", "#94e2d5", "#cdd6f4"],
        gruvbox: ["#282828", "#cc241d", "#98971a", "#d79921", "#458588", "#b16286", "#689d6a", "#a89984"],
        nordtron: ["#2e3440", "#bf616a", "#a3be8c", "#ebcb8b", "#81a1c1", "#b48ead", "#88c0d0", "#e5e9f0"],
        "night-owl": ["#011627", "#ef5350", "#22da6e", "#addb67", "#82aaff", "#c792ea", "#21c7a8", "#d6deeb"],
        tokyo: ["#1a1b26", "#f7768e", "#9ece6a", "#e0af68", "#7aa2f7", "#bb9af7", "#7dcfff", "#c0caf5"],
        tokyonight_storm: ["#24283b", "#f7768e", "#9ece6a", "#e0af68", "#7aa2f7", "#bb9af7", "#7dcfff", "#c0caf5"],
        material: ["#263238", "#ff5370", "#c3e88d", "#ffcb6b", "#82aaff", "#c792ea", "#89ddff", "#eeffff"],
        cobalt2: ["#193549", "#ff628c", "#3ad900", "#ffc600", "#0088ff", "#ff9d00", "#80fcff", "#ffffff"],
        agnoster: ["#000000", "#e74856", "#16c60c", "#f9f1a5", "#3b78ff", "#b4009e", "#61d6d6", "#cccccc"],
        powerline: ["#1c1c1c", "#d75f5f", "#87af5f", "#d7af5f", "#5f87af", "#af5faf", "#5fafaf", "#bcbcbc"],
        pure: ["#1e1e1e", "#f43753", "#c9d05c", "#ffc24b", "#b3deef", "#d3b987", "#73cef4", "#eeeeee"],
        spaceship: ["#1b182c", "#ff5555", "#50fa7b", "#f4f99d", "#bd93f9", "#ff79c6", "#9aedfe", "#bfbfbf"],
        sonicboom_dark: ["#21252b", "#f92672", "#a6e22e", "#f4bf75", "#66d9ef", "#ae81ff", "#56b6c2", "#abb2bf"],
        sonicboom_light: ["#fafafa", "#d73a49", "#22863a", "#b08800", "#0366d6", "#6f42c1", "#0598bc", "#24292e"],
        "rudolfs-light": ["#ffffff", "#d73a49", "#22863a", "#b08800", "#0366d6", "#6f42c1", "#0598bc", "#24292e"],
        "rudolfs-dark": ["#21252b", "#f44747", "#98c379", "#d19a66", "#61afef", "#c678dd", "#56b6c2", "#abb2bf"],
    };

    // Default colors for unknown themes
    private static DEFAULT_COLORS = ["#1c1c1c", "#e74856", "#16c60c", "#f9f1a5", "#3b78ff", "#b4009e", "#61d6d6", "#cccccc"];

    async getOptions(): Promise<SelectOption[]> {
        return OmpThemesProvider.OFFICIAL_THEMES.map(name => ({
            value: name,
            label: this.formatThemeName(name),
        })).sort((a, b) => a.label.localeCompare(b.label));
    }

    async getThemes(): Promise<Array<{name: string, displayName: string, colors: string[]}>> {
        return OmpThemesProvider.OFFICIAL_THEMES.map(name => ({
            name,
            displayName: this.formatThemeName(name),
            colors: this.getThemeColors(name),
        })).sort((a, b) => a.displayName.localeCompare(b.displayName));
    }

    private formatThemeName(name: string): string {
        return name
            .replace(/[-_]/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase())
            .replace(/\.minimal/i, ' (Minimal)')
            .replace(/Omp\.json$/i, '');
    }

    private getThemeColors(themeName: string): string[] {
        // Check for exact match
        if (OmpThemesProvider.THEME_COLORS[themeName]) {
            return OmpThemesProvider.THEME_COLORS[themeName];
        }
        // Check for partial match (e.g., "catppuccin" matches "catppuccin_mocha")
        for (const [key, colors] of Object.entries(OmpThemesProvider.THEME_COLORS)) {
            if (themeName.includes(key) || key.includes(themeName)) {
                return colors;
            }
        }
        return OmpThemesProvider.DEFAULT_COLORS;
    }
}

// Export provider instances
export const termThemesProvider = new TermThemesProvider();
export const aiModeProvider = new AIModeProvider();
export const ompThemesProvider = new OmpThemesProvider();
export const defaultBlockProvider = new StaticOptionsProvider(defaultBlockOptions);
export const autoUpdateChannelProvider = new StaticOptionsProvider(autoUpdateChannelOptions);
export const apiTypeProvider = new StaticOptionsProvider(apiTypeOptions);

// Re-export the static options for convenience
export { defaultBlockOptions, autoUpdateChannelOptions, apiTypeOptions };
