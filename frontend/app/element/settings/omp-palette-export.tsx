// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Oh-My-Posh Palette Export Component
 *
 * Exports the current terminal theme's ANSI colors as an Oh-My-Posh compatible
 * palette configuration. Provides a visual preview and clipboard copy functionality.
 */

import { atoms, getSettingsPrefixAtom } from "@/app/store/global";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useCallback, useMemo, useState } from "react";

import "./omp-palette-export.scss";

interface OmpPaletteExportProps {
    themeName?: string;
    className?: string;
}

interface OmpPalette {
    palette: {
        black: string;
        red: string;
        green: string;
        yellow: string;
        blue: string;
        magenta: string;
        cyan: string;
        white: string;
        darkGray: string;
        lightRed: string;
        lightGreen: string;
        lightYellow: string;
        lightBlue: string;
        lightMagenta: string;
        lightCyan: string;
        lightWhite: string;
    };
}

const DefaultTermTheme = "default-dark";

/**
 * Validate and normalize hex color code
 */
function validateHexColor(color: string | undefined): string {
    if (!color || !/^#[0-9A-Fa-f]{6}$/.test(color)) {
        return "#000000";
    }
    return color;
}

/**
 * Convert a TermThemeType to OMP palette format
 */
function convertToOmpPalette(theme: TermThemeType): OmpPalette {
    return {
        palette: {
            black: validateHexColor(theme.black),
            red: validateHexColor(theme.red),
            green: validateHexColor(theme.green),
            yellow: validateHexColor(theme.yellow),
            blue: validateHexColor(theme.blue),
            magenta: validateHexColor(theme.magenta),
            cyan: validateHexColor(theme.cyan),
            white: validateHexColor(theme.white),
            darkGray: validateHexColor(theme.brightBlack),
            lightRed: validateHexColor(theme.brightRed),
            lightGreen: validateHexColor(theme.brightGreen),
            lightYellow: validateHexColor(theme.brightYellow),
            lightBlue: validateHexColor(theme.brightBlue),
            lightMagenta: validateHexColor(theme.brightMagenta),
            lightCyan: validateHexColor(theme.brightCyan),
            lightWhite: validateHexColor(theme.brightWhite),
        },
    };
}

/**
 * Format OMP palette as pretty-printed JSON
 */
function formatPaletteJson(palette: OmpPalette): string {
    return JSON.stringify(palette, null, 2);
}

/**
 * Get color definitions for preview grid
 */
function getColorDefinitions(): Array<{ key: keyof OmpPalette["palette"]; label: string; category: string }> {
    return [
        // Standard colors
        { key: "black", label: "Black", category: "standard" },
        { key: "red", label: "Red", category: "standard" },
        { key: "green", label: "Green", category: "standard" },
        { key: "yellow", label: "Yellow", category: "standard" },
        { key: "blue", label: "Blue", category: "standard" },
        { key: "magenta", label: "Magenta", category: "standard" },
        { key: "cyan", label: "Cyan", category: "standard" },
        { key: "white", label: "White", category: "standard" },
        // Bright colors
        { key: "darkGray", label: "Gray", category: "bright" },
        { key: "lightRed", label: "Lt Red", category: "bright" },
        { key: "lightGreen", label: "Lt Green", category: "bright" },
        { key: "lightYellow", label: "Lt Yellow", category: "bright" },
        { key: "lightBlue", label: "Lt Blue", category: "bright" },
        { key: "lightMagenta", label: "Lt Magenta", category: "bright" },
        { key: "lightCyan", label: "Lt Cyan", category: "bright" },
        { key: "lightWhite", label: "Lt White", category: "bright" },
    ];
}

