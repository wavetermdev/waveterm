// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import React, { useState } from "react";
import "./multiselect.scss";

type Option = {
    label: string;
    value: string;
};

type MultiSelectProps = {
    options: Option[];
    selectedValues?: string[];
    onChange: (values: string[]) => void;
};

const MultiSelect: React.FC<MultiSelectProps> = ({ options, selectedValues = [], onChange }) => {
    const [selected, setSelected] = useState<string[]>(selectedValues);

    const handleToggle = (value: string) => {
        setSelected((prevSelected) => {
            const newSelected = prevSelected.includes(value)
                ? prevSelected.filter((v) => v !== value) // Remove if already selected
                : [...prevSelected, value]; // Add if not selected

            onChange(newSelected);
            return newSelected;
        });
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, value: string) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            handleToggle(value);
        }
    };

    return (
        <div className="multi-select" role="listbox" aria-multiselectable="true" aria-label="Multi-select list">
            {options.map((option) => {
                const isSelected = selected.includes(option.value);

                return (
                    <div
                        key={option.value}
                        role="option"
                        aria-selected={isSelected}
                        className={`option ${isSelected ? "selected" : ""}`}
                        tabIndex={0}
                        onClick={() => handleToggle(option.value)}
                        onKeyDown={(e) => handleKeyDown(e, option.value)}
                    >
                        {option.label}
                        {isSelected && <i className="fa fa-solid fa-check" aria-hidden="true" />}
                    </div>
                );
            })}
        </div>
    );
};

export { MultiSelect };
