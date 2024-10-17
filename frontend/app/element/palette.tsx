import { useDismiss, useFloating, useInteractions, type Placement } from "@floating-ui/react";
import {
    Children,
    cloneElement,
    isValidElement,
    JSXElementConstructor,
    memo,
    ReactElement,
    ReactNode,
    useState,
} from "react";
import { PaletteButton, PaletteButtonProps } from "./palettebutton";
import { PaletteContent, PaletteContentProps } from "./palettecontent";

import "./palette.less";

// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

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

Palette.displayName = "Palette";

export { Palette };
