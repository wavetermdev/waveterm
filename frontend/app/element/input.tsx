// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import clsx from "clsx";
import React, { forwardRef, useState } from "react";

import "./input.less";

interface InputGroupProps {
    children: React.ReactNode;
    className?: string;
}

const InputGroup = ({ children, className }: InputGroupProps) => {
    const [isFocused, setIsFocused] = useState(false);

    const manageFocus = (focused: boolean) => {
        setIsFocused(focused);
    };

    return (
        <div
            className={clsx("input-group", className, {
                focused: isFocused,
            })}
        >
            {React.Children.map(children, (child) => {
                if (React.isValidElement(child)) {
                    return React.cloneElement(child as any, { manageFocus });
                }
                return child;
            })}
        </div>
    );
};

interface InputLeftElementProps {
    children: React.ReactNode;
    className?: string;
}

const InputLeftElement = ({ children, className }: InputLeftElementProps) => {
    return <div className={clsx("input-left-element", className)}>{children}</div>;
};

interface InputRightElementProps {
    children: React.ReactNode;
    className?: string;
}

const InputRightElement = ({ children, className }: InputRightElementProps) => {
    return <div className={clsx("input-right-element", className)}>{children}</div>;
};

interface InputProps {
    label?: string;
    value?: string;
    className?: string;
    onChange?: (value: string) => void;
    onKeyDown?: (event: React.KeyboardEvent<any>) => void;
    onFocus?: () => void;
    onBlur?: () => void;
    placeholder?: string;
    defaultValue?: string;
    required?: boolean;
    maxLength?: number;
    autoFocus?: boolean;
    disabled?: boolean;
    isNumber?: boolean;
    inputRef?: React.MutableRefObject<any>;
    manageFocus?: (isFocused: boolean) => void;
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
            required,
            maxLength,
            autoFocus,
            disabled,
            isNumber,
            inputRef,
            manageFocus,
        }: InputProps,
        ref
    ) => {
        const [internalValue, setInternalValue] = useState(defaultValue);

        const handleInputChange = (e: React.ChangeEvent<any>) => {
            const inputValue = e.target.value;

            if (isNumber && inputValue !== "" && !/^\d*$/.test(inputValue)) {
                return;
            }

            if (value === undefined) {
                setInternalValue(inputValue);
            }

            onChange && onChange(inputValue);
        };

        const handleFocus = () => {
            manageFocus?.(true);
            onFocus?.();
        };

        const handleBlur = () => {
            manageFocus?.(false);
            onBlur?.();
        };

        const inputValue = value ?? internalValue;

        return (
            <div
                ref={ref}
                className={clsx("input", className, {
                    disabled: disabled,
                })}
            >
                <div className="input-inner">
                    {label && (
                        <label className={clsx("input-inner-label")} htmlFor={label}>
                            {label}
                        </label>
                    )}

                    <input
                        className={clsx("input-inner-input")}
                        ref={inputRef}
                        value={inputValue}
                        onChange={handleInputChange}
                        onKeyDown={onKeyDown}
                        onFocus={handleFocus}
                        onBlur={handleBlur}
                        placeholder={placeholder}
                        maxLength={maxLength}
                        autoFocus={autoFocus}
                        disabled={disabled}
                    />
                </div>
            </div>
        );
    }
);

export { Input, InputGroup, InputLeftElement, InputRightElement };
export type { InputGroupProps, InputLeftElementProps, InputProps, InputRightElementProps };
