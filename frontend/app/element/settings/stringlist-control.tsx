// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { memo, useCallback } from "react";

interface StringListControlProps {
    value: string[];
    onChange: (value: string[]) => void;
    disabled?: boolean;
    className?: string;
    placeholder?: string;
    /** Maximum number of items allowed */
    maxItems?: number;
}

const StringListControl = memo(
    ({ value, onChange, disabled, className, placeholder = "Enter value...", maxItems }: StringListControlProps) => {
        const items = value ?? [];

        const handleItemChange = useCallback(
            (index: number, newValue: string) => {
                const updated = [...items];
                updated[index] = newValue;
                onChange(updated);
            },
            [items, onChange]
        );

        const handleAddItem = useCallback(() => {
            if (maxItems !== undefined && items.length >= maxItems) return;
            onChange([...items, ""]);
        }, [items, onChange, maxItems]);

        const handleRemoveItem = useCallback(
            (index: number) => {
                const updated = items.filter((_, i) => i !== index);
                onChange(updated);
            },
            [items, onChange]
        );

        const handleMoveUp = useCallback(
            (index: number) => {
                if (index === 0) return;
                const updated = [...items];
                [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
                onChange(updated);
            },
            [items, onChange]
        );

        const handleMoveDown = useCallback(
            (index: number) => {
                if (index === items.length - 1) return;
                const updated = [...items];
                [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
                onChange(updated);
            },
            [items, onChange]
        );

        const canAdd = maxItems === undefined || items.length < maxItems;

        return (
            <div className={cn("setting-stringlist", className, { disabled })}>
                <div className="setting-stringlist-items">
                    {items.map((item, index) => (
                        <div key={index} className="setting-stringlist-item">
                            <input
                                type="text"
                                value={item}
                                onChange={(e) => handleItemChange(index, e.target.value)}
                                disabled={disabled}
                                placeholder={placeholder}
                                className="setting-stringlist-input"
                            />
                            <div className="setting-stringlist-actions">
                                <button
                                    type="button"
                                    className="setting-stringlist-button"
                                    onClick={() => handleMoveUp(index)}
                                    disabled={disabled || index === 0}
                                    aria-label="Move up"
                                    title="Move up"
                                >
                                    <i className="fa fa-solid fa-chevron-up" />
                                </button>
                                <button
                                    type="button"
                                    className="setting-stringlist-button"
                                    onClick={() => handleMoveDown(index)}
                                    disabled={disabled || index === items.length - 1}
                                    aria-label="Move down"
                                    title="Move down"
                                >
                                    <i className="fa fa-solid fa-chevron-down" />
                                </button>
                                <button
                                    type="button"
                                    className="setting-stringlist-button setting-stringlist-remove"
                                    onClick={() => handleRemoveItem(index)}
                                    disabled={disabled}
                                    aria-label="Remove item"
                                    title="Remove"
                                >
                                    <i className="fa fa-solid fa-times" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
                <button
                    type="button"
                    className="setting-stringlist-add"
                    onClick={handleAddItem}
                    disabled={disabled || !canAdd}
                >
                    <i className="fa fa-solid fa-plus" />
                    <span>Add item</span>
                </button>
            </div>
        );
    }
);

StringListControl.displayName = "StringListControl";

export { StringListControl };
export type { StringListControlProps };
