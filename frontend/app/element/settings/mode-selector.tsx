// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { memo, useCallback } from "react";
import "./mode-selector.scss";

interface ModeSelectorProps {
    value: string;
    onChange: (value: string) => void;
}

const MODE_OPTIONS = [
    { value: "dark", label: "Dark", icon: "moon" },
    { value: "light", label: "Light", icon: "sun" },
    { value: "system", label: "System", icon: "desktop" },
] as const;

const ModeSelector = memo(({ value, onChange }: ModeSelectorProps) => {
    const handleSelect = useCallback(
        (mode: string) => {
            onChange(mode);
        },
        [onChange]
    );

    return (
        <div className="mode-selector" role="radiogroup" aria-label="Theme mode">
            {MODE_OPTIONS.map((option) => (
                <button
                    key={option.value}
                    type="button"
                    className={cn("mode-selector-button", {
                        selected: value === option.value,
                    })}
                    onClick={() => handleSelect(option.value)}
                    role="radio"
                    aria-checked={value === option.value}
                >
                    <i className={`fa fa-solid fa-${option.icon}`} />
                    <span className="mode-selector-label">{option.label}</span>
                </button>
            ))}
        </div>
    );
});

ModeSelector.displayName = "ModeSelector";

export { ModeSelector };
export type { ModeSelectorProps };
