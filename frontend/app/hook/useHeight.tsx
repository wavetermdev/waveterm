// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import useResizeObserver from "@react-hook/resize-observer";
import { useCallback, useState } from "react";
import { debounce } from "throttle-debounce";

/**
 * Get the height of the specified element and update it when the element resizes.
 * @param ref The reference to the element to observe.
 * @param delay The debounce delay to use for updating the height.
 * @returns The current height of the element, or null if the element is not yet mounted.
 */
const useHeight = (ref: React.RefObject<HTMLElement>, delay = 0) => {
    const [height, setHeight] = useState<number | null>(null);

    const updateHeight = useCallback((entry: ResizeObserverEntry) => {
        setHeight(entry.contentRect.height);
    }, []);

    const fUpdateHeight = useCallback(delay > 0 ? debounce(delay, updateHeight) : updateHeight, [updateHeight, delay]);

    useResizeObserver(ref, fUpdateHeight);

    return height;
};

export { useHeight };
