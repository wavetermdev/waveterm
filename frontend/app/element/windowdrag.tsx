// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { clsx } from "clsx";
import React from "react";

import "./windowdrag.scss";

interface WindowDragProps {
    className?: string;
    style?: React.CSSProperties;
    children?: React.ReactNode;
    ref: React.RefObject<HTMLDivElement>;
}

const WindowDrag = ({ children, className, style, ref }: WindowDragProps) => {
    return (
        <div ref={ref} className={clsx(`window-drag`, className)} style={style}>
            {children}
        </div>
    );
};

export { WindowDrag };
