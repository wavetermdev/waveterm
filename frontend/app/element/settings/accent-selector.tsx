// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import "./accent-selector.scss";

export type AccentSelectorProps = {
    value: string;
    onChange: (value: string) => void;
    customAccents?: Record<string, { label: string; overrides: Record<string, string> }>;
    themeOverrides?: Record<string, string>;
    onSaveCustomAccent?: (name: string, overrides: Record<string, string>) => void;
    onDeleteCustomAccent?: (id: string) => void;
};

interface AccentOption {
    value: string;
    label: string;
    darkColor: string;
    lightColor: string;
}

const ACCENT_OPTIONS: AccentOption[] = [
    { value: "green", label: "Green", darkColor: "rgb(88, 193, 66)", lightColor: "rgb(46, 160, 67)" },
    { value: "warm", label: "Warm", darkColor: "rgb(200, 145, 60)", lightColor: "rgb(140, 100, 40)" },
    { value: "blue", label: "Blue", darkColor: "rgb(70, 140, 220)", lightColor: "rgb(30, 100, 180)" },
    { value: "purple", label: "Purple", darkColor: "rgb(160, 100, 220)", lightColor: "rgb(120, 70, 180)" },
    { value: "teal", label: "Teal", darkColor: "rgb(50, 190, 180)", lightColor: "rgb(20, 150, 140)" },
];

function getSwatchColor(option: AccentOption): string {
    const theme = document.documentElement.getAttribute("data-theme");
    return theme === "light" ? option.lightColor : option.darkColor;
}

/**
 * Returns a representative color for a custom accent's swatch.
 * Uses the --accent-color override if present, otherwise a default gray.
 */
function getCustomSwatchColor(overrides: Record<string, string>): string {
    return overrides["--accent-color"] || "rgb(128, 128, 128)";
}

const AccentSelector = memo(
    ({
        value,
        onChange,
        customAccents,
        themeOverrides,
        onSaveCustomAccent,
        onDeleteCustomAccent,
    }: AccentSelectorProps) => {
        const handleSelect = useCallback(
            (accent: string) => {
                onChange(accent);
            },
            [onChange]
        );

        // Re-render swatches when data-theme changes so colors match the current mode
        const [, setThemeTick] = useState(0);
        const observerRef = useRef<MutationObserver | null>(null);
        useEffect(() => {
            observerRef.current = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    if (mutation.attributeName === "data-theme") {
                        setThemeTick((t) => t + 1);
                        break;
                    }
                }
            });
            observerRef.current.observe(document.documentElement, {
                attributes: true,
                attributeFilter: ["data-theme"],
            });
            return () => observerRef.current?.disconnect();
        }, []);

        const handleAdd = useCallback(() => {
            if (!onSaveCustomAccent || !themeOverrides) return;
            const hasOverrides = Object.keys(themeOverrides).length > 0;
            if (!hasOverrides) {
                alert("Customize some palette colors first using the Color Palette swatches above, then save as a custom accent.");
                return;
            }
            const name = prompt("Name your custom accent theme:");
            if (name && name.trim()) {
                onSaveCustomAccent(name.trim(), { ...themeOverrides });
            }
        }, [onSaveCustomAccent, themeOverrides]);

        const handleDelete = useCallback(
            (id: string, event: React.MouseEvent) => {
                event.stopPropagation();
                onDeleteCustomAccent?.(id);
            },
            [onDeleteCustomAccent]
        );

        return (
            <div className="accent-selector" role="radiogroup" aria-label="Accent color">
                {ACCENT_OPTIONS.map((option) => (
                    <button
                        key={option.value}
                        type="button"
                        className={cn("accent-card", { selected: value === option.value })}
                        onClick={() => handleSelect(option.value)}
                        role="radio"
                        aria-checked={value === option.value}
                        aria-label={`${option.label} accent color`}
                    >
                        <div className="accent-swatch" style={{ backgroundColor: getSwatchColor(option) }} />
                        <span className="accent-label">{option.label}</span>
                        {value === option.value && (
                            <span className="accent-check">
                                <i className="fa fa-solid fa-check" />
                            </span>
                        )}
                    </button>
                ))}

                {/* Custom accent cards */}
                {customAccents &&
                    Object.entries(customAccents).map(([id, custom]) => {
                        const customValue = `custom:${id}`;
                        return (
                            <div
                                key={customValue}
                                className={cn("accent-card accent-card--custom", {
                                    selected: value === customValue,
                                })}
                                onClick={() => handleSelect(customValue)}
                                role="radio"
                                tabIndex={0}
                                aria-checked={value === customValue}
                                aria-label={`${custom.label} custom accent color`}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault();
                                        handleSelect(customValue);
                                    }
                                }}
                            >
                                <div
                                    className="accent-swatch"
                                    style={{ backgroundColor: getCustomSwatchColor(custom.overrides) }}
                                />
                                <span className="accent-label">{custom.label}</span>
                                {value === customValue && (
                                    <span className="accent-check">
                                        <i className="fa fa-solid fa-check" />
                                    </span>
                                )}
                                {onDeleteCustomAccent && (
                                    <button
                                        className="accent-delete"
                                        onClick={(e) => handleDelete(id, e)}
                                        title={`Delete ${custom.label}`}
                                        aria-label={`Delete ${custom.label} custom accent`}
                                    >
                                        <i className="fa fa-solid fa-trash" />
                                    </button>
                                )}
                            </div>
                        );
                    })}

                {/* Add custom accent card */}
                {onSaveCustomAccent && (
                    <button
                        className="accent-card accent-card--add"
                        onClick={handleAdd}
                        type="button"
                        aria-label="Add custom accent theme"
                    >
                        <div className="accent-swatch accent-swatch--add">
                            <i className="fa fa-solid fa-plus" />
                        </div>
                        <span className="accent-label">Add</span>
                    </button>
                )}
            </div>
        );
    }
);

AccentSelector.displayName = "AccentSelector";

export { AccentSelector };
