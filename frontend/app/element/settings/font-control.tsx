// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { memo, useCallback, useMemo } from "react";

interface FontControlProps {
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
    className?: string;
    placeholder?: string;
    /** If true, shows a preview of the font */
    showPreview?: boolean;
    /** Preview text to display */
    previewText?: string;
}

const FontControl = memo(
    ({
        value,
        onChange,
        disabled,
        className,
        placeholder = "Enter font family...",
        showPreview = true,
        previewText = "The quick brown fox jumps over the lazy dog",
    }: FontControlProps) => {
        const handleChange = useCallback(
            (e: React.ChangeEvent<HTMLInputElement>) => {
                onChange(e.target.value);
            },
            [onChange]
        );

        const fontStyle = useMemo(
            () => ({
                fontFamily: value || "inherit",
            }),
            [value]
        );

        return (
            <div className={cn("setting-font", className, { disabled })}>
                <div className="setting-font-input-row">
                    <input
                        type="text"
                        value={value ?? ""}
                        onChange={handleChange}
                        disabled={disabled}
                        placeholder={placeholder}
                        className="setting-font-input"
                    />
                </div>
                {showPreview && value && (
                    <div className="setting-font-preview" style={fontStyle}>
                        {previewText}
                    </div>
                )}
            </div>
        );
    }
);

FontControl.displayName = "FontControl";

export { FontControl };
export type { FontControlProps };
