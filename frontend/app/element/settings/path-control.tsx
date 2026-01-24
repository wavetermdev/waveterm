// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { memo, useCallback } from "react";

interface PathControlProps {
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
    className?: string;
    placeholder?: string;
    /** Whether to show a browse button */
    showBrowse?: boolean;
    /** Callback when browse button is clicked (should open file dialog via IPC) */
    onBrowse?: () => void;
}

const PathControl = memo(
    ({
        value,
        onChange,
        disabled,
        className,
        placeholder = "Enter file path...",
        showBrowse = true,
        onBrowse,
    }: PathControlProps) => {
        const handleChange = useCallback(
            (e: React.ChangeEvent<HTMLInputElement>) => {
                onChange(e.target.value);
            },
            [onChange]
        );

        const handleBrowseClick = useCallback(() => {
            if (onBrowse && !disabled) {
                onBrowse();
            }
        }, [onBrowse, disabled]);

        return (
            <div className={cn("setting-path", className, { disabled })}>
                <input
                    type="text"
                    value={value ?? ""}
                    onChange={handleChange}
                    disabled={disabled}
                    placeholder={placeholder}
                    className="setting-path-input"
                />
                {showBrowse && (
                    <button
                        type="button"
                        className="setting-path-browse"
                        onClick={handleBrowseClick}
                        disabled={disabled || !onBrowse}
                        aria-label="Browse for file"
                    >
                        <i className="fa fa-solid fa-folder-open" />
                    </button>
                )}
            </div>
        );
    }
);

PathControl.displayName = "PathControl";

export { PathControl };
export type { PathControlProps };
