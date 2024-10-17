// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useDismiss, useFloating, useInteractions, type Placement } from "@floating-ui/react";
import clsx from "clsx";
import {
    Children,
    cloneElement,
    forwardRef,
    isValidElement,
    JSXElementConstructor,
    memo,
    ReactElement,
    ReactNode,
    useState,
} from "react";
import { Button } from "./button";

import "./palette.less";

interface PaletteProps {
    children: ReactNode;
    className?: string;
    placement?: Placement;
    onOpenChange?: (isOpen: boolean) => void;
}

const isPaletteButton = (
    element: ReactElement
): element is ReactElement<PaletteButtonProps, JSXElementConstructor<PaletteButtonProps>> => {
    return element.type === PaletteButton;
};

const isPaletteContent = (
    element: ReactElement
): element is ReactElement<PaletteContentProps, JSXElementConstructor<PaletteContentProps>> => {
    return element.type === PaletteContent;
};

const Palette = memo(({ children, className, placement, onOpenChange }: PaletteProps) => {
    const [isOpen, setIsOpen] = useState(false);

    const toggleOpen = () => {
        setIsOpen((prev) => !prev);
        onOpenChange?.(!isOpen);
    };

    const { refs, floatingStyles, context } = useFloating({
        placement: placement ?? "bottom-start",
        open: isOpen,
        onOpenChange: setIsOpen,
    });

    const dismiss = useDismiss(context);
    const { getReferenceProps, getFloatingProps } = useInteractions([dismiss]);

    const renderChildren = Children.map(children, (child) => {
        if (isValidElement(child)) {
            if (isPaletteButton(child)) {
                return cloneElement(child as any, {
                    isActive: isOpen,
                    ref: refs.setReference,
                    getReferenceProps,
                    onClick: toggleOpen,
                });
            }

            if (isPaletteContent(child)) {
                return isOpen
                    ? cloneElement(child as any, {
                          ref: refs.setFloating,
                          style: floatingStyles,
                          getFloatingProps,
                      })
                    : null;
            }
        }
        return child;
    });

    return <>{renderChildren}</>;
});

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

Palette.displayName = "Palette";
PaletteButton.displayName = "PaletteButton";
PaletteContent.displayName = "PaletteContent";

export { Palette, PaletteButton, PaletteContent, type PaletteButtonProps, type PaletteContentProps };
