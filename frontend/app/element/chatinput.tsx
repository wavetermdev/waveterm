import clsx from "clsx";
import React, { useEffect, useRef, useState } from "react";
import { EmojiPalette } from "./emojipalette";

import "./chatinput.less";

interface ChatInputProps {
    value?: string;
    className?: string;
    onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
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

    // Function to count the number of lines in the textarea value
    const countLines = (text: string) => {
        return text.split("\n").length;
    };

    const adjustTextareaHeight = () => {
        if (textareaRef.current) {
            textareaRef.current.style.height = "auto"; // Reset height to auto first

            const maxHeight = maxRows * lineHeight; // Max height based on maxRows
            const currentLines = countLines(textareaRef.current.value); // Count the number of lines
            const newHeight = Math.min(textareaRef.current.scrollHeight, maxHeight); // Calculate new height

            // If the number of lines is less than or equal to maxRows, set height accordingly
            const calculatedHeight = currentLines <= maxRows ? `${lineHeight * currentLines}px` : `${newHeight}px`;

            textareaRef.current.style.height = calculatedHeight; // Set new height based on lines or scrollHeight
            if (actionWrapperRef.current) {
                actionWrapperRef.current.style.height = calculatedHeight; // Adjust emoji palette wrapper height
            }
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
            let lineHeightValue = computedStyle.lineHeight;
            const detectedLineHeight = parseFloat(lineHeightValue);
            setLineHeight(detectedLineHeight);
        }
    }, [textareaRef]);

    useEffect(() => {
        adjustTextareaHeight(); // Adjust the height when the component mounts or value changes
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
            <div ref={actionWrapperRef} className="emoji-palette-wrapper">
                <EmojiPalette placement="top-end" />
            </div>
        </div>
    );
};

export { ChatInput };
