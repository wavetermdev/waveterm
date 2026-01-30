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
    if (value.startsWith("rgb")) {
        const open = value.indexOf("(");
        const close = value.lastIndexOf(")");
        if (open !== -1 && close > open) {
            const parts = value.slice(open + 1, close).split(",");
            if (parts.length >= 3 && parts.length <= 4) {
                const r = Math.round(Number(parts[0].trim()));
                const g = Math.round(Number(parts[1].trim()));
                const b = Math.round(Number(parts[2].trim()));
                if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
                    const a = parts.length === 4 ? Number(parts[3].trim()) : 1;
                    const hex = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
                    if (a < 1) return `${hex} ${Math.round(a * 100)}%`;
                    return hex;
                }
            }
        }
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
    if (trimmed.startsWith("rgb")) {
        const open = trimmed.indexOf("(");
        const close = trimmed.lastIndexOf(")");
        const end = close !== -1 ? close : trimmed.length;
        if (open !== -1) {
            const parts = trimmed.slice(open + 1, end).split(",");
            if (parts.length >= 3) {
                const r = Math.round(Number(parts[0].trim()));
                const g = Math.round(Number(parts[1].trim()));
                const b = Math.round(Number(parts[2].trim()));
                if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
                    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
                }
            }
        }
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

/**
 * Normalizes a color string to a canonical form including alpha for comparison.
 * Returns rgba(r,g,b,a) for colors with alpha < 1, hex6 otherwise.
 */
function normalizeColorWithAlpha(color: string): string {
    const trimmed = color.trim().toLowerCase();

    // Parse rgba/rgb
    if (trimmed.startsWith("rgb")) {
        const open = trimmed.indexOf("(");
        const close = trimmed.lastIndexOf(")");
        const end = close !== -1 ? close : trimmed.length;
        if (open !== -1) {
            const parts = trimmed.slice(open + 1, end).split(",");
            if (parts.length >= 3) {
                const r = Math.round(Number(parts[0].trim()));
                const g = Math.round(Number(parts[1].trim()));
                const b = Math.round(Number(parts[2].trim()));
                const a = parts.length >= 4 ? Number(parts[3].trim()) : 1;
                if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b) && !Number.isNaN(a)) {
                    if (a < 1) {
                        return `rgba(${r},${g},${b},${Math.round(a * 100) / 100})`;
                    }
                    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
                }
            }
        }
    }

    // Parse hex with alpha (#rrggbbaa)
    if (/^#[0-9a-f]{8}$/.test(trimmed)) {
        const r = Number.parseInt(trimmed.slice(1, 3), 16);
        const g = Number.parseInt(trimmed.slice(3, 5), 16);
        const b = Number.parseInt(trimmed.slice(5, 7), 16);
        const a = Number.parseInt(trimmed.slice(7, 9), 16) / 255;
        if (a < 1) {
            return `rgba(${r},${g},${b},${Math.round(a * 100) / 100})`;
        }
        return trimmed.slice(0, 7);
    }

    // Hex6 or hex3 — no alpha
    return normalizeColorToHex6(color);
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

    // Save immediately on every color change (including opacity)
    const handlePickerChange = useCallback(
        (color: string) => {
            if (!openPicker) return;
            // Use alpha-aware comparison to detect opacity changes
            const colorNorm = normalizeColorWithAlpha(color);
            const defaultNorm = normalizeColorWithAlpha(openPicker.defaultColor);
            const isChanged = colorNorm !== defaultNorm;
            if (isChanged) {
                onOverrideChange?.(openPicker.variable, color);
            } else {
                // Reverted to theme default — remove override
                onOverrideChange?.(openPicker.variable, null);
            }
            applyThemeOverrideLive(openPicker.variable, isChanged ? color : null);
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
