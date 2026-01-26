// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { memo, useCallback, useEffect, useState } from "react";
import "./theme-palette-preview.scss";

interface PaletteColor {
    label: string;
    variable: string;
    computedValue: string;
}

const PALETTE_VARIABLES = [
    { label: "Background", variable: "--main-bg-color" },
    { label: "Text", variable: "--main-text-color" },
    { label: "Accent", variable: "--accent-color" },
    { label: "Border", variable: "--border-color" },
    { label: "Link", variable: "--link-color" },
    { label: "Error", variable: "--error-color" },
    { label: "Warning", variable: "--warning-color" },
    { label: "Success", variable: "--success-color" },
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

const ThemePalettePreview = memo(() => {
    const [colors, setColors] = useState<PaletteColor[]>(() => readPaletteColors());

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

    return (
        <div className="palette-preview">
            <div className="palette-swatches">
                {colors.map((color) => (
                    <div key={color.variable} className="palette-swatch-item">
                        <div
                            className="palette-swatch"
                            style={{ backgroundColor: color.computedValue }}
                            title={`${color.variable}: ${color.computedValue}`}
                        />
                        <span className="palette-swatch-label">{color.label}</span>
                    </div>
                ))}
            </div>
        </div>
    );
});

ThemePalettePreview.displayName = "ThemePalettePreview";

export { ThemePalettePreview };
