// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobx from "mobx";
import { Button } from "./button";

import "./iconbutton.less";

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
