// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import {
    FloatingPortal,
    autoUpdate,
    flip,
    offset,
    shift,
    useFloating,
    useHover,
    useInteractions,
} from "@floating-ui/react";
import { useCallback, useEffect, useRef, useState } from "react";

interface TooltipProps {
    children: React.ReactNode;
    content: React.ReactNode;
    placement?: "top" | "bottom" | "left" | "right";
    forceOpen?: boolean;
    disable?: boolean;
    openDelay?: number;
    divClassName?: string;
    divStyle?: React.CSSProperties;
    divOnClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
    divRef?: React.RefObject<HTMLDivElement>;
    hideOnClick?: boolean;
}

function TooltipInner({
    children,
    content,
    placement = "top",
    forceOpen = false,
    openDelay = 300,
    divClassName,
    divStyle,
    divOnClick,
    divRef,
    hideOnClick = false,
}: Omit<TooltipProps, "disable">) {
    const [isOpen, setIsOpen] = useState(forceOpen);
    const [isVisible, setIsVisible] = useState(false);
    const [clickDisabled, setClickDisabled] = useState(false);
    const timeoutRef = useRef<number | null>(null);
    const prevForceOpenRef = useRef<boolean>(forceOpen);

    const { refs, floatingStyles, context } = useFloating({
        open: isOpen,
        onOpenChange: (open) => {
            if (!open && forceOpen) {
                return;
            }
            if (open) {
                setIsOpen(true);
                if (timeoutRef.current !== null) {
                    window.clearTimeout(timeoutRef.current);
                }
                timeoutRef.current = window.setTimeout(() => {
                    setIsVisible(true);
                }, openDelay);
            } else {
                setIsVisible(false);
                if (timeoutRef.current !== null) {
                    window.clearTimeout(timeoutRef.current);
                }
                timeoutRef.current = window.setTimeout(() => {
                    setIsOpen(false);
                }, 300);
            }
        },
        placement,
        middleware: [offset(10), flip(), shift({ padding: 12 })],
        whileElementsMounted: autoUpdate,
    });

    useEffect(() => {
        if (forceOpen) {
            setIsOpen(true);
            setIsVisible(true);

            if (timeoutRef.current !== null) {
                window.clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
            }
        } else {
            if (context.open && !prevForceOpenRef.current) {
                // Keep it open if it's being hovered and wasn't forced open before
            } else {
                setIsVisible(false);

                if (timeoutRef.current !== null) {
                    window.clearTimeout(timeoutRef.current);
                }

                timeoutRef.current = window.setTimeout(() => {
                    setIsOpen(false);
                }, 300);
            }
        }

        prevForceOpenRef.current = forceOpen;
    }, [forceOpen, context.open]);

    useEffect(() => {
        return () => {
            if (timeoutRef.current !== null) {
                window.clearTimeout(timeoutRef.current);
            }
        };
    }, []);

    const hover = useHover(context, { enabled: !clickDisabled });
    const { getReferenceProps, getFloatingProps } = useInteractions([hover]);

    const handleClick = useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            if (hideOnClick) {
                setIsVisible(false);
                setIsOpen(false);
                if (timeoutRef.current !== null) {
                    window.clearTimeout(timeoutRef.current);
                }
                setClickDisabled(true);
            }
            divOnClick?.(e);
        },
        [hideOnClick, divOnClick]
    );

    const handlePointerEnter = useCallback(() => {
        if (hideOnClick && clickDisabled) {
            setClickDisabled(false);
        }
    }, [hideOnClick, clickDisabled]);

    return (
        <>
            <div
                ref={(node) => {
                    refs.setReference(node);
                    if (divRef) {
                        (divRef as React.RefObject<HTMLDivElement>).current = node;
                    }
                }}
                {...getReferenceProps()}
                className={divClassName}
                style={divStyle}
                onClick={handleClick}
                onPointerEnter={handlePointerEnter}
            >
                {children}
            </div>
            {isOpen && (
                <FloatingPortal>
                    <div
                        ref={refs.setFloating}
                        style={{
                            ...floatingStyles,
                            opacity: isVisible ? 1 : 0,
                            transition: "opacity 200ms ease",
                        }}
                        {...getFloatingProps()}
                        className={cn(
                            "bg-zinc-800 border border-border rounded-md px-2 py-1 text-xs text-foreground shadow-xl z-50"
                        )}
                    >
                        {content}
                    </div>
                </FloatingPortal>
            )}
        </>
    );
}

export function Tooltip({
    children,
    content,
    placement = "top",
    forceOpen = false,
    disable = false,
    openDelay = 300,
    divClassName,
    divStyle,
    divOnClick,
    divRef,
    hideOnClick = false,
}: TooltipProps) {
    if (disable) {
        return (
            <div ref={divRef} className={divClassName} style={divStyle} onClick={divOnClick}>
                {children}
            </div>
        );
    }

    return (
        <TooltipInner
            children={children}
            content={content}
            placement={placement}
            forceOpen={forceOpen}
            openDelay={openDelay}
            divClassName={divClassName}
            divStyle={divStyle}
            divOnClick={divOnClick}
            divRef={divRef}
            hideOnClick={hideOnClick}
        />
    );
}
