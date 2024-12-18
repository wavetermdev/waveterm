// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/element/button";
import type { Placement } from "@floating-ui/react";
import {
    arrow,
    autoUpdate,
    flip,
    FloatingPortal,
    offset,
    shift,
    useDismiss,
    useFloating,
    useFocus,
    useHover,
    useInteractions,
    useRole,
} from "@floating-ui/react";
import * as React from "react";

interface TooltipOptions {
    initialOpen?: boolean;
    placement?: Placement;
    open?: boolean;
    className?: string;
    showArrow?: boolean;
    onOpenChange?: (open: boolean) => void;
}

export const useTooltip = ({
    initialOpen = false,
    placement = "top",
    open: controlledOpen,
    onOpenChange: setControlledOpen,
}: TooltipOptions = {}) => {
    const arrowRef = React.useRef(null);
    const [uncontrolledOpen, setUncontrolledOpen] = React.useState(initialOpen);

    const open = controlledOpen ?? uncontrolledOpen;
    const setOpen = setControlledOpen ?? setUncontrolledOpen;

    const data = useFloating({
        placement,
        open,
        onOpenChange: setOpen,
        whileElementsMounted: autoUpdate,
        middleware: [offset(5), flip(), shift(), arrow({ element: arrowRef })],
    });

    const context = data.context;

    const hover = useHover(context, {
        move: false,
        enabled: controlledOpen == null,
    });
    const focus = useFocus(context, {
        enabled: controlledOpen == null,
    });
    const dismiss = useDismiss(context);
    const role = useRole(context, { role: "tooltip" });

    const interactions = useInteractions([hover, focus, dismiss, role]);

    return React.useMemo(
        () => ({
            open,
            setOpen,
            arrowRef,
            ...interactions,
            ...data,
        }),
        [open, setOpen, arrowRef, interactions, data]
    );
};

type ContextType = ReturnType<typeof useTooltip> | null;

const TooltipContext = React.createContext<ContextType>(null);

export const useTooltipState = () => {
    const context = React.useContext(TooltipContext);

    if (context == null) {
        throw new Error("Tooltip components must be wrapped in <Tooltip />");
    }

    return context;
};

export const Tooltip = ({ children, ...options }: { children: React.ReactNode } & TooltipOptions) => {
    // This can accept any props as options, e.g. `placement`,
    // or other positioning options.
    const tooltip = useTooltip(options);
    return <TooltipContext.Provider value={tooltip}>{children}</TooltipContext.Provider>;
};

export const TooltipTrigger = React.forwardRef<HTMLElement, React.HTMLProps<HTMLElement> & { asChild?: boolean }>(
    function TooltipTrigger({ children, asChild = false, ...props }, propRef) {
        const state = useTooltipState();

        const setRefs = (node: HTMLElement | null) => {
            state.refs.setReference(node); // Use Floating UI's ref for trigger
            if (typeof propRef === "function") propRef(node);
            else if (propRef) (propRef as React.MutableRefObject<HTMLElement | null>).current = node;

            // Handle child ref only if it's not a ReactPortal
            if (React.isValidElement(children) && children.type !== React.Fragment && "ref" in children) {
                if (typeof children.ref === "function") children.ref(node);
                else (children.ref as React.MutableRefObject<HTMLElement | null>).current = node;
            }
        };

        // Allow custom elements with asChild
        if (asChild && React.isValidElement(children)) {
            return React.cloneElement(
                children,
                state.getReferenceProps({
                    ref: setRefs,
                    ...props,
                    ...children.props,
                    "data-state": state.open ? "open" : "closed",
                })
            );
        }

        // Default trigger as a button
        return (
            <Button
                className="grey"
                ref={setRefs}
                data-state={state.open ? "open" : "closed"}
                {...state.getReferenceProps(props)}
            >
                {children}
            </Button>
        );
    }
);

export const TooltipContent = React.forwardRef<HTMLDivElement, React.HTMLProps<HTMLDivElement>>(
    function TooltipContent(props, propRef) {
        const state = useTooltipState();

        const ref = React.useMemo(() => {
            const setRef = (node: HTMLDivElement | null) => {
                state.refs.setFloating(node); // Use `refs.setFloating` from `useFloating`
                if (typeof propRef === "function") propRef(node);
                else if (propRef) (propRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
            };
            return setRef;
        }, [state.refs.setFloating, propRef]);

        const { x: arrowX, y: arrowY } = state.middlewareData.arrow ?? {};

        const staticSide =
            {
                top: "bottom",
                right: "left",
                bottom: "top",
                left: "right",
            }[state.placement.split("-")[0]] ?? "";

        return (
            <FloatingPortal>
                {state.open && (
                    <div
                        ref={ref}
                        style={{
                            position: state.strategy,
                            top: state.y ?? 0,
                            left: state.x ?? 0,
                            visibility: state.x == null ? "hidden" : "visible",
                            ...props.style,
                        }}
                        {...state.getFloatingProps(props)}
                    >
                        {props.children}
                        <div
                            ref={state.arrowRef}
                            style={{
                                position: "absolute",
                                width: "10px",
                                height: "10px",
                                background: "inherit",
                                left: arrowX != null ? `${arrowX}px` : "",
                                top: arrowY != null ? `${arrowY}px` : "",
                                [staticSide]: "-5px",
                                transform: "rotate(45deg)",
                            }}
                        />
                    </div>
                )}
            </FloatingPortal>
        );
    }
);
