// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { applyThemeOverrideLive } from "@/app/hook/usetheme";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import "./theme-palette-preview.scss";

interface PaletteColor {
    label: string;
    variable: string;
    computedValue: string;
}

interface ThemePalettePreviewProps {
    themeOverrides?: Record<string, string>;
    onOverrideChange?: (variable: string, value: string | null) => void;
}

const PALETTE_VARIABLES = [
    { label: "Background", variable: "--main-bg-color" },
    { label: "Text", variable: "--main-text-color" },
    { label: "Secondary", variable: "--secondary-text-color" },
    { label: "Accent", variable: "--accent-color" },
    { label: "Border", variable: "--border-color" },
    { label: "Link", variable: "--link-color" },
    { label: "Error", variable: "--error-color" },
    { label: "Warning", variable: "--warning-color" },
    { label: "Success", variable: "--success-color" },
    { label: "Panel BG", variable: "--panel-bg-color" },
    { label: "Hover BG", variable: "--hover-bg-color" },
    { label: "Block BG", variable: "--block-bg-color" },
    { label: "Modal BG", variable: "--modal-bg-color" },
    { label: "Tab Accent", variable: "--tab-accent" },
] as const;

/**
 * Reads the computed value of a CSS variable from documentElement.
 */
function getComputedCSSVar(varName: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}

/**
 * Converts a CSS color string to a hex color string for <input type="color">.
 * Falls back to #000000 if conversion fails.
 */
function colorToHex(color: string): string {
    if (!color) return "#000000";
    // If already a hex color
    if (color.startsWith("#")) {
        // Ensure it's 7 chars (#RRGGBB)
        if (color.length === 4) {
            return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
        }
        return color.substring(0, 7);
    }
    // Use a canvas to convert
    try {
        const ctx = document.createElement("canvas").getContext("2d");
        if (ctx) {
            ctx.fillStyle = color;
            return ctx.fillStyle; // Returns hex
        }
    } catch {
        // ignore
    }
    return "#000000";
}

/**
 * Reads all palette colors from the current computed styles.
 */
function readPaletteColors(): PaletteColor[] {
    return PALETTE_VARIABLES.map((entry) => ({
        label: entry.label,
        variable: entry.variable,
        computedValue: getComputedCSSVar(entry.variable),
    }));
}

const ThemePalettePreview = memo(({ themeOverrides, onOverrideChange }: ThemePalettePreviewProps) => {
    const [colors, setColors] = useState<PaletteColor[]>(() => readPaletteColors());
    const colorInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
    const handlerRefs = useRef<Map<string, { input: (e: Event) => void; change: (e: Event) => void }>>(new Map());

    const refreshColors = useCallback(() => {
        // Use requestAnimationFrame to ensure styles have been applied
        requestAnimationFrame(() => {
            setColors(readPaletteColors());
        });
    }, []);

    useEffect(() => {
        // Initial read
        refreshColors();

        // Watch for attribute changes on documentElement (data-theme, data-accent)
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (
                    mutation.type === "attributes" &&
                    (mutation.attributeName === "data-theme" ||
                        mutation.attributeName === "data-accent")
                ) {
                    refreshColors();
                    break;
                }
            }
        });

        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["data-theme", "data-accent"],
        });

        return () => {
            observer.disconnect();
        };
    }, [refreshColors]);

    const handleSwatchClick = useCallback(
        (variable: string, currentColor: string) => {
            if (!onOverrideChange) return;
            const input = colorInputRefs.current.get(variable);
            if (input) {
                input.value = colorToHex(currentColor);
                input.click();
            }
        },
        [onOverrideChange]
    );

    const handleColorInput = useCallback(
        (variable: string, event: Event) => {
            const target = event.target as HTMLInputElement;
            applyThemeOverrideLive(variable, target.value);
            // Refresh to show updated color
            refreshColors();
        },
        [refreshColors]
    );

    const handleColorChange = useCallback(
        (variable: string, event: Event) => {
            const target = event.target as HTMLInputElement;
            onOverrideChange?.(variable, target.value);
        },
        [onOverrideChange]
    );

    const handleReset = useCallback(
        (variable: string, event: React.MouseEvent) => {
            event.stopPropagation();
            applyThemeOverrideLive(variable, null);
            onOverrideChange?.(variable, null);
            refreshColors();
        },
        [onOverrideChange, refreshColors]
    );

    // Set up native event listeners for color inputs
    const setColorInputRef = useCallback(
        (variable: string, el: HTMLInputElement | null) => {
            const prev = colorInputRefs.current.get(variable);
            const prevHandlers = handlerRefs.current.get(variable);
            if (prev && prevHandlers) {
                prev.removeEventListener("input", prevHandlers.input);
                prev.removeEventListener("change", prevHandlers.change);
                handlerRefs.current.delete(variable);
            }
            if (el) {
                const inputHandler = (e: Event) => handleColorInput(variable, e);
                const changeHandler = (e: Event) => handleColorChange(variable, e);
                colorInputRefs.current.set(variable, el);
                handlerRefs.current.set(variable, { input: inputHandler, change: changeHandler });
                el.addEventListener("input", inputHandler);
                el.addEventListener("change", changeHandler);
            } else {
                colorInputRefs.current.delete(variable);
            }
        },
        [handleColorInput, handleColorChange]
    );

    const isInteractive = !!onOverrideChange;

    return (
        <div className="palette-preview">
            <div className="palette-swatches">
                {colors.map((color) => {
                    const hasOverride = themeOverrides && color.variable in themeOverrides;
                    return (
                        <div key={color.variable} className="palette-swatch-item">
                            <div
                                className={`palette-swatch${isInteractive ? " palette-swatch--interactive" : ""}${hasOverride ? " palette-swatch--modified" : ""}`}
                                style={{ backgroundColor: color.computedValue }}
                                title={`${color.variable}: ${color.computedValue}${hasOverride ? " (modified)" : ""}`}
                                onClick={
                                    isInteractive
                                        ? () => handleSwatchClick(color.variable, color.computedValue)
                                        : undefined
                                }
                            >
                                {hasOverride && isInteractive && (
                                    <button
                                        className="swatch-reset"
                                        onClick={(e) => handleReset(color.variable, e)}
                                        title="Reset to default"
                                        aria-label={`Reset ${color.label} to default`}
                                    >
                                        <i className="fa fa-solid fa-xmark" />
                                    </button>
                                )}
                            </div>
                            <span className="palette-swatch-label">{color.label}</span>
                            {isInteractive && (
                                <input
                                    ref={(el) => setColorInputRef(color.variable, el)}
                                    type="color"
                                    className="swatch-color-input"
                                    tabIndex={-1}
                                    aria-hidden="true"
                                />
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
});

ThemePalettePreview.displayName = "ThemePalettePreview";

export { ThemePalettePreview };
