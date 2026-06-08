// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useWaveEnv } from "@/app/waveenv/waveenv";
import { cn } from "@/util/util";
import {
    autoUpdate,
    flip,
    FloatingPortal,
    offset,
    safePolygon,
    shift,
    useFloating,
    useHover,
    useInteractions,
} from "@floating-ui/react";
import * as jotai from "jotai";
import { useEffect, useRef, useState } from "react";
import { BlockEnv } from "./blockenv";

interface PortForwardStatusIndicatorProps {
    blockId: string;
    divClassName?: string;
    placement?: "top" | "bottom" | "left" | "right";
}

export function PortForwardStatusIndicator({
    blockId,
    divClassName,
    placement = "bottom",
}: PortForwardStatusIndicatorProps) {
    const waveEnv = useWaveEnv<BlockEnv>();
    const connName = jotai.useAtomValue(waveEnv.getBlockMetaKeyAtom(blockId, "connection"));
    const connStatus = jotai.useAtomValue(waveEnv.getConnStatusAtom(connName));
    const forwardingRules = connStatus?.forwardingrules;

    const [isOpen, setIsOpen] = useState(false);
    const [isVisible, setIsVisible] = useState(false);
    const timeoutRef = useRef<number | null>(null);

    const handleClose = () => {
        setIsVisible(false);
        if (timeoutRef.current !== null) {
            window.clearTimeout(timeoutRef.current);
        }
        timeoutRef.current = window.setTimeout(() => {
            setIsOpen(false);
        }, 300);
    };

    const { refs, floatingStyles, context } = useFloating({
        open: isOpen,
        onOpenChange: (open) => {
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
        middleware: [offset(10), flip(), shift({ padding: 12 })],
        whileElementsMounted: autoUpdate,
    });

    useEffect(() => {
        return () => {
            if (timeoutRef.current !== null) {
                window.clearTimeout(timeoutRef.current);
            }
        };
    }, []);

    const hover = useHover(context, {
        handleClose: safePolygon(),
    });
    const { getReferenceProps, getFloatingProps } = useInteractions([hover]);

    // Don't render if no forwarding rules are active
    if (!forwardingRules || forwardingRules.length === 0) {
        return null;
    }

    const count = forwardingRules.length;

    return (
        <>
            <div ref={refs.setReference} {...getReferenceProps()} className={divClassName}>
                <i className="fa-sharp fa-solid fa-plug text-emerald-500" />
                <span className="text-[10px] text-emerald-500 font-medium ml-[-2px]">{count}</span>
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
                            "bg-zinc-800 border border-border rounded-md px-3 py-2.5 text-xs text-foreground shadow-xl z-50"
                        )}
                        onMouseDown={(e) => e.stopPropagation()}
                        onFocusCapture={(e) => e.stopPropagation()}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex flex-col gap-1.5 max-w-[320px]">
                            <div className="font-semibold text-sm flex items-center gap-2 text-secondary">
                                <i className="fa-sharp fa-solid fa-plug text-emerald-500" />
                                Port Forwarding
                            </div>
                            <div className="flex flex-col gap-1">
                                {forwardingRules.map((rule, idx) => (
                                    <div key={idx} className="text-xs text-secondary font-mono bg-zinc-900 rounded px-2 py-1">
                                        {rule}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </FloatingPortal>
            )}
        </>
    );
}