// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn } from "@/util/util";
import { useLayoutEffect, useRef, useState } from "react";

export const EmojiButton = ({ emoji, isClicked, onClick, className }: { emoji: string; isClicked: boolean; onClick: () => void; className?: string }) => {
    const [showFloating, setShowFloating] = useState(false);
    const prevClickedRef = useRef(isClicked);

    useLayoutEffect(() => {
        if (isClicked && !prevClickedRef.current) {
            setShowFloating(true);
            setTimeout(() => setShowFloating(false), 600);
        }
        prevClickedRef.current = isClicked;
    }, [isClicked]);

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
                {emoji}
            </button>
            {showFloating && (
                <span
                    className="absolute pointer-events-none animate-[float-up_0.6s_ease-out_forwards]"
                    style={{
                        left: "50%",
                        bottom: "100%",
                    }}
                >
                    {emoji}
                </span>
            )}
        </div>
    );
};