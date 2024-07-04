// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import debounce from "lodash.debounce";
import { useCallback, useEffect, useState } from "react";

const useParentHeight = (ref: React.RefObject<HTMLElement>) => {
    const [height, setHeight] = useState<number | null>(null);

    const updateHeight = useCallback(() => {
        if (ref.current) {
            const parentHeight = ref.current.getBoundingClientRect().height || 0;
            setHeight(parentHeight);
        }
    }, []);

    const debouncedUpdateHeight = useCallback(debounce(updateHeight, 100), [updateHeight]);

    useEffect(() => {
        const resizeObserver = new ResizeObserver(() => {
            debouncedUpdateHeight();
        });

        if (ref.current) {
            resizeObserver.observe(ref.current);
            updateHeight();
        }

        return () => {
            if (ref.current) {
                resizeObserver.unobserve(ref.current);
            }
            debouncedUpdateHeight.cancel();
        };
    }, [debouncedUpdateHeight, updateHeight]);

    return height;
};

export { useParentHeight };
