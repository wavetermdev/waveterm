// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { settingsService } from "@/app/store/settings-service";
import { getApi, getSettingsKeyAtom, globalStore } from "@/store/global";
import { atom, useAtomValue } from "jotai";
import { useEffect, useRef } from "react";

// Step 1: Simplified type definitions
export type ThemeSetting = "dark" | "light" | "system";
export type AccentSetting = "green" | "warm" | "blue" | "purple" | "teal";
// Simplified theme category for terminal theme auto-switching
type ResolvedTheme = "dark" | "light";
// Electron native theme source
type NativeThemeSource = "dark" | "light" | "system";

// Step 2: Migration logic
/**
 * One-time migration from old theme variants to new mode+accent system.
 * - "light-gray" -> app:theme = "light" (accent unchanged)
 * - "light-warm" -> app:theme = "light", app:accent = "warm"
 * Other values pass through unchanged.
 * Uses setSettings (plural) for atomic batch update to avoid transient states.
 */
function migrateThemeSetting(currentTheme: string): void {
    if (currentTheme === "light-gray") {
        settingsService.setSettings({ "app:theme": "light" });
    } else if (currentTheme === "light-warm") {
        settingsService.setSettings({ "app:theme": "light", "app:accent": "warm" });
    }
}

// Reactive atom tracking system dark mode preference.
// Uses an effect-based approach: the atom holds a writable value that is kept
// in sync with window.matchMedia via a module-level listener.
const systemDarkModeAtom = atom<boolean>(window.matchMedia("(prefers-color-scheme: dark)").matches);

// Set up a module-level listener to keep systemDarkModeAtom in sync with OS preference.
// This runs once when the module loads. The listener updates the atom whenever
// the OS dark/light preference changes, making resolvedAppThemeAtom reactive.
const darkModeQuery = window.matchMedia("(prefers-color-scheme: dark)");
darkModeQuery.addEventListener("change", (e) => {
    globalStore.set(systemDarkModeAtom, e.matches);
});

// Step 9: resolvedAppThemeAtom (keep legacy value handling for migration window)
/**
 * Atom that resolves the effective app theme category (dark/light).
 * This is used for terminal theme auto-switching.
 * Reactively tracks both the app:theme setting and OS dark mode preference.
 */
export const resolvedAppThemeAtom = atom<ResolvedTheme>((get) => {
    const setting = (get(getSettingsKeyAtom("app:theme")) || "dark") as string;
    if (setting === "system") {
        return get(systemDarkModeAtom) ? "dark" : "light";
    }
    // Handle legacy values during migration window
    if (setting === "light" || setting === "light-gray" || setting === "light-warm") {
        return "light";
    }
    return "dark";
});

// Step 4: resolvedAccentAtom
/**
 * Atom that resolves the current accent setting.
 * Defaults to "green" if not set.
 */
export const resolvedAccentAtom = atom<AccentSetting>((get) => {
    const setting = get(getSettingsKeyAtom("app:accent"));
    const validAccents: AccentSetting[] = ["green", "warm", "blue", "purple", "teal"];
    if (setting && validAccents.includes(setting as AccentSetting)) {
        return setting as AccentSetting;
    }
    return "green";
});

// Step 5: Simplified resolveCssTheme
/**
 * Returns the CSS theme to apply based on setting and system preference.
 * For "system" setting, uses prefers-color-scheme media query.
 */
function resolveCssTheme(themeSetting: ThemeSetting, systemPrefersDark: boolean): string {
    if (themeSetting === "system") {
        return systemPrefersDark ? "dark" : "light";
    }
    return themeSetting; // "dark" or "light" only now
}

// Step 6: Simplified getNativeThemeSource
/**
 * Returns the native theme source for Electron (for embedded webviews).
 */
function getNativeThemeSource(themeSetting: ThemeSetting): NativeThemeSource {
    if (themeSetting === "system") {
        return "system";
    }
    return themeSetting === "light" ? "light" : "dark";
}

