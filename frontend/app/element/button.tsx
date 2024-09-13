// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import clsx from "clsx";
import React from "react";
import "./button.less";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    forwardedRef?: React.RefObject<HTMLButtonElement>;
    className?: string;
    children?: React.ReactNode;
}

const Button = React.memo(({ className = "primary", children, disabled, ...props }: ButtonProps) => {
    const hasIcon = React.Children.toArray(children).some(
        (child) => React.isValidElement(child) && (child as React.ReactElement).type === "svg"
    );

    return (
        <button
            tabIndex={disabled ? -1 : 0}
            className={clsx("button", className, {
                disabled,
                hasIcon,
            })}
            disabled={disabled}
            {...props}
        >
            {children}
        </button>
    );
});

export { Button };
