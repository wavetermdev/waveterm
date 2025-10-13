// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useLayoutEffect, useState } from "react";

export type CommandRevealProps = {
    command: string;
    typeIntervalMs?: number;
    onComplete?: () => void;
    showCursor?: boolean;
};

export const CommandReveal = ({
    command,
    typeIntervalMs = 100,
    onComplete,
    showCursor: showCursorProp = true,
}: CommandRevealProps) => {
    const [displayedText, setDisplayedText] = useState("");
    const [showCursor, setShowCursor] = useState(true);

    useLayoutEffect(() => {
        let charIndex = 0;
        const typeInterval = setInterval(() => {
            if (charIndex < command.length) {
                setDisplayedText(command.slice(0, charIndex + 1));
                charIndex++;
            } else {
                clearInterval(typeInterval);
                if (onComplete) {
                    onComplete();
                }
            }
        }, typeIntervalMs);

        const cursorInterval = setInterval(() => {
            setShowCursor((prev) => !prev);
        }, 500);

        return () => {
            clearInterval(typeInterval);
            clearInterval(cursorInterval);
        };
    }, [command, typeIntervalMs, onComplete]);

    return (
        <div className="flex items-center gap-2 font-mono text-sm">
            <span className="text-accent">&gt;</span>
            <span className="text-foreground/80">
                {displayedText}
                {showCursorProp && showCursor && <span className="inline-block w-2 h-4 bg-foreground/80 ml-0.5 align-middle"></span>}
            </span>
        </div>
    );
};