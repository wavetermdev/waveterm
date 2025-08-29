// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

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
import { cn } from "@/util/util";
import { useEffect, useRef, useState } from "react";

interface TooltipProps {
    children: React.ReactNode;
    content: React.ReactNode;
    placement?: "top" | "bottom" | "left" | "right";
    forceOpen?: boolean;
    divClassName?: string;
    divStyle?: React.CSSProperties;
    divOnClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
}

export function Tooltip({
    children,
    content,
    placement = "top",
    forceOpen = false,
    divClassName,
    divStyle,
    divOnClick,
}: TooltipProps) {
    const [isOpen, setIsOpen] = useState(forceOpen);
    const [isVisible, setIsVisible] = useState(false);
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
                }, 300);
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
        middleware: [
            offset(10),
            flip(),
            shift({ padding: 12 }),
        ],
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

    const hover = useHover(context);
    const { getReferenceProps, getFloatingProps } = useInteractions([hover]);

    return (
        <>
            <div
                ref={refs.setReference}
                {...getReferenceProps()}
                className={divClassName}
                style={divStyle}
                onClick={divOnClick}
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
                            "bg-gray-800 border border-border rounded-md px-2 py-1 text-xs text-foreground shadow-xl z-50"
                        )}
                    >
                        {content}
                    </div>
                </FloatingPortal>
            )}
        </>
    );
}