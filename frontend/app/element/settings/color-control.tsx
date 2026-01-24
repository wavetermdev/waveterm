// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { memo, useCallback, useId, useRef, useState } from "react";

interface ColorControlProps {
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
    className?: string;
    /** Show text input alongside color picker */
    showInput?: boolean;
}

const ColorControl = memo(({ value, onChange, disabled, className, showInput = true }: ColorControlProps) => {
    const colorInputRef = useRef<HTMLInputElement>(null);
    const inputId = useId();
    const [textValue, setTextValue] = useState(value ?? "");

    const handleColorChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const newValue = e.target.value;
            setTextValue(newValue);
            onChange(newValue);
        },
        [onChange]
    );

    const handleTextChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const newValue = e.target.value;
            setTextValue(newValue);

            // Validate hex color format before updating
            if (/^#[0-9A-Fa-f]{6}$/.test(newValue) || /^#[0-9A-Fa-f]{3}$/.test(newValue)) {
                onChange(newValue);
            }
        },
        [onChange]
    );

    const handleTextBlur = useCallback(() => {
        // On blur, reset to valid value if invalid
        if (!/^#[0-9A-Fa-f]{6}$/.test(textValue) && !/^#[0-9A-Fa-f]{3}$/.test(textValue)) {
            setTextValue(value ?? "#000000");
        }
    }, [textValue, value]);

    const handleSwatchClick = useCallback(() => {
        colorInputRef.current?.click();
    }, []);

    const handleSwatchKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLButtonElement>) => {
            if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                colorInputRef.current?.click();
            }
        },
        []
    );

    // Normalize color for display (ensure it's a valid hex)
    const displayColor = /^#[0-9A-Fa-f]{6}$/.test(value) || /^#[0-9A-Fa-f]{3}$/.test(value) ? value : "#000000";

    return (
        <div className={cn("setting-color", className, { disabled })}>
            <button
                type="button"
                className="setting-color-swatch"
                style={{ backgroundColor: displayColor }}
                onClick={handleSwatchClick}
                onKeyDown={handleSwatchKeyDown}
                disabled={disabled}
                aria-label="Choose color"
                tabIndex={0}
            />
            <input
                ref={colorInputRef}
                id={inputId}
                type="color"
                value={displayColor}
                onChange={handleColorChange}
                disabled={disabled}
                className="setting-color-picker"
                tabIndex={-1}
            />
            {showInput && (
                <input
                    type="text"
                    value={textValue}
                    onChange={handleTextChange}
                    onBlur={handleTextBlur}
                    disabled={disabled}
                    placeholder="#000000"
                    className="setting-color-input"
                    maxLength={7}
                />
            )}
        </div>
    );
});

ColorControl.displayName = "ColorControl";

export { ColorControl };
export type { ColorControlProps };
