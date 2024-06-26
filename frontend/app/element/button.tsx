import clsx from "clsx";
import React from "react";
import "./button.less";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    className?: string;
}

const Button: React.FC<ButtonProps> = React.memo(({ className = "primary", children, disabled, ...props }) => {
    const hasIcon = React.Children.toArray(children).some(
        (child) => React.isValidElement(child) && (child as React.ReactElement).type === "svg"
    );

    return (
        <button
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
