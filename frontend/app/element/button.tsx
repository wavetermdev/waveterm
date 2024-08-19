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
        <div className="button">
            <button
                className={clsx("button-inner", className, {
                    disabled,
                    hasIcon,
                })}
                disabled={disabled}
                {...props}
            >
                {children}
            </button>
        </div>
    );
});

export { Button };
