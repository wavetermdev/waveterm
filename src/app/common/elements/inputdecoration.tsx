// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import cn from "classnames";

import "./inputdecoration.less";

interface InputDecorationProps {
    position?: "start" | "end";
    children: React.ReactNode;
}

@mobxReact.observer
class InputDecoration extends React.Component<InputDecorationProps, {}> {
    render() {
        const { children, position = "end" } = this.props;
        return (
            <div
                className={cn("wave-input-decoration", {
                    "start-position": position === "start",
                    "end-position": position === "end",
                })}
            >
                {children}
            </div>
        );
    }
}

export { InputDecoration };
