// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { clsx } from "clsx";
import * as React from "react";

import "./linkbutton.less";

interface LinkButtonProps {
    href: string;
    rel?: string;
    target?: string;
    children: React.ReactNode;
    disabled?: boolean;
    leftIcon?: React.ReactNode;
    rightIcon?: React.ReactNode;
    style?: React.CSSProperties;
    autoFocus?: boolean;
    className?: string;
    termInline?: boolean;
    title?: string;
    onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
}

const LinkButton = ({ leftIcon, rightIcon, children, className, ...rest }: LinkButtonProps) => {
    return (
        <a {...rest} className="button link-button">
            <span className={clsx("button-inner", className)}>
                {leftIcon && <span className="icon-left">{leftIcon}</span>}
                {children}
                {rightIcon && <span className="icon-right">{rightIcon}</span>}
            </span>
        </a>
    );
};

export { LinkButton };
