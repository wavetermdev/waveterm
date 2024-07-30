// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import "./toggle.less";

interface ToggleProps {
    checked: boolean;
    onChange: (value: boolean) => void;
    label?: string;
    id?: string;
}

const Toggle = ({ checked, onChange, label, id }: ToggleProps) => {
    const handleChange = (e: any) => {
        if (onChange != null) {
            onChange(e.target.checked);
        }
    };

    const inputId = id || `toggle-${Math.random().toString(36).substr(2, 9)}`;

    return (
        <div className="check-toggle-wrapper">
            <div className="checkbox-toggle">
                <input id={inputId} type="checkbox" checked={checked} onChange={handleChange} />
                <span className="slider" />
            </div>
            {label && (
                <label htmlFor={inputId} className="toggle-label">
                    {label}
                </label>
            )}
        </div>
    );
};

export { Toggle };
