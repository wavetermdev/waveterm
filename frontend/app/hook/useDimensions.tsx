import debounce from "lodash.debounce";
import { useCallback, useEffect, useRef, useState } from "react";

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

    const updateDimensions = useCallback(() => {
        if (ref.current) {
            const element = ref.current;
            const style = window.getComputedStyle(element);
            const paddingTop = parseFloat(style.paddingTop);
            const paddingBottom = parseFloat(style.paddingBottom);
            const paddingLeft = parseFloat(style.paddingLeft);
            const paddingRight = parseFloat(style.paddingRight);
            const marginTop = parseFloat(style.marginTop);
            const marginBottom = parseFloat(style.marginBottom);
            const marginLeft = parseFloat(style.marginLeft);
            const marginRight = parseFloat(style.marginRight);

            const parentHeight = element.clientHeight - paddingTop - paddingBottom - marginTop - marginBottom;
            const parentWidth = element.clientWidth - paddingLeft - paddingRight - marginLeft - marginRight;

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
        }
    }, [ref]);

    const fUpdateDimensions = useCallback(delay > 0 ? debounce(updateDimensions, delay) : updateDimensions, [
        updateDimensions,
        delay,
    ]);

    useEffect(() => {
        const resizeObserver = new ResizeObserver(() => {
            fUpdateDimensions();
        });

        if (ref.current) {
            resizeObserver.observe(ref.current);
            fUpdateDimensions();
        }

        return () => {
            if (ref.current) {
                resizeObserver.unobserve(ref.current);
            }
            if (delay > 0) {
                fUpdateDimensions.cancel();
            }
        };
    }, [fUpdateDimensions]);

    return dimensions;
};

export { useDimensions };
