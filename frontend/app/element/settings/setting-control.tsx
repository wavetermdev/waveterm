// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { memo, useCallback } from "react";

import "./settings-controls.scss";

export interface SettingControlProps {
    settingKey: string;
    label: string;
    /** Description can be a string or a React node (for linked descriptions) */
    description: string | React.ReactNode;
    value: boolean | number | string | string[] | object | null;
    defaultValue: boolean | number | string | string[] | object | null;
    onChange: (value: boolean | number | string | string[] | object | null) => void;
    isModified: boolean;
    disabled?: boolean;
    requiresRestart?: boolean;
    /** If true, control spans full width below the label/description */
    fullWidth?: boolean;
    children: React.ReactNode;
}

const SettingControl = memo(
    ({
        settingKey,
        label,
        description,
        value,
        defaultValue,
        onChange,
        isModified,
        disabled,
        requiresRestart,
        fullWidth,
        children,
    }: SettingControlProps) => {
        const handleReset = useCallback(() => {
            onChange(defaultValue);
        }, [onChange, defaultValue]);

        return (
            <div
                className={cn("setting-row", {
                    modified: isModified,
                    disabled: disabled,
                    "full-width": fullWidth,
                })}
                data-setting-key={settingKey}
            >
                <div className="setting-header">
                    <div className="setting-label-container">
                        <span className="setting-label">{label}</span>
                        {requiresRestart && <span className="setting-restart-badge">Requires restart</span>}
                        {isModified && (
                            <button
                                className="setting-reset-button"
                                onClick={handleReset}
                                title="Reset to default"
                                type="button"
                            >
                                <i className="fa fa-solid fa-rotate-left" />
                            </button>
                        )}
                    </div>
                    {!fullWidth && <div className="setting-control-container">{children}</div>}
                </div>
                {description && <div className="setting-description">{description}</div>}
                {fullWidth && <div className="setting-control-container full-width-control">{children}</div>}
            </div>
        );
    }
);

SettingControl.displayName = "SettingControl";

export { SettingControl };
