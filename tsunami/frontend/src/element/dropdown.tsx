// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { twMerge } from 'tailwind-merge';

export interface DropdownOption {
    label: string;
    value: string;
    disabled?: boolean;
}

export interface DropdownProps {
    options?: DropdownOption[];
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    style?: React.CSSProperties;
    className?: string;
    multiple?: boolean;
}

export function Dropdown({ 
    options = [], 
    value, 
    placeholder = "Select an option...", 
    disabled = false, 
    style, 
    className,
    multiple = false
}: DropdownProps) {
    const baseClasses = twMerge(
        "w-full px-3 py-2 rounded border bg-panel text-foreground border-border",
        "focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        "cursor-pointer",
        className
    );

    return (
        <select
            className={baseClasses}
            style={style}
            value={value || ""}
            disabled={disabled}
            multiple={multiple}
        >
            {!multiple && placeholder && (
                <option value="" disabled>
                    {placeholder}
                </option>
            )}
            {options.map((option, index) => (
                <option
                    key={`${option.value}-${index}`}
                    value={option.value}
                    disabled={option.disabled}
                >
                    {option.label}
                </option>
            ))}
        </select>
    );
}
