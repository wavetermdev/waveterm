// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from "react";
import "./MultiSelect.scss";

type Option = {
    label: string;
    value: string;
};

type MultiSelectProps = {
    options: Option[];
    selectedValues?: string[]; // Pre-selected options
    onChange: (values: string[]) => void;
};

const MultiSelect: React.FC<MultiSelectProps> = ({ options, selectedValues = [], onChange }) => {
    const [selected, setSelected] = useState<string[]>(selectedValues);

    const handleToggle = (value: string) => {
        const newSelected = selected.includes(value)
            ? selected.filter((v) => v !== value) // Remove if already selected
            : [...selected, value]; // Add if not selected

        setSelected(newSelected);
        onChange(newSelected);
    };

    return (
        <div className="multi-select">
            {options.map((option) => (
                <div
                    key={option.value}
                    className={`option ${selected.includes(option.value) ? "selected" : ""}`}
                    onClick={() => handleToggle(option.value)}
                >
                    {option.label}
                    {selected.includes(option.value) && <i className="fa fa-solid fa-check" />}
                </div>
            ))}
        </div>
    );
};

export { MultiSelect };
