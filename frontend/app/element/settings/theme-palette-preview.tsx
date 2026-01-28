// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { applyThemeOverrideLive } from "@/app/hook/usetheme";
import { memo, useCallback, useEffect, useState } from "react";
import { ColorPickerPopup } from "./color-picker-popup";
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
    // Core
    { label: "Background", variable: "--main-bg-color" },
    { label: "Text", variable: "--main-text-color" },
    { label: "Secondary", variable: "--secondary-text-color" },
    { label: "Grey Text", variable: "--grey-text-color" },
    { label: "Accent", variable: "--accent-color" },
    { label: "Border", variable: "--border-color" },
    { label: "Link", variable: "--link-color" },
    // Status
    { label: "Error", variable: "--error-color" },
    { label: "Warning", variable: "--warning-color" },
    { label: "Success", variable: "--success-color" },
    // Surfaces
    { label: "Panel BG", variable: "--panel-bg-color" },
    { label: "Hover BG", variable: "--hover-bg-color" },
    { label: "Card BG", variable: "--card-bg-color" },
    { label: "Highlight", variable: "--highlight-bg-color" },
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
 * Reads all palette colors from the current computed styles.
 */
function readPaletteColors(): PaletteColor[] {
    return PALETTE_VARIABLES.map((entry) => ({
        label: entry.label,
        variable: entry.variable,
        computedValue: getComputedCSSVar(entry.variable),
    }));
}

/**
 * Converts a computed CSS color value to a hex string for display.
 */
function computedToHex(value: string): string {
    const rgbaMatch = /rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*(?:,\s*(\d+(?:\.\d+)?))?\s*\)/.exec(value);
    if (rgbaMatch) {
        const r = Math.round(Number.parseFloat(rgbaMatch[1]));
        const g = Math.round(Number.parseFloat(rgbaMatch[2]));
        const b = Math.round(Number.parseFloat(rgbaMatch[3]));
        const a = rgbaMatch[4] != null ? Number.parseFloat(rgbaMatch[4]) : 1;
        const hex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
        if (a < 1) return `${hex} ${Math.round(a * 100)}%`;
        return hex;
    }
    if (value.startsWith("#")) return value;
    try {
        const ctx = document.createElement("canvas").getContext("2d");
        if (ctx) {
            ctx.fillStyle = value;
            return ctx.fillStyle;
        }
    } catch {
        // ignore
    }
    return value;
}

/**
 * Normalizes any CSS color string to a lowercase 6-char hex for comparison.
 */
function normalizeColorToHex6(color: string): string {
    const trimmed = color.trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(trimmed)) return trimmed;
    const hex3 = trimmed.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
    if (hex3) return `#${hex3[1]}${hex3[1]}${hex3[2]}${hex3[2]}${hex3[3]}${hex3[3]}`;
    if (/^#[0-9a-f]{8}$/.test(trimmed)) return trimmed.slice(0, 7);
    const rgbMatch = /rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/.exec(trimmed);
    if (rgbMatch) {
        const r = Math.round(Number.parseFloat(rgbMatch[1]));
        const g = Math.round(Number.parseFloat(rgbMatch[2]));
        const b = Math.round(Number.parseFloat(rgbMatch[3]));
        return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    }
    try {
        const ctx = document.createElement("canvas").getContext("2d");
        if (ctx) {
            ctx.fillStyle = color;
            return ctx.fillStyle.toLowerCase();
        }
    } catch {
        // ignore
    }
    return trimmed;
}

interface OpenPicker {
    variable: string;
    rect: DOMRect;
    initialColor: string;
    defaultColor: string;
    preOpenOverride: string | null;
}

/**
 * Reads the theme default for a CSS variable by temporarily removing any inline override.
 */
function getThemeDefault(variable: string): string {
    const root = document.documentElement;
    const inlineValue = root.style.getPropertyValue(variable);
    if (inlineValue) {
        root.style.removeProperty(variable);
        const defaultValue = getComputedCSSVar(variable);
        root.style.setProperty(variable, inlineValue);
        return defaultValue;
    }
    return getComputedCSSVar(variable);
}

