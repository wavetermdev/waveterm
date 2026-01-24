// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Setting Row Component
 *
 * Renders an individual setting row with label, description, control, and reset button.
 * This component provides the visual structure for each setting in the settings list.
 */

import { ControlFactory } from "@/app/element/settings";
import { cn } from "@/util/util";
import { memo, useCallback } from "react";

export interface SettingRowProps {
    metadata: SettingMetadata;
    value: boolean | number | string | string[] | null;
    defaultValue: boolean | number | string | string[] | null;
    onChange: (value: boolean | number | string | string[] | null) => void;
    onReset: () => void;
    isModified?: boolean;
    disabled?: boolean;
}

/**
 * Individual setting row component.
 *
 * Displays a setting with:
 * - Label and optional "requires restart" badge
 * - Description text
 * - The appropriate control widget (toggle, slider, select, etc.)
 * - Reset button (visible on hover when modified)
 * - Modified indicator (yellow left border)
 */
export const SettingRow = memo(
    ({ metadata, value, defaultValue, onChange, onReset, isModified, disabled }: SettingRowProps) => {
        const handleChange = useCallback(
            (newValue: boolean | number | string | string[] | null) => {
                onChange(newValue);
            },
            [onChange]
        );

        const handleReset = useCallback(() => {
            onReset();
        }, [onReset]);

        // Determine if the current value differs from default
        const showModified = isModified ?? (value !== defaultValue && value !== undefined && value !== null);

        return (
            <div
                className={cn("setting-row", {
                    modified: showModified,
                    disabled: disabled,
                })}
                data-setting-key={metadata.key}
            >
                <div className="setting-header">
                    <div className="setting-label-container">
                        <span className="setting-label">{metadata.label}</span>
                        {metadata.requiresRestart && (
                            <span className="setting-restart-badge">Requires restart</span>
                        )}
                        {showModified && (
                            <button
                                className="setting-reset-button"
                                onClick={handleReset}
                                title="Reset to default"
                                type="button"
                            >
                                <i className="fa fa-solid fa-rotate-left" />
                            </button>
                        )}
                        <span className="setting-key">{metadata.key}</span>
                    </div>
                    <div className="setting-control-container">
                        <ControlFactory
                            metadata={metadata}
                            value={value}
                            onChange={handleChange}
                            disabled={disabled}
                        />
                    </div>
                </div>
                {metadata.description && (
                    <div className="setting-description">{metadata.description}</div>
                )}
            </div>
        );
    }
);

SettingRow.displayName = "SettingRow";
