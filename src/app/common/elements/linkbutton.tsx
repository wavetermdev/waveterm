// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import { clsx } from "clsx";
import { ButtonProps } from "./button";

interface LinkButtonProps extends ButtonProps {
    href: string;
    rel?: string;
    target?: string;
}

class LinkButton extends React.Component<LinkButtonProps> {
    render() {
        const { leftIcon, rightIcon, children, className, ...rest } = this.props;

        return (
            <a {...rest} className={clsx(`wave-button link-button`, className)}>
                {leftIcon && <span className="icon-left">{leftIcon}</span>}
                {children}
                {rightIcon && <span className="icon-right">{rightIcon}</span>}
            </a>
        );
    }
}

export { LinkButton };
