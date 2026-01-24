// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { memo, useCallback, useState } from "react";

interface NumberControlProps {
    value: number;
    onChange: (value: number) => void;
    min?: number;
    max?: number;
    step?: number;
    disabled?: boolean;
    className?: string;
    placeholder?: string;
}

const NumberControl = memo(
    ({ value, onChange, min, max, step = 1, disabled, className, placeholder }: NumberControlProps) => {
        const [inputValue, setInputValue] = useState<string>(value?.toString() ?? "");

        const clampValue = useCallback(
            (val: number): number => {
                let clamped = val;
                if (min !== undefined && clamped < min) clamped = min;
                if (max !== undefined && clamped > max) clamped = max;
                return clamped;
            },
            [min, max]
        );

        const handleInputChange = useCallback(
            (e: React.ChangeEvent<HTMLInputElement>) => {
                const raw = e.target.value;
                setInputValue(raw);

                // Allow empty or just a minus sign during typing
                if (raw === "" || raw === "-") {
                    return;
                }

                const parsed = parseFloat(raw);
                if (!isNaN(parsed)) {
                    onChange(clampValue(parsed));
                }
            },
            [onChange, clampValue]
        );

        const handleBlur = useCallback(() => {
            const parsed = parseFloat(inputValue);
            if (isNaN(parsed)) {
                setInputValue(value?.toString() ?? "");
            } else {
                const clamped = clampValue(parsed);
                setInputValue(clamped.toString());
                onChange(clamped);
            }
        }, [inputValue, value, onChange, clampValue]);

        const handleIncrement = useCallback(() => {
            if (disabled) return;
            const newValue = clampValue((value ?? 0) + step);
            setInputValue(newValue.toString());
            onChange(newValue);
        }, [value, step, onChange, clampValue, disabled]);

        const handleDecrement = useCallback(() => {
            if (disabled) return;
            const newValue = clampValue((value ?? 0) - step);
            setInputValue(newValue.toString());
            onChange(newValue);
        }, [value, step, onChange, clampValue, disabled]);

        const handleKeyDown = useCallback(
            (e: React.KeyboardEvent<HTMLInputElement>) => {
                if (e.key === "ArrowUp") {
                    e.preventDefault();
                    handleIncrement();
                } else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    handleDecrement();
                }
            },
            [handleIncrement, handleDecrement]
        );

        // Sync internal state when external value changes
        const displayValue = inputValue;
        if (value?.toString() !== inputValue && document.activeElement !== document.querySelector("input:focus")) {
            // Only sync if not focused
        }

        return (
            <div className={cn("setting-number", className, { disabled })}>
                <button
                    type="button"
                    className="setting-number-button"
                    onClick={handleDecrement}
                    disabled={disabled || (min !== undefined && value <= min)}
                    tabIndex={-1}
                    aria-label="Decrease value"
                >
                    <i className="fa fa-solid fa-minus" />
                </button>
                <input
                    type="text"
                    inputMode="numeric"
                    value={displayValue}
                    onChange={handleInputChange}
                    onBlur={handleBlur}
                    onKeyDown={handleKeyDown}
                    disabled={disabled}
                    placeholder={placeholder}
                    className="setting-number-input"
                />
                <button
                    type="button"
                    className="setting-number-button"
                    onClick={handleIncrement}
                    disabled={disabled || (max !== undefined && value >= max)}
                    tabIndex={-1}
                    aria-label="Increase value"
                >
                    <i className="fa fa-solid fa-plus" />
                </button>
            </div>
        );
    }
);

NumberControl.displayName = "NumberControl";

export { NumberControl };
export type { NumberControlProps };