// Step 7: applyThemeAndAccent (replaces applyTheme)
/**
 * Applies theme mode and accent to the document root element.
 * Sets data-theme and data-accent attributes.
 */
function applyThemeAndAccent(theme: string, accent: string): void {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.setAttribute("data-accent", accent);
}

// Step 8: Updated useTheme hook
/**
 * Hook that manages the application theme and accent.
 * Reads the app:theme and app:accent settings and applies the correct
 * data-theme and data-accent attributes.
 * Handles "system" mode by detecting system preference via prefers-color-scheme.
 * Re-applies theme when setting changes or system preference changes.
 * Triggers one-time migration from old theme variants on mount.
 *
 * This hook should be called from the main App component.
 */
export function useTheme(): void {
    const themeSettingAtom = getSettingsKeyAtom("app:theme");
    const accentSettingAtom = getSettingsKeyAtom("app:accent");
    const themeSetting = (useAtomValue(themeSettingAtom) ?? "dark") as string;
    const accentSetting = (useAtomValue(accentSettingAtom) ?? "green") as AccentSetting;

    // One-time migration from old theme variants
    const migratedRef = useRef(false);
    useEffect(() => {
        if (!migratedRef.current && (themeSetting === "light-gray" || themeSetting === "light-warm")) {
            migrateThemeSetting(themeSetting);
            migratedRef.current = true;
        }
    }, [themeSetting]);

    // Normalize theme setting (in case migration hasn't flushed yet)
    const normalizedTheme: ThemeSetting =
        themeSetting === "light-gray" || themeSetting === "light-warm"
            ? "light"
            : ((themeSetting as ThemeSetting) ?? "dark");

    useEffect(() => {
        const darkModeQuery = window.matchMedia("(prefers-color-scheme: dark)");

        const updateTheme = () => {
            const systemPrefersDark = darkModeQuery.matches;
            const cssTheme = resolveCssTheme(normalizedTheme, systemPrefersDark);
            applyThemeAndAccent(cssTheme, accentSetting);
        };

        updateTheme();

        const nativeTheme = getNativeThemeSource(normalizedTheme);
        getApi()?.setNativeThemeSource(nativeTheme);

        const handleSystemPreferenceChange = () => {
            if (normalizedTheme === "system") {
                updateTheme();
            }
        };

        darkModeQuery.addEventListener("change", handleSystemPreferenceChange);
        return () => {
            darkModeQuery.removeEventListener("change", handleSystemPreferenceChange);
        };
    }, [normalizedTheme, accentSetting]);
}

// Step 10: Updated getResolvedTheme
/**
 * Gets the current resolved theme category (dark/light) directly from the store.
 * Uses explicit string comparisons for legacy value handling.
 * Useful for non-React contexts or one-time reads.
 */
export function getResolvedTheme(): ResolvedTheme {
    const themeSettingAtom = getSettingsKeyAtom("app:theme");
    const themeSetting = (globalStore.get(themeSettingAtom) ?? "dark") as string;

    if (themeSetting === "system") {
        const darkModeQuery = window.matchMedia("(prefers-color-scheme: dark)");
        return darkModeQuery.matches ? "dark" : "light";
    }

    // Explicit legacy value handling (isLightTheme only checks "light" after simplification)
    return themeSetting === "light" || themeSetting === "light-gray" || themeSetting === "light-warm"
        ? "light"
        : "dark";
}

// Step 11: getResolvedAccent helper
/**
 * Gets the current resolved accent directly from the store.
 * Useful for non-React contexts or one-time reads.
 */
export function getResolvedAccent(): AccentSetting {
    const accentSettingAtom = getSettingsKeyAtom("app:accent");
    const setting = globalStore.get(accentSettingAtom);
    const validAccents: AccentSetting[] = ["green", "warm", "blue", "purple", "teal"];
    if (setting && validAccents.includes(setting as AccentSetting)) {
        return setting as AccentSetting;
    }
    return "green";
}
