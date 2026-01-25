// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Preview Background Toggle Component
 *
 * Allows users to preview theme cards on different background colors:
 * - Dark: Preview all themes on dark background (#1a1a1a)
 * - Light: Preview all themes on light background (#fafafa)
 * - Split: Show each theme card split 50/50 (left dark, right light)
 */

import { cn } from "@/util/util";
import { memo, useCallback } from "react";

import "./preview-background-toggle.scss";

export type PreviewBackground = "dark" | "light" | "split";

export interface PreviewBackgroundToggleProps {
    value: PreviewBackground;
    onChange: (value: PreviewBackground) => void;
    disabled?: boolean;
}

interface ToggleOption {
    value: PreviewBackground;
    label: string;
    icon: string;
    ariaLabel: string;
}

const TOGGLE_OPTIONS: ToggleOption[] = [
    { value: "dark", label: "Dark", icon: "fa-moon", ariaLabel: "Preview on dark background" },
    { value: "light", label: "Light", icon: "fa-sun", ariaLabel: "Preview on light background" },
    { value: "split", label: "Split", icon: "fa-circle-half-stroke", ariaLabel: "Preview on split dark/light background" },
];

export const PreviewBackgroundToggle = memo(({ value, onChange, disabled }: PreviewBackgroundToggleProps) => {
    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLDivElement>) => {
            if (disabled) return;

            const currentIndex = TOGGLE_OPTIONS.findIndex((opt) => opt.value === value);

            if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                const nextIndex = (currentIndex + 1) % TOGGLE_OPTIONS.length;
                onChange(TOGGLE_OPTIONS[nextIndex].value);
            } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                const prevIndex = (currentIndex - 1 + TOGGLE_OPTIONS.length) % TOGGLE_OPTIONS.length;
                onChange(TOGGLE_OPTIONS[prevIndex].value);
            }
        },
        [value, onChange, disabled]
    );

    return (
        <div className={cn("preview-bg-toggle", { disabled })}>
            <span className="toggle-label">Preview Background:</span>
            <div
                className="toggle-buttons"
                role="radiogroup"
                aria-label="Preview background mode"
                onKeyDown={handleKeyDown}
            >
                {TOGGLE_OPTIONS.map((option) => (
                    <button
                        key={option.value}
                        type="button"
                        className={cn("toggle-btn", { active: value === option.value })}
                        onClick={() => !disabled && onChange(option.value)}
                        role="radio"
                        aria-checked={value === option.value}
                        aria-label={option.ariaLabel}
                        tabIndex={value === option.value ? 0 : -1}
                        disabled={disabled}
                    >
                        <i className={`fa fa-solid ${option.icon}`} />
                        <span>{option.label}</span>
                    </button>
                ))}
            </div>
        </div>
    );
});

PreviewBackgroundToggle.displayName = "PreviewBackgroundToggle";
