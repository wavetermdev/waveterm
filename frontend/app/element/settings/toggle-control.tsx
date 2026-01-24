// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { memo, useCallback, useId, useRef } from "react";

interface ToggleControlProps {
    value: boolean;
    onChange: (value: boolean) => void;
    disabled?: boolean;
    className?: string;
}

const ToggleControl = memo(({ value, onChange, disabled, className }: ToggleControlProps) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const inputId = useId();

    const handleChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            if (!disabled) {
                onChange(e.target.checked);
            }
        },
        [onChange, disabled]
    );

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLLabelElement>) => {
            if (disabled) return;
            if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                onChange(!value);
            }
        },
        [onChange, value, disabled]
    );

    return (
        <label
            htmlFor={inputId}
            className={cn("setting-toggle", className, { disabled })}
            onKeyDown={handleKeyDown}
            tabIndex={disabled ? -1 : 0}
            role="switch"
            aria-checked={value}
        >
            <input
                id={inputId}
                type="checkbox"
                checked={value}
                onChange={handleChange}
                ref={inputRef}
                disabled={disabled}
                tabIndex={-1}
            />
            <span className="setting-toggle-slider" />
        </label>
    );
});

ToggleControl.displayName = "ToggleControl";

export { ToggleControl };
export type { ToggleControlProps };
