// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { clsx } from "clsx";
import React, { forwardRef } from "react";

import "./windowdrag.scss";

interface WindowDragProps {
    className?: string;
    children?: React.ReactNode;
}

const WindowDrag = forwardRef<HTMLDivElement, WindowDragProps>(({ children, className }, ref) => {
    return (
        <div ref={ref} className={clsx(`window-drag`, className)}>
            {children}
        </div>
    );
});

export { WindowDrag };
