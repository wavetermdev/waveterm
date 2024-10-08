// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useDimensionsWithExistingRef } from "@/app/hook/useDimensions";
import clsx from "clsx";
import { memo, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import "./palette.less";

interface PaletteProps {
    anchorRef: React.RefObject<HTMLElement>;
    scopeRef: React.RefObject<HTMLElement>;
    children: React.ReactNode;
    className?: string;
}

const Palette = memo(({ children, className, anchorRef, scopeRef }: PaletteProps) => {
    const paletteRef = useRef<HTMLDivElement | null>(null);
    const [position, setPosition] = useState({ top: 0, left: 0 });
    const domRect = useDimensionsWithExistingRef(scopeRef);
    const width = domRect?.width ?? 0;
    const height = domRect?.height ?? 0;

    useEffect(() => {
        const paletteEl = paletteRef.current;
        const anchorEl = anchorRef.current;
        if (paletteEl && anchorEl) {
            const anchorRect = anchorEl.getBoundingClientRect();
            let { bottom, left } = anchorRect;

            // Check if the palette goes beyond the right edge of the window
            const rightEdge = left + paletteEl.offsetWidth;
            if (rightEdge > window.innerWidth) {
                left = window.innerWidth - paletteEl.offsetWidth - 10;
            }

            // Check if the palette goes beyond the bottom edge of the window
            if (bottom + paletteEl.offsetHeight > window.innerHeight) {
                bottom = anchorRect.top - paletteEl.offsetHeight;
            }

            setPosition({ top: bottom, left });
        }
    }, [anchorRef, scopeRef, width, height]);

    useEffect(() => {
        if (position.top > 0 && paletteRef.current?.style.visibility !== "visible") {
            paletteRef.current.style.visibility = "visible";
        }
    }, [position.top]);

    return createPortal(
        <div ref={paletteRef} style={{ top: position.top, left: position.left }} className={clsx("palette", className)}>
            {children}
        </div>,
        document.body
    );
});

Palette.displayName = "Palette";

export { Palette };
