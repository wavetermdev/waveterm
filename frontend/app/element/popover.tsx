import { Button } from "@/element/button";
import {
    FloatingPortal,
    offset as offsetMiddleware,
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

    const toggleOpen = () => {
        setIsOpen((prev) => !prev);
        onOpenChange?.(!isOpen);
    };

    const { refs, floatingStyles, context } = useFloating({
        placement,
        open: isOpen,
        onOpenChange: setIsOpen,
        middleware: [offsetMiddleware(offset)],
    });

    const dismiss = useDismiss(context);
    const { getReferenceProps, getFloatingProps } = useInteractions([dismiss]);

    const renderChildren = Children.map(children, (child) => {
        if (isValidElement(child)) {
            if (isPopoverButton(child)) {
                return cloneElement(child as any, {
                    isActive: isOpen,
                    ref: refs.setReference,
                    getReferenceProps,
                    onClick: toggleOpen,
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
    onClick?: () => void;
    getReferenceProps?: () => any;
    as?: keyof JSX.IntrinsicElements | React.ComponentType<any>;
}

const PopoverButton = forwardRef<HTMLButtonElement | HTMLDivElement, PopoverButtonProps>(
    ({ isActive, children, onClick, getReferenceProps, className, as: Component = "button", ...props }, ref) => {
        return (
            <Button
                ref={ref}
                className={clsx("popover-button", className, { "is-active": isActive })}
                onClick={onClick}
                {...getReferenceProps?.()}
                {...props}
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
