// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import clsx from "clsx";
import React, { forwardRef, memo, useImperativeHandle, useRef, useState } from "react";

import "./input.scss";

interface InputGroupProps {
    children: React.ReactNode;
    className?: string;
}

const InputGroup = memo(
    forwardRef<HTMLDivElement, InputGroupProps>(({ children, className }: InputGroupProps, ref) => {
        const [isFocused, setIsFocused] = useState(false);

        const manageFocus = (focused: boolean) => {
            setIsFocused(focused);
        };

        return (
            <div
                ref={ref}
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
    })
);

interface InputLeftElementProps {
    children: React.ReactNode;
    className?: string;
}

const InputLeftElement = memo(({ children, className }: InputLeftElementProps) => {
    return <div className={clsx("input-left-element", className)}>{children}</div>;
});

interface InputRightElementProps {
    children: React.ReactNode;
    className?: string;
}

const InputRightElement = memo(({ children, className }: InputRightElementProps) => {
    return <div className={clsx("input-right-element", className)}>{children}</div>;
});

interface InputProps {
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
    autoSelect?: boolean;
    disabled?: boolean;
    isNumber?: boolean;
    inputRef?: React.RefObject<any>;
    manageFocus?: (isFocused: boolean) => void;
}

const Input = memo(
    forwardRef<HTMLInputElement, InputProps>(
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
                required,
                maxLength,
                autoFocus,
                autoSelect,
                disabled,
                isNumber,
                manageFocus,
            }: InputProps,
            ref
        ) => {
            const [internalValue, setInternalValue] = useState(defaultValue);
            const inputRef = useRef<HTMLInputElement>(null);

            useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);

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
                if (autoSelect) {
                    inputRef.current?.select();
                }
                manageFocus?.(true);
                onFocus?.();
            };

            const handleBlur = () => {
                manageFocus?.(false);
                onBlur?.();
            };

            const inputValue = value ?? internalValue;

            return (
                <input
                    className={clsx("input", className, {
                        disabled: disabled,
                    })}
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
            );
        }
    )
);

export { Input, InputGroup, InputLeftElement, InputRightElement };
export type { InputGroupProps, InputLeftElementProps, InputProps, InputRightElementProps };
