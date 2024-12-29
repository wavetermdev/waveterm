// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useRef } from "react";

export function useLongClick<T extends HTMLElement>(
    ref: React.RefObject<T>,
    onClick?: React.PointerEventHandler<T>,
    onLongClick?: React.PointerEventHandler<T>,
    disabled = false,
    ms = 300
) {
    const clickStartRef = useRef<number>(0);

    const startPress = useCallback((_: React.PointerEvent<T>) => {
        clickStartRef.current = Date.now();
    }, []);

    const stopPress = useCallback(
        (e: React.PointerEvent<T>) => {
            const clickStart = clickStartRef.current;
            clickStartRef.current = 0;
            if (clickStart !== 0) {
                const now = Date.now();
                const longClickTriggered = now - clickStart > ms;
                if (longClickTriggered && onLongClick) {
                    onLongClick?.(e);
                } else {
                    onClick?.(e);
                }
            }
        },
        [ms, onClick, onLongClick]
    );

    useEffect(() => {
        const element = ref.current;

        if (!element || disabled) return;

        const startPressBound = startPress.bind(element);
        const stopPressBound = stopPress.bind(element);

        element.addEventListener("pointerdown", startPressBound);
        element.addEventListener("pointerup", stopPressBound);

        return () => {
            element.removeEventListener("pointerdown", startPressBound);
            element.removeEventListener("pointerup", stopPressBound);
        };
    }, [ref.current, startPress, stopPress]);

    return ref;
}
