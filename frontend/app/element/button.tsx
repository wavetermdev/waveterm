// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { clsx } from "clsx";
import * as React from "react";

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

    handleClick(e) {
        if (this.props.onClick && !this.props.disabled) {
            this.props.onClick(e);
        }
    }

    render() {
        const { leftIcon, rightIcon, children, disabled, style, autoFocus, termInline, className, title } = this.props;

        return (
            <button
                className={clsx("wave-button", { disabled }, { "term-inline": termInline }, className)}
                onClick={this.handleClick.bind(this)}
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
