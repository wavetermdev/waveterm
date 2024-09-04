import useResizeObserver from "@react-hook/resize-observer";
import { useCallback, useRef, useState } from "react";
import { debounce } from "throttle-debounce";

/**
 * Get the current dimensions for the specified element, and whether it is currently changing size. Update when the element resizes.
 * @param ref The reference to the element to observe.
 * @param delay The debounce delay to use for updating the dimensions.
 * @returns The dimensions of the element, and direction in which the dimensions are changing.
 */
const useDimensions = (ref: React.RefObject<HTMLElement>, delay = 0) => {
    const [dimensions, setDimensions] = useState<{
        height: number | null;
        width: number | null;
        widthDirection?: string;
        heightDirection?: string;
    }>({
        height: null,
        width: null,
    });

    const previousDimensions = useRef<{ height: number | null; width: number | null }>({
        height: null,
        width: null,
    });

    const updateDimensions = useCallback((entry: ResizeObserverEntry) => {
        const parentHeight = entry.contentRect.height;
        const parentWidth = entry.contentRect.width;

        let widthDirection = "";
        let heightDirection = "";

        if (previousDimensions.current.width !== null && previousDimensions.current.height !== null) {
            if (parentWidth > previousDimensions.current.width) {
                widthDirection = "expanding";
            } else if (parentWidth < previousDimensions.current.width) {
                widthDirection = "shrinking";
            } else {
                widthDirection = "unchanged";
            }

            if (parentHeight > previousDimensions.current.height) {
                heightDirection = "expanding";
            } else if (parentHeight < previousDimensions.current.height) {
                heightDirection = "shrinking";
            } else {
                heightDirection = "unchanged";
            }
        }

        previousDimensions.current = { height: parentHeight, width: parentWidth };

        setDimensions({ height: parentHeight, width: parentWidth, widthDirection, heightDirection });
    }, []);

    const fUpdateDimensions = useCallback(delay > 0 ? debounce(delay, updateDimensions) : updateDimensions, [
        updateDimensions,
        delay,
    ]);

    useResizeObserver(ref, fUpdateDimensions);

    return dimensions;
};

export { useDimensions };
