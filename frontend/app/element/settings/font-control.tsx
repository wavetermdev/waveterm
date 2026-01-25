// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { memo, useEffect, useMemo, useState } from "react";

// Extend window type for Font Access API
declare global {
    interface Window {
        queryLocalFonts?: () => Promise<FontData[]>;
    }
    interface FontData {
        family: string;
        fullName: string;
        postscriptName: string;
        style: string;
    }
}

// Patterns that indicate a monospace font
const MONO_PATTERNS = [
    /mono/i,
    /console/i,
    /code/i,
    /courier/i,
    /fixed/i,
    /terminal/i,
    /typewriter/i,
    /nerd\s*font/i,
    /\bNF\b/, // Nerd Font abbreviation
    /hack/i,
    /fira/i,
    /source\s*code/i,
    /jetbrains/i,
    /cascadia/i,
    /inconsolata/i,
    /menlo/i,
    /monaco/i,
    /consolas/i,
    /liberation/i,
    /dejavu\s*sans/i,
    /ubuntu\s*mono/i,
    /roboto\s*mono/i,
    /ibm\s*plex\s*mono/i,
    /iosevka/i,
    /pragmata/i,
    /input/i,
    /dank/i,
    /operator/i,
    /victor/i,
    /fantasque/i,
    /anonymous/i,
];

/**
 * Check if a font family name suggests it's a monospace font
 */
function isMonospaceFont(family: string): boolean {
    return MONO_PATTERNS.some((pattern) => pattern.test(family));
}

/**
 * Check if a font is a Nerd Font (higher priority)
 */
function isNerdFont(family: string): boolean {
    return /nerd\s*font/i.test(family) || /\bNF\b/.test(family);
}

interface FontControlProps {
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
    className?: string;
    placeholder?: string;
    /** If true, shows a preview of the font */
    showPreview?: boolean;
    /** Preview text to display */
    previewText?: string;
}

const FontControl = memo(
    ({
        value,
        onChange,
        disabled,
        className,
        placeholder = "Select font...",
        showPreview = true,
        previewText = "The quick brown fox jumps over the lazy dog",
    }: FontControlProps) => {
        const [systemFonts, setSystemFonts] = useState<string[]>([]);
        const [isLoading, setIsLoading] = useState(true);

        // Query system fonts using Font Access API
        useEffect(() => {
            const loadFonts = async () => {
                try {
                    if (window.queryLocalFonts) {
                        const fonts = await window.queryLocalFonts();
                        // Get unique font families
                        const allFamilies = [...new Set(fonts.map((f) => f.family))];
                        // Filter to monospace fonts only
                        const monoFonts = allFamilies.filter(isMonospaceFont);
                        // Sort: Nerd Fonts first, then alphabetically
                        monoFonts.sort((a, b) => {
                            const aIsNerd = isNerdFont(a);
                            const bIsNerd = isNerdFont(b);
                            if (aIsNerd && !bIsNerd) return -1;
                            if (!aIsNerd && bIsNerd) return 1;
                            return a.localeCompare(b);
                        });
                        setSystemFonts(monoFonts);
                    } else {
                        console.warn("Font Access API not available");
                        setSystemFonts([]);
                    }
                } catch (e) {
                    // User may have denied permission or API not available
                    console.error("Failed to query fonts:", e);
                    setSystemFonts([]);
                }
                setIsLoading(false);
            };
            loadFonts();
        }, []);

        const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
            onChange(e.target.value);
        };

        const fontStyle = useMemo(
            () => ({
                fontFamily: value ? `"${value}", monospace` : "inherit",
            }),
            [value]
        );

        return (
            <div className={cn("setting-font", className, { disabled })}>
                <div className="setting-select">
                    <select
                        value={value || ""}
                        onChange={handleChange}
                        disabled={disabled || isLoading}
                        className="setting-select-input setting-font-select"
                    >
                        <option value="">
                            {isLoading ? "Loading fonts..." : placeholder}
                        </option>
                        {systemFonts.map((font) => (
                            <option key={font} value={font}>
                                {font}
                            </option>
                        ))}
                    </select>
                    <i className="fa fa-solid fa-chevron-down setting-select-icon" />
                </div>

                {showPreview && value && (
                    <div className="setting-font-preview" style={fontStyle}>
                        {previewText}
                    </div>
                )}
            </div>
        );
    }
);

FontControl.displayName = "FontControl";

export { FontControl };
export type { FontControlProps };
