// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import debounce from "lodash.debounce";
import { useCallback, useEffect, useState } from "react";

const useParentHeight = (ref: React.RefObject<HTMLElement>, delay = 0) => {
    const [height, setHeight] = useState<number | null>(null);

    const updateHeight = useCallback(() => {
        if (ref.current) {
            const parentHeight = ref.current.getBoundingClientRect().height || 0;
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

export { useParentHeight };
