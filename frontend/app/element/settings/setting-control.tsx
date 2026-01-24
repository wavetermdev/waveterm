// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { memo, useCallback } from "react";

import "./settings-controls.scss";

interface SettingControlProps {
    settingKey: string;
    label: string;
    description: string;
    value: boolean | number | string | string[] | null;
    defaultValue: boolean | number | string | string[] | null;
    onChange: (value: boolean | number | string | string[] | null) => void;
    isModified: boolean;
    disabled?: boolean;
    requiresRestart?: boolean;
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
                    <div className="setting-control-container">{children}</div>
                </div>
                {description && <div className="setting-description">{description}</div>}
            </div>
        );
    }
);

SettingControl.displayName = "SettingControl";

export { SettingControl };
export type { SettingControlProps };
