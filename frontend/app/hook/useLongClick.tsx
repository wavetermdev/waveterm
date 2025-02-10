// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useRef } from "react";

export function useLongClick<T extends HTMLElement>(
    ref: React.RefObject<T>,
    onClick?: React.MouseEventHandler<T>,
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
                }
            }
        },
        [ms, onLongClick]
    );

    useEffect(() => {
        const element = ref.current;

        if (!element || disabled) return;

        const startPressBound = startPress.bind(element);
        const stopPressBound = stopPress.bind(element);
        const onClickBound = onClick?.bind(element);

        element.addEventListener("pointerdown", startPressBound);
        element.addEventListener("pointerup", stopPressBound);
        element.addEventListener("click", onClickBound);

        return () => {
            element.removeEventListener("pointerdown", startPressBound);
            element.removeEventListener("pointerup", stopPressBound);
            element.removeEventListener("click", onClickBound);
        };
    }, [ref.current, startPress, stopPress, onClick]);

    return ref;
}
