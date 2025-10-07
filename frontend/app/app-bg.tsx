// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { PLATFORM, PlatformMacOS } from "@/util/platformutil";
import { computeBgStyleFromMeta } from "@/util/waveutil";
import useResizeObserver from "@react-hook/resize-observer";
import { useAtomValue } from "jotai";
import { CSSProperties, useCallback, useLayoutEffect, useRef } from "react";
import { debounce } from "throttle-debounce";
import { atoms, getApi, WOS } from "./store/global";
import { useWaveObjectValue } from "./store/wos";

export function AppBackground() {
    const bgRef = useRef<HTMLDivElement>(null);
    const tabId = useAtomValue(atoms.staticTabId);
    const [tabData] = useWaveObjectValue<Tab>(WOS.makeORef("tab", tabId));
    const style: CSSProperties = computeBgStyleFromMeta(tabData?.meta, 0.5) ?? {};
    const getAvgColor = useCallback(
        debounce(30, () => {
            if (
                bgRef.current &&
                PLATFORM !== PlatformMacOS &&
                bgRef.current &&
                "windowControlsOverlay" in window.navigator
            ) {
                const titlebarRect: Dimensions = (window.navigator.windowControlsOverlay as any).getTitlebarAreaRect();
                const bgRect = bgRef.current.getBoundingClientRect();
                if (titlebarRect && bgRect) {
                    const windowControlsLeft = titlebarRect.width - titlebarRect.height;
                    const windowControlsRect: Dimensions = {
                        top: titlebarRect.top,
                        left: windowControlsLeft,
                        height: titlebarRect.height,
                        width: bgRect.width - bgRect.left - windowControlsLeft,
                    };
                    getApi().updateWindowControlsOverlay(windowControlsRect);
                }
            }
        }),
        [bgRef, style]
    );
    useLayoutEffect(getAvgColor, [getAvgColor]);
    useResizeObserver(bgRef, getAvgColor);

    return <div ref={bgRef} className="pointer-events-none absolute top-0 left-0 w-full h-full z-[var(--zindex-app-background)]" style={style} />;
}
