// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { memo, useCallback, useMemo } from "react";

interface SliderControlProps {
    value: number;
    onChange: (value: number) => void;
    min?: number;
    max?: number;
    step?: number;
    disabled?: boolean;
    className?: string;
    /** Number of decimal places to show */
    precision?: number;
    /** Optional unit label (e.g., "px", "%") */
    unit?: string;
}

const SliderControl = memo(
    ({ value, onChange, min = 0, max = 100, step = 1, disabled, className, precision, unit }: SliderControlProps) => {
        const handleChange = useCallback(
            (e: React.ChangeEvent<HTMLInputElement>) => {
                const newValue = parseFloat(e.target.value);
                onChange(newValue);
            },
            [onChange]
        );

        // Calculate precision based on step if not provided
        const displayPrecision = useMemo(() => {
            if (precision !== undefined) return precision;
            const stepStr = step.toString();
            const decimalIndex = stepStr.indexOf(".");
            return decimalIndex === -1 ? 0 : stepStr.length - decimalIndex - 1;
        }, [step, precision]);

        const displayValue = useMemo(() => {
            const formatted = value?.toFixed(displayPrecision) ?? min.toFixed(displayPrecision);
            return unit ? `${formatted}${unit}` : formatted;
        }, [value, displayPrecision, unit, min]);

        // Calculate fill percentage for visual feedback
        const fillPercentage = useMemo(() => {
            const range = max - min;
            if (range === 0) return 0;
            return ((value - min) / range) * 100;
        }, [value, min, max]);

        return (
            <div className={cn("setting-slider", className, { disabled })}>
                <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={value ?? min}
                    onChange={handleChange}
                    disabled={disabled}
                    className="setting-slider-input"
                    style={
                        {
                            "--slider-fill": `${fillPercentage}%`,
                        } as React.CSSProperties
                    }
                />
                <span className="setting-slider-value">{displayValue}</span>
            </div>
        );
    }
);

SliderControl.displayName = "SliderControl";

export { SliderControl };
export type { SliderControlProps };
