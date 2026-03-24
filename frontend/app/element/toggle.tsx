// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useRef } from "react";
import { cn } from "@/util/util";
import "./toggle.scss";

interface ToggleProps {
    checked: boolean;
    onChange: (value: boolean) => void;
    label?: string;
    id?: string;
    className?: string;
}

const Toggle = ({ checked, onChange, label, id, className }: ToggleProps) => {
    const inputRef = useRef<HTMLInputElement>(null);

    const handleChange = (e: any) => {
        if (onChange != null) {
            onChange(e.target.checked);
        }
    };

    const handleLabelClick = () => {
        if (inputRef.current) {
            inputRef.current.click();
        }
    };

    const inputId = id || `toggle-${Math.random().toString(36).substr(2, 9)}`;

    return (
        <div className={cn("check-toggle-wrapper", className)}>
            <label htmlFor={inputId} className="checkbox-toggle">
                <input id={inputId} type="checkbox" checked={checked} onChange={handleChange} ref={inputRef} />
                <span className="slider" />
            </label>
            {label && (
                <span className="toggle-label" onClick={handleLabelClick}>
                    {label}
                </span>
            )}
        </div>
    );
};

export { Toggle };
