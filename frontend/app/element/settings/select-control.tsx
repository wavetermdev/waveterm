// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { memo, useCallback } from "react";

interface SelectOption {
    value: string;
    label: string;
}

interface SelectControlProps {
    value: string;
    onChange: (value: string) => void;
    options: SelectOption[];
    disabled?: boolean;
    className?: string;
    placeholder?: string;
}

const SelectControl = memo(
    ({ value, onChange, options, disabled, className, placeholder }: SelectControlProps) => {
        const handleChange = useCallback(
            (e: React.ChangeEvent<HTMLSelectElement>) => {
                onChange(e.target.value);
            },
            [onChange]
        );

        return (
            <div className={cn("setting-select", className, { disabled })}>
                <select
                    value={value ?? ""}
                    onChange={handleChange}
                    disabled={disabled}
                    className="setting-select-input"
                >
                    {placeholder && (
                        <option value="" disabled>
                            {placeholder}
                        </option>
                    )}
                    {options.map((option) => (
                        <option key={option.value} value={option.value}>
                            {option.label}
                        </option>
                    ))}
                </select>
                <i className="fa fa-solid fa-chevron-down setting-select-icon" />
            </div>
        );
    }
);

SelectControl.displayName = "SelectControl";

export { SelectControl };
export type { SelectControlProps, SelectOption };
