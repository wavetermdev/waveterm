// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import { boundMethod } from "autobind-decorator";
import cn from "classnames";

import "./button.less";

type ButtonVariantType = "outlined" | "solid" | "ghost";
type ButtonThemeType = "primary" | "secondary";

interface ButtonProps {
    theme?: ButtonThemeType;
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    variant?: ButtonVariantType;
    leftIcon?: React.ReactNode;
    rightIcon?: React.ReactNode;
    color?: string;
    style?: React.CSSProperties;
    autoFocus?: boolean;
    className?: string;
    termInline?: boolean;
}

class Button extends React.Component<ButtonProps> {
    static defaultProps = {
        theme: "primary",
        variant: "solid",
        color: "",
        style: {},
    };

    @boundMethod
    handleClick() {
        if (this.props.onClick && !this.props.disabled) {
            this.props.onClick();
        }
    }

    render() {
        const {
            leftIcon,
            rightIcon,
            theme,
            children,
            disabled,
            variant,
            color,
            style,
            autoFocus,
            termInline,
            className,
        } = this.props;

        return (
            <button
                className={cn(
                    "wave-button",
                    theme,
                    variant,
                    color,
                    { disabled: disabled },
                    { "term-inline": termInline },
                    className
                )}
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
