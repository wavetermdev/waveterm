// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { memo, useCallback, useState } from "react";

interface TextControlProps {
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
    className?: string;
    placeholder?: string;
    pattern?: string;
    maxLength?: number;
    /** If true, shows a multiline textarea */
    multiline?: boolean;
    rows?: number;
}

const TextControl = memo(
    ({
        value,
        onChange,
        disabled,
        className,
        placeholder,
        pattern,
        maxLength,
        multiline,
        rows = 3,
    }: TextControlProps) => {
        const [isValid, setIsValid] = useState(true);

        const handleChange = useCallback(
            (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
                const newValue = e.target.value;

                // Validate against pattern if provided
                if (pattern) {
                    const regex = new RegExp(pattern);
                    setIsValid(regex.test(newValue) || newValue === "");
                }

                onChange(newValue);
            },
            [onChange, pattern]
        );

        const commonProps = {
            value: value ?? "",
            onChange: handleChange,
            disabled,
            placeholder,
            maxLength,
            className: cn("setting-text-input", { invalid: !isValid }),
        };

        if (multiline) {
            return (
                <div className={cn("setting-text", className, { disabled })}>
                    <textarea {...commonProps} rows={rows} />
                </div>
            );
        }

        return (
            <div className={cn("setting-text", className, { disabled })}>
                <input type="text" {...commonProps} />
            </div>
        );
    }
);

TextControl.displayName = "TextControl";

export { TextControl };
export type { TextControlProps };
