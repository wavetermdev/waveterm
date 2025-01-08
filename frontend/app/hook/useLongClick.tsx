// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useRef, useState } from "react";

export const useLongClick = (ref, onClick, onLongClick, disabled = false, ms = 300) => {
    const timerRef = useRef(null);
    const [longClickTriggered, setLongClickTriggered] = useState(false);

    const startPress = useCallback(
        (e: React.MouseEvent<any>) => {
            if (onLongClick == null) {
                return;
            }
            setLongClickTriggered(false);
            timerRef.current = setTimeout(() => {
                setLongClickTriggered(true);
                onLongClick?.(e);
            }, ms);
        },
        [onLongClick, ms]
    );

    const stopPress = useCallback(() => {
        clearTimeout(timerRef.current);
    }, []);

    const handleClick = useCallback(
        (e: React.MouseEvent<any>) => {
            if (longClickTriggered) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            onClick?.(e);
        },
        [longClickTriggered, onClick]
    );

    useEffect(() => {
        const element = ref.current;

        if (!element || disabled) return;

        element.addEventListener("mousedown", startPress);
        element.addEventListener("mouseup", stopPress);
        element.addEventListener("mouseleave", stopPress);
        element.addEventListener("click", handleClick);

        return () => {
            element.removeEventListener("mousedown", startPress);
            element.removeEventListener("mouseup", stopPress);
            element.removeEventListener("mouseleave", stopPress);
            element.removeEventListener("click", handleClick);
        };
    }, [ref.current, startPress, stopPress, handleClick]);

    return ref;
};
