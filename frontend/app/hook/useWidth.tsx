// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import useResizeObserver from "@react-hook/resize-observer";
import { useCallback, useState } from "react";
import { debounce } from "throttle-debounce";

/**
 * Get the width of the specified element and update it when the element resizes.
 * @param ref The reference to the element to observe.
 * @param delay The debounce delay to use for updating the width.
 * @returns The current width of the element, or null if the element is not yet mounted.
 */
const useWidth = (ref: React.RefObject<HTMLElement>, delay = 0) => {
    const [width, setWidth] = useState<number | null>(null);

    const updateWidth = useCallback((entry: ResizeObserverEntry) => {
        setWidth(entry.contentRect.width);
    }, []);

    const fUpdateWidth = useCallback(delay > 0 ? debounce(delay, updateWidth) : updateWidth, [updateWidth, delay]);

    useResizeObserver(ref, fUpdateWidth);

    return width;
};

export { useWidth };
