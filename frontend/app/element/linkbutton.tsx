// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import clsx from "clsx";
import * as React from "react";

import "./linkbutton.scss";

interface LinkButtonProps {
    href: string;
    rel?: string;
    target?: string;
    children: React.ReactNode;
    disabled?: boolean;
    style?: React.CSSProperties;
    autoFocus?: boolean;
    className?: string;
    termInline?: boolean;
    title?: string;
    onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
}

const LinkButton = ({ children, className, ...rest }: LinkButtonProps) => {
    return (
        <a {...rest} className={clsx("button grey solid link-button", className)}>
            <span className="button-inner">{children}</span>
        </a>
    );
};

export { LinkButton };
