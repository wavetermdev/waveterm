// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Terminal Theme Control
 *
 * A visual color scheme selector for terminal themes, similar to Windows Terminal.
 * Shows available themes as cards with color swatches, making it easy to preview
 * and select terminal color schemes.
 */

import { atoms } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { cn } from "@/util/util";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

export interface TermThemeControlProps {
    value: string;
    onChange: (value: string) => void;
}

interface ThemeInfo {
    key: string;
    name: string;
    order: number;
    colors: {
        background: string;
        foreground: string;
        black: string;
        red: string;
        green: string;
        yellow: string;
        blue: string;
        magenta: string;
        cyan: string;
        white: string;
        brightBlack?: string;
        brightRed?: string;
        brightGreen?: string;
        brightYellow?: string;
        brightBlue?: string;
        brightMagenta?: string;
        brightCyan?: string;
        brightWhite?: string;
        cursor?: string;
        selectionBackground?: string;
    };
}

/**
 * Get available terminal themes from the config
 */
function getTermThemes(): ThemeInfo[] {
    const fullConfig = globalStore.get(atoms.fullConfigAtom);
    const themes = fullConfig?.termthemes || {};

    return Object.entries(themes)
        .map(([key, theme]: [string, TermThemeType]) => ({
            key,
            name: theme?.["display:name"] || key,
            order: theme?.["display:order"] ?? 999,
            colors: {
                background: theme?.background || "#000000",
                foreground: theme?.foreground || "#ffffff",
                black: theme?.black || "#000000",
                red: theme?.red || "#cc0000",
                green: theme?.green || "#00cc00",
                yellow: theme?.yellow || "#cccc00",
                blue: theme?.blue || "#0000cc",
                magenta: theme?.magenta || "#cc00cc",
                cyan: theme?.cyan || "#00cccc",
                white: theme?.white || "#cccccc",
                brightBlack: theme?.brightBlack,
                brightRed: theme?.brightRed,
                brightGreen: theme?.brightGreen,
                brightYellow: theme?.brightYellow,
                brightBlue: theme?.brightBlue,
                brightMagenta: theme?.brightMagenta,
                brightCyan: theme?.brightCyan,
                brightWhite: theme?.brightWhite,
                cursor: theme?.cursor,
                selectionBackground: theme?.selectionBackground,
            },
        }))
        .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

/**
 * Color swatch component - displays a single color
 */
const ColorSwatch = memo(({ color, title }: { color: string; title?: string }) => (
    <div
        className="termtheme-swatch"
        style={{ backgroundColor: color }}
        title={title}
    />
));

ColorSwatch.displayName = "ColorSwatch";

/**
 * Theme preview component - shows the 8 ANSI colors + background
 */
const ThemePreview = memo(({ theme }: { theme: ThemeInfo }) => {
    const colors = theme.colors;

    // Show normal colors on top row, bright colors on bottom row
    const normalColors = [
        colors.black,
        colors.red,
        colors.green,
        colors.yellow,
        colors.blue,
        colors.magenta,
        colors.cyan,
        colors.white,
    ];

    const brightColors = [
        colors.brightBlack || colors.black,
        colors.brightRed || colors.red,
        colors.brightGreen || colors.green,
        colors.brightYellow || colors.yellow,
        colors.brightBlue || colors.blue,
        colors.brightMagenta || colors.magenta,
        colors.brightCyan || colors.cyan,
        colors.brightWhite || colors.white,
    ];

    return (
        <div className="termtheme-preview" style={{ backgroundColor: colors.background }}>
            <div className="termtheme-color-row">
                {normalColors.map((color, i) => (
                    <ColorSwatch key={`normal-${i}`} color={color} />
                ))}
            </div>
            <div className="termtheme-color-row">
                {brightColors.map((color, i) => (
                    <ColorSwatch key={`bright-${i}`} color={color} />
                ))}
            </div>
        </div>
    );
});

ThemePreview.displayName = "ThemePreview";

/**
 * Theme card component - clickable card for a single theme
 */
interface ThemeCardProps {
    theme: ThemeInfo;
    isSelected: boolean;
    onSelect: () => void;
}

const ThemeCard = memo(({ theme, isSelected, onSelect }: ThemeCardProps) => {
    return (
        <button
            type="button"
            className={cn("termtheme-card", { selected: isSelected })}
            onClick={onSelect}
            aria-pressed={isSelected}
        >
            <ThemePreview theme={theme} />
            <span className="termtheme-name">{theme.name}</span>
            {isSelected && (
                <span className="termtheme-check">
                    <i className="fa fa-solid fa-check" />
                </span>
            )}
        </button>
    );
});

ThemeCard.displayName = "ThemeCard";

/**
 * Main terminal theme control component
 */
export const TermThemeControl = memo(({ value, onChange }: TermThemeControlProps) => {
    const [themes, setThemes] = useState<ThemeInfo[]>([]);

    // Load themes
    useEffect(() => {
        const loadThemes = () => {
            const loadedThemes = getTermThemes();
            setThemes(loadedThemes);
        };

        loadThemes();

        // Subscribe to config changes
        const unsub = globalStore.sub(atoms.fullConfigAtom, loadThemes);
        return () => unsub();
    }, []);

    const handleSelect = useCallback(
        (themeKey: string) => {
            onChange(themeKey);
        },
        [onChange]
    );

    // Separate themes into dark and light categories
    const { darkThemes, lightThemes } = useMemo(() => {
        const dark: ThemeInfo[] = [];
        const light: ThemeInfo[] = [];

        for (const theme of themes) {
            // Determine if theme is light or dark based on background color
            const bg = theme.colors.background;
            const isLight = isLightColor(bg);
            if (isLight) {
                light.push(theme);
            } else {
                dark.push(theme);
            }
        }

        return { darkThemes: dark, lightThemes: light };
    }, [themes]);

    if (themes.length === 0) {
        return <div className="termtheme-loading">Loading themes...</div>;
    }

    return (
        <div className="termtheme-control">
            {darkThemes.length > 0 && (
                <div className="termtheme-section">
                    <h4 className="termtheme-section-title">Dark Themes</h4>
                    <div className="termtheme-grid">
                        {darkThemes.map((theme) => (
                            <ThemeCard
                                key={theme.key}
                                theme={theme}
                                isSelected={value === theme.key}
                                onSelect={() => handleSelect(theme.key)}
                            />
                        ))}
                    </div>
                </div>
            )}
            {lightThemes.length > 0 && (
                <div className="termtheme-section">
                    <h4 className="termtheme-section-title">Light Themes</h4>
                    <div className="termtheme-grid">
                        {lightThemes.map((theme) => (
                            <ThemeCard
                                key={theme.key}
                                theme={theme}
                                isSelected={value === theme.key}
                                onSelect={() => handleSelect(theme.key)}
                            />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
});

TermThemeControl.displayName = "TermThemeControl";

/**
 * Determine if a hex color is light or dark
 * Returns true if the color is light (should use dark text)
 */
function isLightColor(hex: string): boolean {
    // Default to dark if no color
    if (!hex || hex === "transparent" || hex === "") {
        return false;
    }

    // Remove # if present
    const color = hex.replace("#", "");

    // Parse RGB values
    let r: number, g: number, b: number;

    if (color.length === 3) {
        r = parseInt(color[0] + color[0], 16);
        g = parseInt(color[1] + color[1], 16);
        b = parseInt(color[2] + color[2], 16);
    } else if (color.length === 6) {
        r = parseInt(color.substring(0, 2), 16);
        g = parseInt(color.substring(2, 4), 16);
        b = parseInt(color.substring(4, 6), 16);
    } else if (color.length === 8) {
        // RGBA - ignore alpha
        r = parseInt(color.substring(0, 2), 16);
        g = parseInt(color.substring(2, 4), 16);
        b = parseInt(color.substring(4, 6), 16);
    } else {
        return false;
    }

    // Calculate relative luminance using sRGB formula
    // https://www.w3.org/TR/WCAG20/#relativeluminancedef
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

    // Threshold at 0.5 for light/dark distinction
    return luminance > 0.5;
}
