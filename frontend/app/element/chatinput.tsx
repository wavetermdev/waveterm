// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import clsx from "clsx";
import React, { useEffect, useRef, useState } from "react";
import { EmojiPalette } from "./emojipalette";

import "./chatinput.less";

interface ChatInputProps {
    value?: string;
    className?: string;
    onChange?: (value: string) => void;
    onKeyDown?: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
    onFocus?: () => void;
    onBlur?: () => void;
    placeholder?: string;
    defaultValue?: string;
    maxLength?: number;
    autoFocus?: boolean;
    disabled?: boolean;
    rows?: number;
    maxRows?: number;
    inputRef?: React.MutableRefObject<HTMLTextAreaElement>;
    manageFocus?: (isFocused: boolean) => void;
}

const ChatInput = ({
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
    inputRef,
    manageFocus,
}: ChatInputProps) => {
    const textareaRef = inputRef || useRef<HTMLTextAreaElement>(null);
    const actionWrapperRef = useRef<HTMLDivElement>(null);
    const [internalValue, setInternalValue] = useState(defaultValue);
    const [lineHeight, setLineHeight] = useState(24); // Default line height fallback of 24px

    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        if (textareaRef.current) {
            textareaRef.current.style.height = "auto"; // Reset height
            const maxHeight = maxRows * lineHeight; // Calculate max height
            const newHeight = Math.min(textareaRef.current.scrollHeight, maxHeight);
            textareaRef.current.style.height = `${newHeight}px`; // Set height dynamically
        }

        setInternalValue(e.target.value);
        onChange && onChange(e.target.value);
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
            let lineHeightValue = computedStyle.lineHeight;

            if (lineHeightValue === "normal") {
                const fontSize = parseFloat(computedStyle.fontSize);
                lineHeightValue = `${fontSize * 1.2}px`; // Fallback to 1.2 ratio of font size
            }

            const detectedLineHeight = parseFloat(lineHeightValue);
            setLineHeight(detectedLineHeight || 24); // Fallback if detection fails
        }
    }, [textareaRef]);

    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = "auto";
            const maxHeight = maxRows * lineHeight;
            const newHeight = Math.min(textareaRef.current.scrollHeight, maxHeight);
            textareaRef.current.style.height = `${newHeight}px`;
            actionWrapperRef.current.style.height = `${newHeight}px`;
        }
    }, [value, maxRows, lineHeight]);

    const inputValue = value ?? internalValue;

    return (
        <div className={clsx("chat-group", className)}>
            <textarea
                className="chat-textarea"
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
                        textareaRef.current && textareaRef.current.scrollHeight > maxRows * lineHeight
                            ? "auto"
                            : "hidden",
                }}
            />
            <div ref={actionWrapperRef}>
                <EmojiPalette placement="top-end" />
            </div>
        </div>
    );
};

export { ChatInput };
