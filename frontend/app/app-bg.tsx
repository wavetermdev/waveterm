// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { MetaKeyAtomFnType, useWaveEnv, WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";
import { PLATFORM, PlatformMacOS } from "@/util/platformutil";
import { computeBgStyleFromMeta } from "@/util/waveutil";
import useResizeObserver from "@react-hook/resize-observer";
import { useAtomValue } from "jotai";
import { CSSProperties, useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { debounce } from "throttle-debounce";
import { atoms, getApi, WOS } from "./store/global";
import { useWaveObjectValue } from "./store/wos";

type AppBgEnv = WaveEnvSubset<{
    getTabMetaKeyAtom: MetaKeyAtomFnType<"tab:background">;
    getConfigBackgroundAtom: WaveEnv["getConfigBackgroundAtom"];
}>;

export function AppBackground() {
    const bgRef = useRef<HTMLDivElement>(null);
    const tabId = useAtomValue(atoms.staticTabId);
    const [tabData] = useWaveObjectValue<Tab>(WOS.makeORef("tab", tabId));
    const env = useWaveEnv<AppBgEnv>();
    const tabBg = useAtomValue(env.getTabMetaKeyAtom(tabId, "tab:background"));
    const configBg = useAtomValue(env.getConfigBackgroundAtom(tabBg));
    const resolvedMeta: Omit<BackgroundConfigType, "display:name"> = tabBg && configBg ? configBg : tabData?.meta;
    const style: CSSProperties = useMemo(() => {
        const computedStyle = computeBgStyleFromMeta(resolvedMeta, 0.5) ?? {};
        if (Object.keys(computedStyle).length > 0) {
            return computedStyle;
        }
        return {
            backgroundColor: "rgb(11, 18, 26)",
            backgroundImage: [
                "radial-gradient(circle at 18% 18%, rgba(102, 214, 174, 0.18), transparent 24%)",
                "radial-gradient(circle at 82% 16%, rgba(111, 173, 255, 0.2), transparent 26%)",
                "radial-gradient(circle at 52% 100%, rgba(143, 118, 255, 0.16), transparent 34%)",
                "linear-gradient(180deg, rgba(12, 18, 26, 0.98), rgba(8, 12, 18, 0.98))",
            ].join(", "),
        };
    }, [resolvedMeta]);
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

    return (
        <div
            ref={bgRef}
            className="pointer-events-none absolute top-0 left-0 w-full h-full z-[var(--zindex-app-background)]"
            style={style}
        />
    );
}
