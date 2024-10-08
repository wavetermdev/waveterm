// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useDimensionsWithExistingRef } from "@/app/hook/useDimensions";
import clsx from "clsx";
import { memo, useEffect, useRef } from "react";
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
    const domRect = useDimensionsWithExistingRef(scopeRef);
    const width = domRect?.width ?? 0;
    const height = domRect?.height ?? 0;

    useEffect(() => {
        const paletteEl = paletteRef.current;
        const anchorEl = anchorRef.current;
        if (paletteEl && anchorEl) {
            const { bottom, left } = anchorEl.getBoundingClientRect();
            paletteEl.style.position = "absolute";
            paletteEl.style.top = `${bottom}px`;
            paletteEl.style.left = `${left}px`;
        }
    }, [width, height, anchorRef]);

    return createPortal(
        <div ref={paletteRef} className={clsx("palette", className)}>
            {children}
        </div>,
        document.body
    );
});

Palette.displayName = "Palette";

export { Palette };
