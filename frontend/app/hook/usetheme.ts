// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getApi, getSettingsKeyAtom, globalStore } from "@/store/global";
import { atom, useAtomValue } from "jotai";
import { useEffect } from "react";

// All available theme options
type ThemeSetting = "dark" | "light" | "light-gray" | "light-warm" | "system";
// Simplified theme category for terminal theme auto-switching
type ResolvedTheme = "dark" | "light";
// Electron native theme source
type NativeThemeSource = "dark" | "light" | "system";

/**
 * Returns true if the theme setting is a light variant
 */
function isLightTheme(theme: string): boolean {
    return theme === "light" || theme === "light-gray" || theme === "light-warm";
}

/**
 * Atom that resolves the effective app theme category (dark/light).
 * Light variants (light, light-gray, light-warm) all resolve to "light".
 * This is used for terminal theme auto-switching.
 *
 * Note: This doesn't auto-update when system preference changes at runtime.
 * For that, use the useTheme hook which sets up listeners.
 */
export const resolvedAppThemeAtom = atom<ResolvedTheme>((get) => {
    const setting = (get(getSettingsKeyAtom("app:theme")) || "dark") as ThemeSetting;
    if (setting === "system") {
        return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return isLightTheme(setting) ? "light" : "dark";
});

/**
 * Returns the CSS theme to apply based on setting and system preference.
 * For "system" setting, uses prefers-color-scheme media query.
 */
function resolveCssTheme(themeSetting: ThemeSetting, systemPrefersDark: boolean): string {
    if (themeSetting === "system") {
        return systemPrefersDark ? "dark" : "light";
    }
    return themeSetting;
}

/**
 * Returns the native theme source for Electron (for embedded webviews).
 */
function getNativeThemeSource(themeSetting: ThemeSetting): NativeThemeSource {
    if (themeSetting === "system") {
        return "system";
    }
    return isLightTheme(themeSetting) ? "light" : "dark";
}

/**
 * Applies the theme to the document root element.
 * Sets data-theme attribute to the theme name.
 */
function applyTheme(theme: string): void {
    document.documentElement.setAttribute("data-theme", theme);
}

/**
 * Hook that manages the application theme.
 * Reads the app:theme setting and applies the correct data-theme attribute.
 * Handles "system" mode by detecting system preference via prefers-color-scheme.
 * Re-applies theme when setting changes or system preference changes.
 *
 * This hook should be called from the main App component.
 */
export function useTheme(): void {
    const themeSettingAtom = getSettingsKeyAtom("app:theme");
    const themeSetting = (useAtomValue(themeSettingAtom) ?? "dark") as ThemeSetting;

    useEffect(() => {
        // Get the system preference media query
        const darkModeQuery = window.matchMedia("(prefers-color-scheme: dark)");

        // Function to apply theme based on current settings and system preference
        const updateTheme = () => {
            const systemPrefersDark = darkModeQuery.matches;
            const cssTheme = resolveCssTheme(themeSetting, systemPrefersDark);
            applyTheme(cssTheme);
        };

        // Apply theme immediately
        updateTheme();

        // Update Electron's native theme so embedded webviews respect it
        const nativeTheme = getNativeThemeSource(themeSetting);
        getApi()?.setNativeThemeSource(nativeTheme);

        // Listen for system preference changes (only matters when theme is "system")
        const handleSystemPreferenceChange = () => {
            if (themeSetting === "system") {
                updateTheme();
            }
        };

        darkModeQuery.addEventListener("change", handleSystemPreferenceChange);

        return () => {
            darkModeQuery.removeEventListener("change", handleSystemPreferenceChange);
        };
    }, [themeSetting]);
}

/**
 * Gets the current resolved theme category (dark/light) directly from the store.
 * Light variants all resolve to "light".
 * Useful for non-React contexts or one-time reads.
 */
export function getResolvedTheme(): ResolvedTheme {
    const themeSettingAtom = getSettingsKeyAtom("app:theme");
    const themeSetting = (globalStore.get(themeSettingAtom) ?? "dark") as ThemeSetting;

    if (themeSetting === "system") {
        const darkModeQuery = window.matchMedia("(prefers-color-scheme: dark)");
        return darkModeQuery.matches ? "dark" : "light";
    }

    return isLightTheme(themeSetting) ? "light" : "dark";
}
