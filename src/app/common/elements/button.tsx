import * as React from "react";
import { boundMethod } from "autobind-decorator";
import cn from "classnames";

import "./button.less";

interface ButtonProps {
    children: React.ReactNode;
    onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
    disabled?: boolean;
    leftIcon?: React.ReactNode;
    rightIcon?: React.ReactNode;
    style?: React.CSSProperties;
    autoFocus?: boolean;
    className?: string;
    termInline?: boolean;
    title?: string;
}

class Button extends React.Component<ButtonProps> {
    static defaultProps = {
        style: {},
        className: "primary",
    };

    @boundMethod
    handleClick(e) {
        if (this.props.onClick && !this.props.disabled) {
            this.props.onClick(e);
        }
    }

    render() {
        const { leftIcon, rightIcon, children, disabled, style, autoFocus, termInline, className, title } = this.props;

        return (
            <button
                className={cn("wave-button", { disabled }, { "term-inline": termInline }, className)}
                onClick={this.handleClick}
                disabled={disabled}
                style={style}
                autoFocus={autoFocus}
                title={title}
            >
                {leftIcon && <span className="icon-left">{leftIcon}</span>}
                {children}
                {rightIcon && <span className="icon-right">{rightIcon}</span>}
            </button>
        );
    }
}

export { Button };
export type { ButtonProps };
