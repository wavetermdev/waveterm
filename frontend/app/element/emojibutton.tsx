// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn, makeIconClass } from "@/util/util";
import { useLayoutEffect, useRef, useState } from "react";

export const EmojiButton = ({
    emoji,
    icon,
    isClicked,
    onClick,
    className,
    suppressFlyUp,
}: {
    emoji?: string;
    icon?: string;
    isClicked: boolean;
    onClick: () => void;
    className?: string;
    suppressFlyUp?: boolean;
}) => {
    const [showFloating, setShowFloating] = useState(false);
    const prevClickedRef = useRef(isClicked);

    useLayoutEffect(() => {
        if (isClicked && !prevClickedRef.current && !suppressFlyUp) {
            setShowFloating(true);
            setTimeout(() => setShowFloating(false), 600);
        }
        prevClickedRef.current = isClicked;
    }, [isClicked, suppressFlyUp]);

    const content = icon ? <i className={makeIconClass(icon, false)} /> : emoji;

    return (
        <div className="relative inline-block">
            <button
                onClick={onClick}
                className={cn(
                    "px-2 py-1 rounded border cursor-pointer transition-colors",
                    isClicked
                        ? "bg-accent/20 border-accent text-accent"
                        : "bg-transparent border-border/50 text-foreground/70 hover:border-border",
                    className
                )}
            >
                {content}
            </button>
            {showFloating && (
                <span
                    className="absolute pointer-events-none animate-[float-up_0.6s_ease-out_forwards]"
                    style={{
                        left: "50%",
                        bottom: "100%",
                    }}
                >
                    {content}
                </span>
            )}
        </div>
    );
};
