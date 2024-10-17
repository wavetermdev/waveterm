import clsx from "clsx";
import React, { forwardRef, ReactNode } from "react";
import "./input.less";

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
    onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
    onFocus?: () => void;
    onBlur?: () => void;
    placeholder?: string;
    defaultValue?: string;
    required?: boolean;
    maxLength?: number;
    autoFocus?: boolean;
    disabled?: boolean;
    isNumber?: boolean;
    inputRef?: React.MutableRefObject<HTMLInputElement>;
    children?: ReactNode;
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
            children,
        }: InputProps,
        ref
    ) => {
        const [internalValue, setInternalValue] = React.useState(defaultValue);

        const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
            const inputValue = e.target.value;

            if (isNumber && inputValue !== "" && !/^\d*$/.test(inputValue)) {
                return;
            }

            if (value === undefined) {
                setInternalValue(inputValue);
            }

            onChange && onChange(inputValue);
        };

        const inputValue = value ?? internalValue;

        let leftElement = null;
        let rightElement = null;
        React.Children.forEach(children, (child) => {
            if (React.isValidElement(child)) {
                if (child.type === InputLeftElement) {
                    leftElement = child;
                } else if (child.type === InputRightElement) {
                    rightElement = child;
                }
            }
        });

        return (
            <div
                ref={ref}
                className={clsx("input-wrapper", className, {
                    disabled: disabled,
                })}
            >
                <div className="input-inner">
                    {leftElement && <div className="input-left-decoration">{leftElement}</div>}
                    <input
                        className={clsx("input-inner-input", {
                            "with-left-element": leftElement,
                            "with-right-element": rightElement,
                        })}
                        ref={inputRef}
                        value={inputValue}
                        onChange={handleInputChange}
                        onKeyDown={onKeyDown}
                        onFocus={onFocus}
                        onBlur={onBlur}
                        placeholder={placeholder}
                        maxLength={maxLength}
                        autoFocus={autoFocus}
                        disabled={disabled}
                    />
                    {rightElement && <div className="input-right-decoration">{rightElement}</div>}
                </div>
            </div>
        );
    }
);

export { Input, InputLeftElement, InputRightElement };
export type { InputLeftElementProps, InputProps, InputRightElementProps };
