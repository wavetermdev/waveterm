import { clsx } from "clsx";
import React, { forwardRef, useEffect, useRef, useState } from "react";

import "./inputmultiline.less";

interface InputDecorationProps {
    startDecoration?: React.ReactNode;
    endDecoration?: React.ReactNode;
}

interface InputMultiLineProps {
    label?: string;
    value?: string;
    className?: string;
    onChange?: (value: string) => void;
    onKeyDown?: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
    onFocus?: () => void;
    onBlur?: () => void;
    placeholder?: string;
    defaultValue?: string;
    decoration?: InputDecorationProps;
    required?: boolean;
    maxLength?: number;
    autoFocus?: boolean;
    disabled?: boolean;
    inputRef?: React.MutableRefObject<HTMLTextAreaElement>;
}

const InputMultiLine = forwardRef<HTMLDivElement, InputMultiLineProps>(
    (
        {
            label,
            value,
            className,
            onChange,
            onKeyDown,
            onFocus,
            onBlur,
            placeholder,
            defaultValue = "",
            decoration,
            required,
            maxLength,
            autoFocus,
            disabled,
            inputRef,
        }: InputMultiLineProps,
        ref
    ) => {
        const [focused, setFocused] = useState(false);
        const [internalValue, setInternalValue] = useState(defaultValue);
        const [error, setError] = useState(false);
        const [hasContent, setHasContent] = useState(Boolean(value || defaultValue));
        const internalInputRef = useRef<HTMLTextAreaElement>(null);

        useEffect(() => {
            if (value !== undefined) {
                setFocused(Boolean(value));
            }
        }, [value]);

        const handleComponentFocus = () => {
            if (internalInputRef.current && !internalInputRef.current.contains(document.activeElement)) {
                internalInputRef.current.focus();
            }
        };

        const handleComponentBlur = () => {
            if (internalInputRef.current?.contains(document.activeElement)) {
                internalInputRef.current.blur();
            }
        };

        const handleSetInputRef = (elem: HTMLTextAreaElement) => {
            if (inputRef) {
                inputRef.current = elem;
            }
            internalInputRef.current = elem;
        };

        const handleFocus = () => {
            setFocused(true);
            onFocus && onFocus();
        };

        const handleBlur = () => {
            if (internalInputRef.current) {
                const inputValue = internalInputRef.current.value;
                if (required && !inputValue) {
                    setError(true);
                    setFocused(false);
                } else {
                    setError(false);
                    setFocused(false);
                }
            }
            onBlur && onBlur();
        };

        const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
            const inputValue = e.target.value;

            if (required && !inputValue) {
                setError(true);
                setHasContent(false);
            } else {
                setError(false);
                setHasContent(Boolean(inputValue));
            }

            if (value === undefined) {
                setInternalValue(inputValue);
            }

            onChange && onChange(inputValue);
            handleAutoResize(e.target);
        };

        const handleAutoResize = (textarea: HTMLTextAreaElement) => {
            textarea.style.height = "auto"; // Reset height to calculate new height
            textarea.style.height = `${textarea.scrollHeight}px`; // Set new height based on content
        };

        useEffect(() => {
            if (internalInputRef.current) {
                handleAutoResize(internalInputRef.current);
            }
        }, [internalValue]);

        const inputValue = value ?? internalValue;

        return (
            <div
                ref={ref}
                className={clsx("input", className, {
                    focused: focused,
                    error: error,
                    disabled: disabled,
                    "no-label": !label,
                })}
                onFocus={handleComponentFocus}
                onBlur={handleComponentBlur}
                tabIndex={-1}
            >
                {decoration?.startDecoration && <>{decoration.startDecoration}</>}
                <div className="input-inner">
                    {label && (
                        <label
                            className={clsx("input-inner-label", {
                                float: hasContent || focused || placeholder,
                                "offset-left": decoration?.startDecoration,
                            })}
                            htmlFor={label}
                        >
                            {label}
                        </label>
                    )}
                    <textarea
                        className={clsx("input-inner-input", {
                            "offset-left": decoration?.startDecoration,
                        })}
                        ref={handleSetInputRef}
                        id={label}
                        value={inputValue}
                        onChange={handleInputChange}
                        onFocus={handleFocus}
                        onBlur={handleBlur}
                        onKeyDown={onKeyDown}
                        placeholder={placeholder}
                        maxLength={maxLength}
                        autoFocus={autoFocus}
                        disabled={disabled}
                        rows={1}
                        onInput={(e) => handleAutoResize(e.currentTarget)}
                    />
                </div>
                {decoration?.endDecoration && <>{decoration.endDecoration}</>}
            </div>
        );
    }
);

export { InputMultiLine };
export type { InputDecorationProps, InputMultiLineProps };
