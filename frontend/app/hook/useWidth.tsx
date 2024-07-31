import debounce from "lodash.debounce";
import { useCallback, useEffect, useState } from "react";

const useWidth = (ref: React.RefObject<HTMLElement>, delay = 0) => {
    const [width, setWidth] = useState<number | null>(null);

    const updateWidth = useCallback(() => {
        if (ref.current) {
            const element = ref.current;
            const style = window.getComputedStyle(element);
            const paddingLeft = parseFloat(style.paddingLeft);
            const paddingRight = parseFloat(style.paddingRight);
            const marginLeft = parseFloat(style.marginLeft);
            const marginRight = parseFloat(style.marginRight);
            const parentWidth = element.clientWidth - paddingLeft - paddingRight - marginLeft - marginRight;
            setWidth(parentWidth);
        }
    }, []);

    const fUpdateWidth = useCallback(delay > 0 ? debounce(updateWidth, delay) : updateWidth, [updateWidth, delay]);

    useEffect(() => {
        const resizeObserver = new ResizeObserver(() => {
            fUpdateWidth();
        });

        if (ref.current) {
            resizeObserver.observe(ref.current);
            fUpdateWidth();
        }

        return () => {
            if (ref.current) {
                resizeObserver.unobserve(ref.current);
            }
            if (delay > 0) {
                fUpdateWidth.cancel();
            }
        };
    }, [fUpdateWidth]);

    return width;
};

export { useWidth };
