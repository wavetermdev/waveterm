// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { memo, useCallback } from "react";
import "./accent-selector.scss";

export type AccentSelectorProps = {
    value: string;
    onChange: (value: string) => void;
};

interface AccentOption {
    value: string;
    label: string;
    color: string;
}

const ACCENT_OPTIONS: AccentOption[] = [
    { value: "green", label: "Green", color: "rgb(88, 193, 66)" },
    { value: "warm", label: "Warm", color: "rgb(200, 145, 60)" },
    { value: "blue", label: "Blue", color: "rgb(70, 140, 220)" },
    { value: "purple", label: "Purple", color: "rgb(160, 100, 220)" },
    { value: "teal", label: "Teal", color: "rgb(50, 190, 180)" },
];

const AccentSelector = memo(({ value, onChange }: AccentSelectorProps) => {
    const handleSelect = useCallback(
        (accent: string) => {
            onChange(accent);
        },
        [onChange]
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
                    <div className="accent-swatch" style={{ backgroundColor: option.color }} />
                    <span className="accent-label">{option.label}</span>
                    {value === option.value && (
                        <span className="accent-check">
                            <i className="fa fa-solid fa-check" />
                        </span>
                    )}
                </button>
            ))}
        </div>
    );
});

AccentSelector.displayName = "AccentSelector";

export { AccentSelector };
