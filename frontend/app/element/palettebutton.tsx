// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import clsx from "clsx";
import { forwardRef } from "react";
import { Button } from "./button";

interface PaletteButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    isActive?: boolean;
    children: React.ReactNode;
    onClick?: () => void;
    getReferenceProps?: () => any;
}

const PaletteButton = forwardRef<HTMLButtonElement, PaletteButtonProps>(
    ({ isActive, children, onClick, getReferenceProps, className, ...props }, ref) => {
        return (
            <Button
                ref={ref}
                className={clsx("ghost grey palette-button", className, { "is-active": isActive })}
                onClick={onClick}
                {...getReferenceProps?.()}
                {...props}
            >
                {children}
            </Button>
        );
    }
);

PaletteButton.displayName = "PaletteButton";

export { PaletteButton, type PaletteButtonProps };
