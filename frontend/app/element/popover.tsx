import { Button } from "@/element/button";
import {
    FloatingPortal,
    offset as offsetMiddleware,
    useClick,
    useDismiss,
    useFloating,
    useInteractions,
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

import "./popover.less";

interface PopoverProps {
    children: ReactNode;
    className?: string;
    placement?: Placement;
    offset?: number;
    onOpenChange?: (isOpen: boolean) => void;
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

const Popover = memo(({ children, className, placement = "bottom-start", offset = 3, onOpenChange }: PopoverProps) => {
    const [isOpen, setIsOpen] = useState(false);

    const { refs, floatingStyles, context } = useFloating({
        placement,
        open: isOpen,
        onOpenChange: setIsOpen,
        middleware: [offsetMiddleware(offset)],
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

    return <div className={clsx("popover", className)}>{renderChildren}</div>;
});

interface PopoverButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    isActive?: boolean;
    children: React.ReactNode;
    getReferenceProps?: () => any;
    as?: keyof JSX.IntrinsicElements | React.ComponentType<any>;
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
                userOnClick(event as any); // Your custom onClick logic
            }
            if (popoverOnClick) {
                popoverOnClick(event); // Popover's onClick logic
            }
        };

        return (
            <Button
                ref={ref}
                className={clsx("popover-button", className, { "is-active": isActive })}
                {...props} // Spread the rest of your props
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
