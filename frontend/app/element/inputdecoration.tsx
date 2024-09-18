// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { clsx } from "clsx";
import * as React from "react";

import "./inputdecoration.less";

interface InputDecorationProps {
    position?: "start" | "end";
    children: React.ReactNode;
}

const InputDecoration = (props: InputDecorationProps) => {
    const { children, position = "end" } = props;
    return (
        <div
            className={clsx("input-decoration", {
                "start-position": position === "start",
                "end-position": position === "end",
            })}
        >
            {children}
        </div>
    );
};

export { InputDecoration };
