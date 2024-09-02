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
    inputRef?: React.MutableRefObject<HTMLInputElement>;
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
            inputRef,
        }: InputProps,
        ref
    ) => {
        const [focused, setFocused] = useState(false);
        const [internalValue, setInternalValue] = useState(defaultValue);
        const [error, setError] = useState(false);
        const [hasContent, setHasContent] = useState(Boolean(value || defaultValue));
        const internalInputRef = useRef<HTMLInputElement>(null);

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

        const handleSetInputRef = (elem: HTMLInputElement) => {
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
                    />
                </div>
                {decoration?.endDecoration && <>{decoration.endDecoration}</>}
            </div>
        );
    }
);

export { Input };
export type { InputDecorationProps, InputProps };
