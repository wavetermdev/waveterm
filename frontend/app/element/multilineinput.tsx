// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import clsx from "clsx";
import React, { forwardRef, memo, useEffect, useImperativeHandle, useRef, useState } from "react";

import "./multilineinput.scss";

interface MultiLineInputProps {
    value?: string;
    className?: string;
    onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
    onFocus?: () => void;
    onBlur?: () => void;
    placeholder?: string;
    defaultValue?: string;
    maxLength?: number;
    autoFocus?: boolean;
    disabled?: boolean;
    rows?: number;
    maxRows?: number;
    manageFocus?: (isFocused: boolean) => void;
}

const MultiLineInput = memo(
    forwardRef<HTMLTextAreaElement, MultiLineInputProps>(
        (
            {
                value,
                className,
                onChange,
                onKeyDown,
                onFocus,
                onBlur,
                placeholder,
                defaultValue = "",
                maxLength,
                autoFocus,
                disabled,
                rows = 1,
                maxRows = 5,
                manageFocus,
            }: MultiLineInputProps,
            ref
        ) => {
            const textareaRef = useRef<HTMLTextAreaElement>(null);
            const [internalValue, setInternalValue] = useState(defaultValue);
            const [lineHeight, setLineHeight] = useState(24); // Default line height fallback of 24px
            const [paddingTop, setPaddingTop] = useState(0);
            const [paddingBottom, setPaddingBottom] = useState(0);

            useImperativeHandle(ref, () => textareaRef.current as HTMLTextAreaElement);

            // Function to count the number of lines in the textarea value
            const countLines = (text: string) => {
                return text.split("\n").length;
            };

            const adjustTextareaHeight = () => {
                if (textareaRef.current) {
                    textareaRef.current.style.height = "auto"; // Reset height to auto first

                    const maxHeight = maxRows * lineHeight + paddingTop + paddingBottom; // Max height based on maxRows
                    const currentLines = countLines(textareaRef.current.value); // Count the number of lines
                    const newHeight = Math.min(textareaRef.current.scrollHeight, maxHeight); // Calculate new height

                    // If the number of lines is less than or equal to maxRows, set height accordingly
                    const calculatedHeight =
                        currentLines <= maxRows
                            ? `${lineHeight * currentLines + paddingTop + paddingBottom}px`
                            : `${newHeight}px`;

                    textareaRef.current.style.height = calculatedHeight;
                }
            };

            const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
                setInternalValue(e.target.value);
                onChange?.(e);

                // Adjust the height of the textarea after text change
                adjustTextareaHeight();
            };

            const handleFocus = () => {
                manageFocus?.(true);
                onFocus?.();
            };

            const handleBlur = () => {
                manageFocus?.(false);
                onBlur?.();
            };

            useEffect(() => {
                if (textareaRef.current) {
                    const computedStyle = window.getComputedStyle(textareaRef.current);
                    const detectedLineHeight = parseFloat(computedStyle.lineHeight);
                    const detectedPaddingTop = parseFloat(computedStyle.paddingTop);
                    const detectedPaddingBottom = parseFloat(computedStyle.paddingBottom);

                    setLineHeight(detectedLineHeight);
                    setPaddingTop(detectedPaddingTop);
                    setPaddingBottom(detectedPaddingBottom);
                }
            }, [textareaRef]);

            useEffect(() => {
                adjustTextareaHeight();
            }, [value, maxRows, lineHeight, paddingTop, paddingBottom]);

            const inputValue = value ?? internalValue;

            return (
                <textarea
                    className={clsx("multiline-input", className)}
                    ref={textareaRef}
                    value={inputValue}
                    onChange={handleInputChange}
                    onKeyDown={onKeyDown}
                    onFocus={handleFocus}
                    onBlur={handleBlur}
                    placeholder={placeholder}
                    maxLength={maxLength}
                    autoFocus={autoFocus}
                    disabled={disabled}
                    rows={rows}
                    style={{
                        overflowY:
                            textareaRef.current &&
                            textareaRef.current.scrollHeight > maxRows * lineHeight + paddingTop + paddingBottom
                                ? "auto"
                                : "hidden",
                    }}
                />
            );
        }
    )
);

export { MultiLineInput };
export type { MultiLineInputProps };
