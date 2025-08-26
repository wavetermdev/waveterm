// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/element/button";
import {
    autoUpdate,
    FloatingPortal,
    Middleware,
    offset as offsetMiddleware,
    useClick,
    useDismiss,
    useFloating,
    useInteractions,
    type OffsetOptions,
    type Placement,
} from "@floating-ui/react";
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

import "./popover.scss";

interface PopoverProps {
    children: ReactNode;
    className?: string;
    placement?: Placement;
    offset?: OffsetOptions;
    onDismiss?: () => void;
    middleware?: Middleware[];
}

const isPopoverButton = (
    element: ReactElement
): element is ReactElement<PopoverButtonProps, JSXElementConstructor<PopoverButtonProps>> => {
    return element.type === PopoverButton;
};

const isPopoverContent = (
    element: ReactElement
): element is ReactElement<PopoverContentProps, JSXElementConstructor<PopoverContentProps>> => {
    return element.type === PopoverContent;
};

const Popover = memo(
    forwardRef<HTMLDivElement, PopoverProps>(
        ({ children, className, placement = "bottom-start", offset = 3, onDismiss, middleware }, ref) => {
            const [isOpen, setIsOpen] = useState(false);

            const handleOpenChange = (open: boolean) => {
                setIsOpen(open);
                if (!open && onDismiss) {
                    onDismiss();
                }
            };

            if (offset === undefined) {
                offset = 3;
            }

            middleware ??= [];
            middleware.push(offsetMiddleware(offset));

            const { refs, floatingStyles, context } = useFloating({
                placement,
                open: isOpen,
                onOpenChange: handleOpenChange,
                middleware: middleware,
                whileElementsMounted: autoUpdate,
            });

            const click = useClick(context);
            const dismiss = useDismiss(context);
            const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss]);

            const renderChildren = Children.map(children, (child) => {
                if (isValidElement(child)) {
                    if (isPopoverButton(child)) {
                        return cloneElement(child as any, {
                            isActive: isOpen,
                            ref: refs.setReference,
                            getReferenceProps,
                            // Do not overwrite onClick
                        });
                    }

                    if (isPopoverContent(child)) {
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

            return (
                <div ref={ref} className={clsx("popover", className)}>
                    {renderChildren}
                </div>
            );
        }
    )
);

Popover.displayName = "Popover";

interface PopoverButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    isActive?: boolean;
    children: React.ReactNode;
    getReferenceProps?: () => any;
    as?: keyof React.JSX.IntrinsicElements | React.ComponentType<any>;
}

const PopoverButton = forwardRef<HTMLButtonElement | HTMLDivElement, PopoverButtonProps>(
    (
        {
            isActive,
            children,
            onClick: userOnClick, // Destructured from props
            getReferenceProps,
            className,
            as: Component = "button",
            ...props // The rest of the props, without onClick
        },
        ref
    ) => {
        const referenceProps = getReferenceProps?.() || {};
        const popoverOnClick = referenceProps.onClick;

        // Remove onClick from referenceProps to prevent it from overwriting our combinedOnClick
        const { onClick: refOnClick, ...restReferenceProps } = referenceProps;

        const combinedOnClick = (event: React.MouseEvent) => {
            if (userOnClick) {
                userOnClick(event as any); // Our custom onClick logic
            }
            if (popoverOnClick) {
                popoverOnClick(event); // Popover's onClick logic
            }
        };

        return (
            <Button
                ref={ref}
                className={clsx("popover-button", className, { "is-active": isActive })}
                {...props} // Spread the rest of the props
                {...restReferenceProps} // Spread referenceProps without onClick
                onClick={combinedOnClick} // Assign combined onClick after spreading
            >
                {children}
            </Button>
        );
    }
);

interface PopoverContentProps extends React.HTMLAttributes<HTMLDivElement> {
    children: React.ReactNode;
    getFloatingProps?: () => any;
}

const PopoverContent = forwardRef<HTMLDivElement, PopoverContentProps>(
    ({ children, className, getFloatingProps, style, ...props }, ref) => {
        return (
            <FloatingPortal>
                <div
                    ref={ref}
                    className={clsx("popover-content", className)}
                    style={style}
                    {...getFloatingProps?.()}
                    {...props}
                >
                    {children}
                </div>
            </FloatingPortal>
        );
    }
);

Popover.displayName = "Popover";
PopoverButton.displayName = "PopoverButton";
PopoverContent.displayName = "PopoverContent";

export { Popover, PopoverButton, PopoverContent };
export type { PopoverButtonProps, PopoverContentProps };