const ThemePalettePreview = memo(({ themeOverrides, onOverrideChange }: ThemePalettePreviewProps) => {
    const [colors, setColors] = useState<PaletteColor[]>(() => readPaletteColors());
    const [openPicker, setOpenPicker] = useState<OpenPicker | null>(null);

    const refreshColors = useCallback(() => {
        requestAnimationFrame(() => {
            setColors(readPaletteColors());
        });
    }, []);

    useEffect(() => {
        refreshColors();

        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (
                    mutation.type === "attributes" &&
                    (mutation.attributeName === "data-theme" || mutation.attributeName === "data-accent")
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
        (variable: string, computedValue: string, event: React.MouseEvent) => {
            if (!onOverrideChange) return;

            const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
            const overrideValue = themeOverrides?.[variable];
            const initialColor = overrideValue ?? computedValue;
            const defaultColor = overrideValue ? getThemeDefault(variable) : computedValue;
            const preOpenOverride = overrideValue ?? null;
            setOpenPicker({ variable, rect, initialColor, defaultColor, preOpenOverride });
        },
        [onOverrideChange, themeOverrides]
    );

    // Save immediately on every color change
    const handlePickerChange = useCallback(
        (color: string) => {
            if (!openPicker) return;
            const colorNorm = normalizeColorToHex6(color);
            const defaultNorm = normalizeColorToHex6(openPicker.defaultColor);
            if (colorNorm !== defaultNorm) {
                onOverrideChange?.(openPicker.variable, color);
            } else {
                // Reverted to theme default — remove override
                onOverrideChange?.(openPicker.variable, null);
            }
            applyThemeOverrideLive(openPicker.variable, colorNorm !== defaultNorm ? color : null);
            refreshColors();
        },
        [openPicker, onOverrideChange, refreshColors]
    );

    // Backdrop click or X button — just close (changes already saved)
    const handlePickerCommit = useCallback(
        (_color: string) => {
            setOpenPicker(null);
            refreshColors();
        },
        [refreshColors]
    );

    // Escape — undo all changes, restore pre-open state
    const handlePickerCancel = useCallback(() => {
        if (!openPicker) return;
        // Restore to what it was before the picker opened
        applyThemeOverrideLive(openPicker.variable, openPicker.preOpenOverride);
        onOverrideChange?.(openPicker.variable, openPicker.preOpenOverride);
        setOpenPicker(null);
        refreshColors();
    }, [openPicker, onOverrideChange, refreshColors]);

    const handleReset = useCallback(
        (variable: string, event: React.MouseEvent) => {
            event.stopPropagation();
            applyThemeOverrideLive(variable, null);
            onOverrideChange?.(variable, null);
            refreshColors();
            if (openPicker?.variable === variable) {
                setOpenPicker(null);
            }
        },
        [onOverrideChange, refreshColors, openPicker]
    );

    const isInteractive = !!onOverrideChange;

    return (
        <div className="palette-preview">
            <div className="palette-swatches">
                {colors.map((color) => {
                    const hasOverride = themeOverrides && color.variable in themeOverrides;
                    const isEditing = openPicker?.variable === color.variable;
                    const hexValue = computedToHex(color.computedValue);

                    let cardClass = "palette-swatch-card";
                    if (isInteractive) cardClass += " palette-swatch-card--interactive";
                    if (hasOverride) cardClass += " palette-swatch-card--modified";
                    if (isEditing) cardClass += " palette-swatch-card--editing";

                    return (
                        <div key={color.variable} className="palette-swatch-item">
                            <div
                                className={cardClass}
                                title={`${color.variable}: ${color.computedValue}${hasOverride ? " (modified)" : ""}${isEditing ? " (editing)" : ""}`}
                                role={isInteractive ? "button" : undefined}
                                tabIndex={isInteractive ? 0 : -1}
                                onClick={
                                    isInteractive
                                        ? (e) => handleSwatchClick(color.variable, color.computedValue, e)
                                        : undefined
                                }
                                onKeyDown={
                                    isInteractive
                                        ? (e: React.KeyboardEvent<HTMLDivElement>) => {
                                              if (e.key === "Enter" || e.key === " ") {
                                                  e.preventDefault();
                                                  handleSwatchClick(
                                                      color.variable,
                                                      color.computedValue,
                                                      e as unknown as React.MouseEvent
                                                  );
                                              }
                                          }
                                        : undefined
                                }
                            >
                                <div
                                    className="palette-swatch-color"
                                    style={{ backgroundColor: color.computedValue }}
                                />
                                <div className="palette-swatch-info">
                                    <div className="palette-swatch-info-text">
                                        <span className="palette-swatch-label">{color.label}</span>
                                        <span className="palette-swatch-hex">{hexValue}</span>
                                    </div>
                                    {hasOverride && isInteractive && (
                                        <button
                                            className="swatch-reset"
                                            onClick={(e) => handleReset(color.variable, e)}
                                            title="Reset to default"
                                            aria-label={`Reset ${color.label} to default`}
                                        >
                                            <i className="fa fa-solid fa-rotate-left" />
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
            {openPicker && (
                <ColorPickerPopup
                    key={openPicker.variable}
                    initialColor={openPicker.initialColor}
                    defaultColor={openPicker.defaultColor}
                    anchorRect={openPicker.rect}
                    onChange={handlePickerChange}
                    onCommit={handlePickerCommit}
                    onCancel={handlePickerCancel}
                />
            )}
        </div>
    );
});

ThemePalettePreview.displayName = "ThemePalettePreview";

export { ThemePalettePreview };
