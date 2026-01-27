// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { memo, useCallback } from "react";
import "./segmented-toggle.scss";

interface SegmentedToggleOption {
    value: string;
    label: string;
    icon?: string;
    ariaLabel?: string;
}

interface SegmentedToggleProps {
    options: SegmentedToggleOption[];
    value: string;
    onChange: (value: string) => void;
    label?: string;
    disabled?: boolean;
    ariaLabel?: string;
}

const SegmentedToggle = memo(({ options, value, onChange, label, disabled, ariaLabel }: SegmentedToggleProps) => {
    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (disabled) return;
            const currentIndex = options.findIndex((opt) => opt.value === value);
            if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                onChange(options[(currentIndex + 1) % options.length].value);
            } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                onChange(options[(currentIndex - 1 + options.length) % options.length].value);
            }
        },
        [options, value, onChange, disabled]
    );

    const buttons = (
        <div className="segmented-toggle" role="radiogroup" aria-label={ariaLabel} onKeyDown={handleKeyDown}>
            {options.map((option) => (
                <button
                    key={option.value}
                    type="button"
                    className={cn("segmented-toggle-btn", { selected: value === option.value })}
                    onClick={() => !disabled && onChange(option.value)}
                    role="radio"
                    aria-checked={value === option.value}
                    aria-label={option.ariaLabel}
                    tabIndex={value === option.value ? 0 : -1}
                    disabled={disabled}
                >
                    {option.icon && <i className={`fa fa-solid fa-${option.icon}`} />}
                    <span>{option.label}</span>
                </button>
            ))}
        </div>
    );

    if (label) {
        return (
            <div className={cn("segmented-toggle-row", { disabled })}>
                <span className="segmented-toggle-label">{label}</span>
                {buttons}
            </div>
        );
    }

    return buttons;
});

SegmentedToggle.displayName = "SegmentedToggle";

export { SegmentedToggle };
export type { SegmentedToggleOption, SegmentedToggleProps };
