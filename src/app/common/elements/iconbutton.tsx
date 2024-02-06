// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import { Button } from "./button";
class IconButton extends Button {
    render() {
        const { children, theme, variant = "solid", ...rest } = this.props;
        const className = `wave-button icon-button ${theme} ${variant}`;

        return (
            <button {...rest} className={className}>
                {children}
            </button>
        );
    }
}

export default IconButton;

export { IconButton };