const OmpPaletteExport = memo(({ themeName, className }: OmpPaletteExportProps) => {
    const [copyState, setCopyState] = useState<"idle" | "copying" | "success" | "error">("idle");
    const [showJsonPreview, setShowJsonPreview] = useState(false);

    // Get current theme from settings or use provided themeName
    const fullConfig = useAtomValue(atoms.fullConfigAtom);
    const currentThemeSetting = useAtomValue(getSettingsPrefixAtom("term"));
    const effectiveThemeName = themeName || currentThemeSetting?.["term:theme"] || DefaultTermTheme;

    // Get theme data
    const themes = fullConfig?.termthemes ?? {};
    const theme = themes[effectiveThemeName];
    const themeDisplayName = theme?.["display:name"] || effectiveThemeName;

    // Generate OMP palette
    const ompPalette = useMemo(() => {
        if (!theme) return null;
        return convertToOmpPalette(theme);
    }, [theme]);

    const paletteJson = useMemo(() => {
        if (!ompPalette) return "";
        return formatPaletteJson(ompPalette);
    }, [ompPalette]);

    const colorDefinitions = useMemo(() => getColorDefinitions(), []);

    const handleCopyToClipboard = useCallback(async () => {
        if (!paletteJson || copyState === "copying") return;

        setCopyState("copying");

        try {
            await navigator.clipboard.writeText(paletteJson);
            setCopyState("success");

            // Reset to idle after 2 seconds
            setTimeout(() => {
                setCopyState("idle");
            }, 2000);
        } catch (error) {
            console.error("Failed to copy palette to clipboard:", error);
            setCopyState("error");

            // Reset to idle after 3 seconds
            setTimeout(() => {
                setCopyState("idle");
            }, 3000);
        }
    }, [paletteJson, copyState]);

    const toggleJsonPreview = useCallback(() => {
        setShowJsonPreview((prev) => !prev);
    }, []);

    // Handle missing theme
    if (!theme) {
        return (
            <div className={cn("omp-palette-export", "omp-palette-export-error", className)}>
                <div className="error-message">
                    <i className="fa fa-solid fa-exclamation-triangle" />
                    <span>No terminal theme selected. Please choose a Color Scheme first.</span>
                </div>
            </div>
        );
    }

    const standardColors = colorDefinitions.filter((c) => c.category === "standard");
    const brightColors = colorDefinitions.filter((c) => c.category === "bright");

    return (
        <div className={cn("omp-palette-export", className)}>
            <div className="omp-palette-header">
                <div className="current-theme">
                    <span className="theme-label">Current Theme:</span>
                    <span className="theme-name">{themeDisplayName}</span>
                </div>
            </div>

            <div className="palette-preview">
                <div className="palette-section">
                    <div className="section-label">Standard Colors</div>
                    <div className="color-grid">
                        {standardColors.map((colorDef) => {
                            const colorValue = ompPalette.palette[colorDef.key];
                            return (
                                <div
                                    key={colorDef.key}
                                    className="color-swatch"
                                    role="img"
                                    aria-label={`${colorDef.label}: ${colorValue}`}
                                >
                                    <div className="swatch-color" style={{ backgroundColor: colorValue }} />
                                    <div className="swatch-label">{colorDef.label}</div>
                                    <div className="swatch-value">{colorValue}</div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="palette-section">
                    <div className="section-label">Bright Colors</div>
                    <div className="color-grid">
                        {brightColors.map((colorDef) => {
                            const colorValue = ompPalette.palette[colorDef.key];
                            return (
                                <div
                                    key={colorDef.key}
                                    className="color-swatch"
                                    role="img"
                                    aria-label={`${colorDef.label}: ${colorValue}`}
                                >
                                    <div className="swatch-color" style={{ backgroundColor: colorValue }} />
                                    <div className="swatch-label">{colorDef.label}</div>
                                    <div className="swatch-value">{colorValue}</div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            <div className="palette-actions">
                <button
                    type="button"
                    className={cn("copy-button", {
                        copying: copyState === "copying",
                        success: copyState === "success",
                        error: copyState === "error",
                    })}
                    onClick={handleCopyToClipboard}
                    disabled={copyState === "copying"}
                    aria-label="Copy palette to clipboard"
                    aria-live="polite"
                >
                    {copyState === "copying" && (
                        <>
                            <i className="fa fa-solid fa-spinner fa-spin" />
                            <span>Copying...</span>
                        </>
                    )}
                    {copyState === "success" && (
                        <>
                            <i className="fa fa-solid fa-check" />
                            <span>Copied!</span>
                        </>
                    )}
                    {copyState === "error" && (
                        <>
                            <i className="fa fa-solid fa-times" />
                            <span>Failed to copy</span>
                        </>
                    )}
                    {copyState === "idle" && (
                        <>
                            <i className="fa fa-solid fa-copy" />
                            <span>Copy to Clipboard</span>
                        </>
                    )}
                </button>

                <button
                    type="button"
                    className="json-toggle-button"
                    onClick={toggleJsonPreview}
                    aria-expanded={showJsonPreview}
                >
                    <i className={cn("fa fa-solid", showJsonPreview ? "fa-chevron-down" : "fa-chevron-right")} />
                    <span>{showJsonPreview ? "Hide" : "View"} JSON Preview</span>
                </button>
            </div>

            {showJsonPreview && (
                <div className="json-preview">
                    <pre className="json-content">{paletteJson}</pre>
                </div>
            )}

            <div className="usage-instructions">
                <div className="instructions-header">
                    <i className="fa fa-solid fa-circle-info" />
                    <span>How to use in Oh-My-Posh</span>
                </div>
                <ol className="instructions-list">
                    <li>Click "Copy to Clipboard" above to copy the palette JSON</li>
                    <li>
                        Open your Oh-My-Posh config file (usually <code>~/.config/oh-my-posh/config.json</code> or{" "}
                        <code>~/AppData/Local/Programs/oh-my-posh/themes/your-theme.omp.json</code>)
                    </li>
                    <li>Add the palette object at the root level of your config</li>
                    <li>
                        Reference palette colors in your prompt segments using <code>p:</code> prefix:
                        <pre className="example-code">"foreground": "p:white"</pre>
                    </li>
                </ol>
                <div className="instructions-note">
                    <i className="fa fa-solid fa-lightbulb" />
                    <span>
                        Tip: You can use any palette color name like <code>p:blue</code>, <code>p:lightGreen</code>,
                        etc.
                    </span>
                </div>
            </div>
        </div>
    );
});

OmpPaletteExport.displayName = "OmpPaletteExport";

export { OmpPaletteExport };
export type { OmpPaletteExportProps };
