// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import clsx from "clsx";
import { Children, forwardRef, memo, ReactNode, useImperativeHandle, useRef } from "react";

import "./button.less";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    className?: string;
    children?: ReactNode;
    target?: string;
    source?: string;
}

const Button = memo(
    forwardRef<HTMLButtonElement, ButtonProps>(
        ({ children, disabled, source, className = "", ...props }: ButtonProps, ref) => {
            const btnRef = useRef<HTMLButtonElement>(null);
            useImperativeHandle(ref, () => btnRef.current as HTMLButtonElement);

            const childrenArray = Children.toArray(children);

            // Check if the className contains any of the categories: solid, outlined, or ghost
            const containsButtonCategory = /(solid|outline|ghost)/.test(className);
            // If no category is present, default to 'solid'
            const categoryClassName = containsButtonCategory ? className : `solid ${className}`;

            // Check if the className contains any of the color options: green, grey, red, or yellow
            const containsColor = /(green|grey|red|yellow)/.test(categoryClassName);
            // If no color is present, default to 'green'
            const finalClassName = containsColor ? categoryClassName : `green ${categoryClassName}`;

            return (
                <button
                    ref={btnRef}
                    tabIndex={disabled ? -1 : 0}
                    className={clsx("button", finalClassName, {
                        disabled,
                    })}
                    disabled={disabled}
                    {...props}
                >
                    {childrenArray}
                </button>
            );
        }
    )
);

export { Button };
