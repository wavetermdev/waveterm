// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import clsx from "clsx";
import { forwardRef, memo, ReactNode, useImperativeHandle, useRef } from "react";

import "./button.scss";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    className?: string;
    children?: ReactNode;
    as?: keyof React.JSX.IntrinsicElements | React.ComponentType<any>;
}

const Button = memo(
    forwardRef<HTMLButtonElement, ButtonProps>(
        ({ children, disabled, className = "", as: Component = "button", ...props }: ButtonProps, ref) => {
            const btnRef = useRef<HTMLButtonElement>(null);
            useImperativeHandle(ref, () => btnRef.current as HTMLButtonElement);

            // Check if the className contains any of the categories: solid, outlined, or ghost
            const containsButtonCategory = /(solid|outline|ghost)/.test(className);
            // If no category is present, default to 'solid'
            const categoryClassName = containsButtonCategory ? className : `solid ${className}`;

            // Check if the className contains any of the color options: green, grey, red, or yellow
            const containsColor = /(green|grey|red|yellow)/.test(categoryClassName);
            // If no color is present, default to 'green'
            const finalClassName = containsColor ? categoryClassName : `green ${categoryClassName}`;

            return (
                <Component
                    ref={btnRef}
                    tabIndex={disabled ? -1 : 0}
                    className={clsx("wave-button", finalClassName)}
                    disabled={disabled}
                    {...props}
                >
                    {children}
                </Component>
            );
        }
    )
);

Button.displayName = "Button";

export { Button };
