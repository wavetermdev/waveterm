// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import React, { useEffect, useRef } from "react";
import { twMerge } from "tailwind-merge";

interface EditableDivProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
    className?: string;
    text: string;
    onChange: (newText: string) => void;
    placeholder?: string;
}

export function EditableDiv({ className, text, onChange, placeholder, ...otherProps }: EditableDivProps) {
    const divRef = useRef<HTMLDivElement>(null);
    const textRef = useRef<string>(text);

    // Update DOM when text prop changes
    useEffect(() => {
        if (divRef.current && divRef.current.textContent !== text) {
            divRef.current.textContent = text;
            textRef.current = text;
        }
    }, [text]);

    const handleBlur = () => {
        const newText = divRef.current?.textContent || "";
        if (newText !== textRef.current) {
            textRef.current = newText;
            onChange(newText);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Enter") {
            e.preventDefault();
            // Submit the edit - stop editing and fire onChange
            divRef.current?.blur();
        } else if (e.key === "Escape") {
            e.preventDefault();
            // Revert to original contents and stop editing
            if (divRef.current) {
                divRef.current.textContent = textRef.current;
                divRef.current.blur();
            }
        }
        
        // Call original onKeyDown if provided
        if (otherProps.onKeyDown) {
            otherProps.onKeyDown(e);
        }
    };

    return (
        <div
            ref={divRef}
            contentEditable
            suppressContentEditableWarning
            className={twMerge(className)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            data-placeholder={placeholder}
            {...otherProps}
        >
            {text}
        </div>
    );
}
