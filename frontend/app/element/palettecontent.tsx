// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import clsx from "clsx";
import { forwardRef } from "react";

interface PaletteContentProps extends React.HTMLAttributes<HTMLDivElement> {
    children: React.ReactNode;
    getFloatingProps?: () => any;
}

const PaletteContent = forwardRef<HTMLDivElement, PaletteContentProps>(
    ({ children, className, getFloatingProps, style, ...props }, ref) => {
        return (
            <div
                ref={ref}
                className={clsx("palette-content", className)}
                style={style}
                {...getFloatingProps?.()}
                {...props}
            >
                {children}
            </div>
        );
    }
);

PaletteContent.displayName = "PaletteContent";

export { PaletteContent, type PaletteContentProps };
