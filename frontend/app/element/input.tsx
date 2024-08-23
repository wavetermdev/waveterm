import { clsx } from "clsx";
import React, { forwardRef, useEffect, useRef, useState } from "react";

import "./input.less";

interface InputDecorationProps {
    startDecoration?: React.ReactNode;
    endDecoration?: React.ReactNode;
}

interface InputProps {
    label?: string;
    value?: string;
    className?: string;
    onChange?: (value: string) => void;
    onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
    onFocus?: () => void;
    onBlur?: () => void;
    placeholder?: string;
    defaultValue?: string;
    decoration?: InputDecorationProps;
    required?: boolean;
    maxLength?: number;
    autoFocus?: boolean;
    disabled?: boolean;
    isNumber?: boolean;
}

const Input = forwardRef<HTMLDivElement, InputProps>(
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
            isNumber,
        }: InputProps,
        ref
    ) => {
        const [focused, setFocused] = useState(false);
        const [internalValue, setInternalValue] = useState(defaultValue);
        const [error, setError] = useState(false);
        const [hasContent, setHasContent] = useState(Boolean(value || defaultValue));
        const inputRef = useRef<HTMLInputElement>(null);

        useEffect(() => {
            if (value !== undefined) {
                setFocused(Boolean(value));
            }
        }, [value]);

        const handleComponentFocus = () => {
            if (inputRef.current && !inputRef.current.contains(document.activeElement)) {
                inputRef.current.focus();
            }
        };

        const handleComponentBlur = () => {
            if (inputRef.current?.contains(document.activeElement)) {
                inputRef.current.blur();
            }
        };

        const handleFocus = () => {
            setFocused(true);
            onFocus && onFocus();
        };

        const handleBlur = () => {
            if (inputRef.current) {
                const inputValue = inputRef.current.value;
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

        const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
            const inputValue = e.target.value;

            if (isNumber && inputValue !== "" && !/^\d*$/.test(inputValue)) {
                return;
            }

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
        };

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
                    <input
                        className={clsx("input-inner-input", {
                            "offset-left": decoration?.startDecoration,
                        })}
                        ref={inputRef}
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
                    />
                </div>
                {decoration?.endDecoration && <>{decoration.endDecoration}</>}
            </div>
        );
    }
);

export { Input };
export type { InputDecorationProps, InputProps };
