// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import cn from "classnames";
import { ButtonProps } from "./button";

import "./linkbutton.less";

interface LinkButtonProps extends ButtonProps {
    href: string;
    rel?: string;
    target?: string;
}

class LinkButton extends React.Component<LinkButtonProps> {
    render() {
        const { leftIcon, rightIcon, children, className, ...rest } = this.props;

        return (
            <a {...rest} className={cn(`wave-button link-button`, className)}>
                {leftIcon && <span className="icon-left">{leftIcon}</span>}
                {children}
                {rightIcon && <span className="icon-right">{rightIcon}</span>}
            </a>
        );
    }
}

export { LinkButton };
