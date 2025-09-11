// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import React, { createContext, memo, useCallback, useContext, useEffect, useState } from "react";
import { Streamdown } from "streamdown";

type ReasoningContextValue = {
    isStreaming: boolean;
    isOpen: boolean;
    setIsOpen: (open: boolean) => void;
    duration: number;
};

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

const useReasoning = () => {
    const context = useContext(ReasoningContext);
    if (!context) {
        throw new Error("Reasoning components must be used within Reasoning");
    }
    return context;
};

const AUTO_CLOSE_DELAY = 1000;

export const Reasoning = memo(
    ({
        className,
        isStreaming = false,
        open,
        defaultOpen = false,
        onOpenChange,
        duration: durationProp = 3,
        children,
    }: {
        className?: string;
        isStreaming?: boolean;
        open?: boolean;
        defaultOpen?: boolean;
        onOpenChange?: (open: boolean) => void;
        duration?: number;
        children: React.ReactNode;
    }) => {
        const [isOpen, setIsOpenState] = useState(defaultOpen);
        const [duration, setDuration] = useState(0);
        const [hasAutoClosedRef, setHasAutoClosedRef] = useState(false);
        const [startTime, setStartTime] = useState<number | null>(null);

        const setIsOpen = useCallback(
            (newOpen: boolean) => {
                setIsOpenState(newOpen);
                onOpenChange?.(newOpen);
            },
            [onOpenChange]
        );

        // Track duration when streaming starts and ends
        useEffect(() => {
            if (isStreaming) {
                if (startTime === null) {
                    setStartTime(Date.now());
                }
            } else if (startTime !== null) {
                setDuration(Math.round((Date.now() - startTime) / 1000));
                setStartTime(null);
            }
        }, [isStreaming, startTime]);

        // Don't auto-open or auto-close - let user control the state manually

        // Handle controlled open state
        useEffect(() => {
            if (open !== undefined) {
                setIsOpenState(open);
            }
        }, [open]);

        return (
            <ReasoningContext.Provider value={{ isStreaming, isOpen, setIsOpen, duration }}>
                <div className={`not-prose ${className || ""}`}>{children}</div>
            </ReasoningContext.Provider>
        );
    }
);

export const ReasoningTrigger = memo(
    ({
        className,
        title = "Reasoning",
        children,
        onClick,
    }: {
        className?: string;
        title?: string;
        children?: React.ReactNode;
        onClick?: () => void;
    }) => {
        const { isStreaming, isOpen, setIsOpen, duration } = useReasoning();

        const handleClick = useCallback(() => {
            setIsOpen(!isOpen);
            onClick?.();
        }, [isOpen, setIsOpen, onClick]);

        return (
            <button
                className={`flex items-center gap-2 text-muted-foreground text-sm cursor-pointer ${className || ""}`}
                onClick={handleClick}
            >
                {children ?? (
                    <>
                        {isStreaming ? <p>Thinking...</p> : <p>Thinking Done</p>}
                        <i
                            className={`fa-sharp fa-solid fa-chevron-right text-sm transition-transform ${
                                isOpen ? "rotate-90" : "rotate-0"
                            }`}
                        />
                    </>
                )}
            </button>
        );
    }
);

export const ReasoningContent = memo(({ className, children }: { className?: string; children: string }) => {
    const { isOpen } = useReasoning();

    if (!isOpen) return null;

    return (
        <div
            className={`mt-4 text-sm transition-all duration-200 ease-in-out ${
                isOpen ? "animate-in slide-in-from-top-2" : "animate-out slide-out-to-top-2"
            } text-popover-foreground outline-none ${className || ""}`}
        >
            <Streamdown className="grid gap-2 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{children}</Streamdown>
        </div>
    );
});

Reasoning.displayName = "Reasoning";
ReasoningTrigger.displayName = "ReasoningTrigger";
ReasoningContent.displayName = "ReasoningContent";
