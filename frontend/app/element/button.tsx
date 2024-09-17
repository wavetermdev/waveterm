import clsx from "clsx";
import { Children, isValidElement, memo } from "react";
import "./button.less";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    forwardedRef?: React.RefObject<HTMLButtonElement>;
    className?: string;
    children?: React.ReactNode;
}

const Button = memo(({ className = "", children, disabled, ...props }: ButtonProps) => {
    const hasIcon = Children.toArray(children).some(
        (child) => isValidElement(child) && (child as React.ReactElement).type === "svg"
    );

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
            tabIndex={disabled ? -1 : 0}
            className={clsx("button", finalClassName, {
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
