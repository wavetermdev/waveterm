// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Settings Search Input Component
 *
 * A search input for filtering settings with keyboard shortcuts support.
 */

import { cn } from "@/util/util";
import { memo, useCallback, useEffect, useRef } from "react";

interface SettingsSearchInputProps {
    value: string;
    onChange: (value: string) => void;
    resultCount?: number;
    placeholder?: string;
    className?: string;
}

export const SettingsSearchInput = memo(
    ({ value, onChange, resultCount, placeholder = "Search settings...", className }: SettingsSearchInputProps) => {
        const inputRef = useRef<HTMLInputElement>(null);

        // Cmd/Ctrl+F focuses search, Escape clears and blurs
        useEffect(() => {
            const handleKeyDown = (e: KeyboardEvent) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "f") {
                    e.preventDefault();
                    inputRef.current?.focus();
                }
                if (e.key === "Escape" && document.activeElement === inputRef.current) {
                    onChange("");
                    inputRef.current?.blur();
                }
            };

            window.addEventListener("keydown", handleKeyDown);
            return () => window.removeEventListener("keydown", handleKeyDown);
        }, [onChange]);

        const handleClear = useCallback(() => {
            onChange("");
            inputRef.current?.focus();
        }, [onChange]);

        const handleInputChange = useCallback(
            (e: React.ChangeEvent<HTMLInputElement>) => {
                onChange(e.target.value);
            },
            [onChange]
        );

        return (
            <div className={cn("settings-search-input", className)}>
                <i className="fa fa-search search-icon" />
                <input
                    ref={inputRef}
                    type="text"
                    value={value}
                    onChange={handleInputChange}
                    placeholder={placeholder}
                    className="search-input"
                />
                {value && (
                    <>
                        {resultCount !== undefined && <span className="result-count">{resultCount} results</span>}
                        <button className="clear-btn" onClick={handleClear} type="button" aria-label="Clear search">
                            <i className="fa fa-times" />
                        </button>
                    </>
                )}
            </div>
        );
    }
);

SettingsSearchInput.displayName = "SettingsSearchInput";
