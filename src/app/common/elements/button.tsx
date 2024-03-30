import * as React from "react";
import { boundMethod } from "autobind-decorator";
import cn from "classnames";

import "./button.less";

interface ButtonProps {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    leftIcon?: React.ReactNode;
    rightIcon?: React.ReactNode;
    style?: React.CSSProperties;
    autoFocus?: boolean;
    className?: string;
    termInline?: boolean;
}

class Button extends React.PureComponent<ButtonProps> {
    static defaultProps = {
        style: {},
        className: "primary",
    };

    @boundMethod
    handleClick() {
        if (this.props.onClick && !this.props.disabled) {
            this.props.onClick();
        }
    }

    render() {
        const { leftIcon, rightIcon, children, disabled, style, autoFocus, termInline, className } = this.props;

        return (
            <button
                className={cn("wave-button", { disabled }, { "term-inline": termInline }, className)}
                onClick={this.handleClick}
                disabled={disabled}
                style={style}
                autoFocus={autoFocus}
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
