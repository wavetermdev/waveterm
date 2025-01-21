// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getWebServerEndpoint } from "@/util/endpoints";
import * as util from "@/util/util";
import useResizeObserver from "@react-hook/resize-observer";
import { generate as generateCSS, parse as parseCSS, walk as walkCSS } from "css-tree";
import { useAtomValue } from "jotai";
import { CSSProperties, useCallback, useLayoutEffect, useRef } from "react";
import { debounce } from "throttle-debounce";
import { atoms, getApi, PLATFORM, WOS } from "./store/global";
import { useWaveObjectValue } from "./store/wos";

function encodeFileURL(file: string) {
    const webEndpoint = getWebServerEndpoint();
    return webEndpoint + `/wave/stream-file?path=${encodeURIComponent(file)}&no404=1`;
}

function processBackgroundUrls(cssText: string): string {
    if (util.isBlank(cssText)) {
        return null;
    }
    cssText = cssText.trim();
    if (cssText.endsWith(";")) {
        cssText = cssText.slice(0, -1);
    }
    const attrRe = /^background(-image)?\s*:\s*/i;
    cssText = cssText.replace(attrRe, "");
    const ast = parseCSS("background: " + cssText, {
        context: "declaration",
    });
    let hasUnsafeUrl = false;
    walkCSS(ast, {
        visit: "Url",
        enter(node) {
            const originalUrl = node.value.trim();
            if (
                originalUrl.startsWith("http:") ||
                originalUrl.startsWith("https:") ||
                originalUrl.startsWith("data:")
            ) {
                return;
            }
            // allow file:/// urls (if they are absolute)
            if (originalUrl.startsWith("file://")) {
                const path = originalUrl.slice(7);
                if (!path.startsWith("/")) {
                    console.log(`Invalid background, contains a non-absolute file URL: ${originalUrl}`);
                    hasUnsafeUrl = true;
                    return;
                }
                const newUrl = encodeFileURL(path);
                node.value = newUrl;
                return;
            }
            // allow absolute paths
            if (originalUrl.startsWith("/") || originalUrl.startsWith("~/")) {
                const newUrl = encodeFileURL(originalUrl);
                node.value = newUrl;
                return;
            }
            hasUnsafeUrl = true;
            console.log(`Invalid background, contains an unsafe URL scheme: ${originalUrl}`);
        },
    });
    if (hasUnsafeUrl) {
        return null;
    }
    const rtnStyle = generateCSS(ast);
    if (rtnStyle == null) {
        return null;
    }
    return rtnStyle.replace(/^background:\s*/, "");
}

export function AppBackground() {
    const bgRef = useRef<HTMLDivElement>(null);
    const tabId = useAtomValue(atoms.staticTabId);
    const [tabData] = useWaveObjectValue<Tab>(WOS.makeORef("tab", tabId));
    const bgAttr = tabData?.meta?.bg;
    const style: CSSProperties = {};
    if (!util.isBlank(bgAttr)) {
        try {
            const processedBg = processBackgroundUrls(bgAttr);
            if (!util.isBlank(processedBg)) {
                const opacity = util.boundNumber(tabData?.meta?.["bg:opacity"], 0, 1) ?? 0.5;
                style.opacity = opacity;
                style.background = processedBg;
                const blendMode = tabData?.meta?.["bg:blendmode"];
                if (!util.isBlank(blendMode)) {
                    style.backgroundBlendMode = blendMode;
                }
            }
        } catch (e) {
            console.error("error processing background", e);
        }
    }
    const getAvgColor = useCallback(
        debounce(30, () => {
            if (
                bgRef.current &&
                PLATFORM !== "darwin" &&
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

    return <div ref={bgRef} className="app-background" style={style} />;
}
