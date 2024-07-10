import debounce from "lodash.debounce";
import { useCallback, useEffect, useState } from "react";

const useHeight = (ref: React.RefObject<HTMLElement>, delay = 0) => {
    const [height, setHeight] = useState<number | null>(null);

    const updateHeight = useCallback(() => {
        if (ref.current) {
            const element = ref.current;
            const style = window.getComputedStyle(element);
            const paddingTop = parseFloat(style.paddingTop);
            const paddingBottom = parseFloat(style.paddingBottom);
            const marginTop = parseFloat(style.marginTop);
            const marginBottom = parseFloat(style.marginBottom);
            const parentHeight = element.clientHeight - paddingTop - paddingBottom - marginTop - marginBottom;
            setHeight(parentHeight);
        }
    }, []);

    const fUpdateHeight = useCallback(delay > 0 ? debounce(updateHeight, delay) : updateHeight, [updateHeight, delay]);

    useEffect(() => {
        const resizeObserver = new ResizeObserver(() => {
            fUpdateHeight();
        });

        if (ref.current) {
            resizeObserver.observe(ref.current);
            fUpdateHeight();
        }

        return () => {
            if (ref.current) {
                resizeObserver.unobserve(ref.current);
            }
            if (delay > 0) {
                fUpdateHeight.cancel();
            }
        };
    }, [fUpdateHeight]);

    return height;
};

export { useHeight };
