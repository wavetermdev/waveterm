// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useWaveObjectValue } from "@/app/store/wos";
import { Workspace } from "@/app/workspace/workspace";
import { ContextMenuModel } from "@/store/contextmenu";
import { PLATFORM, WOS, atoms, getApi, globalStore, removeFlashError, useSettingsPrefixAtom } from "@/store/global";
import { appHandleKeyDown } from "@/store/keymodel";
import { getWebServerEndpoint } from "@/util/endpoints";
import { getElemAsStr } from "@/util/focusutil";
import * as keyutil from "@/util/keyutil";
import * as util from "@/util/util";
import useResizeObserver from "@react-hook/resize-observer";
import clsx from "clsx";
import Color from "color";
import * as csstree from "css-tree";
import debug from "debug";
import * as jotai from "jotai";
import "overlayscrollbars/overlayscrollbars.css";
import * as React from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { debounce } from "throttle-debounce";
import "./app.less";
import { CenteredDiv } from "./element/quickelems";

const dlog = debug("wave:app");
const focusLog = debug("wave:focus");

const App = () => {
    let Provider = jotai.Provider;
    return (
        <Provider store={globalStore}>
            <AppInner />
        </Provider>
    );
};

function isContentEditableBeingEdited() {
    const activeElement = document.activeElement;
    return (
        activeElement &&
        activeElement.getAttribute("contenteditable") !== null &&
        activeElement.getAttribute("contenteditable") !== "false"
    );
}

function canEnablePaste() {
    const activeElement = document.activeElement;
    return activeElement.tagName === "INPUT" || activeElement.tagName === "TEXTAREA" || isContentEditableBeingEdited();
}

function canEnableCopy() {
    const sel = window.getSelection();
    return !util.isBlank(sel?.toString());
}

function canEnableCut() {
    const sel = window.getSelection();
    if (document.activeElement?.classList.contains("xterm-helper-textarea")) {
        return false;
    }
    return !util.isBlank(sel?.toString()) && canEnablePaste();
}

function handleContextMenu(e: React.MouseEvent<HTMLDivElement>) {
    e.preventDefault();
    const canPaste = canEnablePaste();
    const canCopy = canEnableCopy();
    const canCut = canEnableCut();
    if (!canPaste && !canCopy && !canCut) {
        return;
    }
    let menu: ContextMenuItem[] = [];
    if (canCut) {
        menu.push({ label: "Cut", role: "cut" });
    }
    if (canCopy) {
        menu.push({ label: "Copy", role: "copy" });
    }
    if (canPaste) {
        menu.push({ label: "Paste", role: "paste" });
    }
    ContextMenuModel.showContextMenu(menu, e);
}

function AppSettingsUpdater() {
    const windowSettings = useSettingsPrefixAtom("window");
    React.useEffect(() => {
        const isTransparentOrBlur =
            (windowSettings?.["window:transparent"] || windowSettings?.["window:blur"]) ?? false;
        const opacity = util.boundNumber(windowSettings?.["window:opacity"] ?? 0.8, 0, 1);
        let baseBgColor = windowSettings?.["window:bgcolor"];
        if (isTransparentOrBlur) {
            document.body.classList.add("is-transparent");
            const rootStyles = getComputedStyle(document.documentElement);
            if (baseBgColor == null) {
                baseBgColor = rootStyles.getPropertyValue("--main-bg-color").trim();
            }
            const color = new Color(baseBgColor);
            const rgbaColor = color.alpha(opacity).string();
            document.body.style.backgroundColor = rgbaColor;
        } else {
            document.body.classList.remove("is-transparent");
            document.body.style.opacity = null;
        }
    }, [windowSettings]);
    return null;
}

function appFocusIn(e: FocusEvent) {
    focusLog("focusin", getElemAsStr(e.target), "<=", getElemAsStr(e.relatedTarget));
}

function appFocusOut(e: FocusEvent) {
    focusLog("focusout", getElemAsStr(e.target), "=>", getElemAsStr(e.relatedTarget));
}

function appSelectionChange(e: Event) {
    const selection = document.getSelection();
    focusLog("selectionchange", getElemAsStr(selection.anchorNode));
}

function AppFocusHandler() {
    return null;

    // for debugging
    React.useEffect(() => {
        document.addEventListener("focusin", appFocusIn);
        document.addEventListener("focusout", appFocusOut);
        document.addEventListener("selectionchange", appSelectionChange);
        const ivId = setInterval(() => {
            const activeElement = document.activeElement;
            if (activeElement instanceof HTMLElement) {
                focusLog("activeElement", getElemAsStr(activeElement));
            }
        }, 2000);
        return () => {
            document.removeEventListener("focusin", appFocusIn);
            document.removeEventListener("focusout", appFocusOut);
            document.removeEventListener("selectionchange", appSelectionChange);
            clearInterval(ivId);
        };
    });
    return null;
}

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
    const attrRe = /^background(-image):\s*/;
    cssText = cssText.replace(attrRe, "");
    const ast = csstree.parse("background: " + cssText, {
        context: "declaration",
    });
    let hasJSUrl = false;
    csstree.walk(ast, {
        visit: "Url",
        enter(node) {
            const originalUrl = node.value.trim();
            if (originalUrl.startsWith("javascript:")) {
                hasJSUrl = true;
                return;
            }
            if (originalUrl.startsWith("data:")) {
                return;
            }
            const newUrl = encodeFileURL(originalUrl);
            node.value = newUrl;
        },
    });
    if (hasJSUrl) {
        console.log("invalid background, contains a 'javascript' protocol url which is not allowed");
        return null;
    }
    const rtnStyle = csstree.generate(ast);
    if (rtnStyle == null) {
        return null;
    }
    return rtnStyle.replace(/^background:\s*/, "");
}

function AppBackground() {
    const bgRef = React.useRef<HTMLDivElement>(null);
    const tabId = jotai.useAtomValue(atoms.activeTabId);
    const [tabData] = useWaveObjectValue<Tab>(WOS.makeORef("tab", tabId));
    const bgAttr = tabData?.meta?.bg;
    const style: React.CSSProperties = {};
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
    const getAvgColor = React.useCallback(
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
    React.useLayoutEffect(getAvgColor, [getAvgColor]);
    useResizeObserver(bgRef, getAvgColor);

    return <div ref={bgRef} className="app-background" style={style} />;
}

const AppKeyHandlers = () => {
    React.useEffect(() => {
        const staticKeyDownHandler = keyutil.keydownWrapper(appHandleKeyDown);
        document.addEventListener("keydown", staticKeyDownHandler);

        return () => {
            document.removeEventListener("keydown", staticKeyDownHandler);
        };
    }, []);
    return null;
};

const FlashError = () => {
    const flashErrors = jotai.useAtomValue(atoms.flashErrors);
    const [hoveredId, setHoveredId] = React.useState<string>(null);
    const [ticker, setTicker] = React.useState<number>(0);

    React.useEffect(() => {
        if (flashErrors.length == 0 || hoveredId != null) {
            return;
        }
        const now = Date.now();
        for (let ferr of flashErrors) {
            if (ferr.expiration == null || ferr.expiration < now) {
                removeFlashError(ferr.id);
            }
        }
        setTimeout(() => setTicker(ticker + 1), 1000);
    }, [flashErrors, ticker, hoveredId]);

    if (flashErrors.length == 0) {
        return null;
    }

    function copyError(id: string) {
        const ferr = flashErrors.find((f) => f.id === id);
        if (ferr == null) {
            return;
        }
        let text = "";
        if (ferr.title != null) {
            text += ferr.title;
        }
        if (ferr.message != null) {
            if (text.length > 0) {
                text += "\n";
            }
            text += ferr.message;
        }
        navigator.clipboard.writeText(text);
    }

    function convertNewlinesToBreaks(text) {
        return text.split("\n").map((part, index) => (
            <React.Fragment key={index}>
                {part}
                <br />
            </React.Fragment>
        ));
    }

    return (
        <div className="flash-error-container">
            {flashErrors.map((err, idx) => (
                <div
                    key={idx}
                    className={clsx("flash-error", { hovered: hoveredId === err.id })}
                    onClick={() => copyError(err.id)}
                    onMouseEnter={() => setHoveredId(err.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    title="Click to Copy Error Message"
                >
                    <div className="flash-error-scroll">
                        {err.title != null ? <div className="flash-error-title">{err.title}</div> : null}
                        {err.message != null ? (
                            <div className="flash-error-message">{convertNewlinesToBreaks(err.message)}</div>
                        ) : null}
                    </div>
                </div>
            ))}
        </div>
    );
};

const AppInner = () => {
    const prefersReducedMotion = jotai.useAtomValue(atoms.prefersReducedMotionAtom);
    const client = jotai.useAtomValue(atoms.client);
    const windowData = jotai.useAtomValue(atoms.waveWindow);
    const isFullScreen = jotai.useAtomValue(atoms.isFullScreen);

    if (client == null || windowData == null) {
        return (
            <div className="mainapp">
                <AppBackground />
                <CenteredDiv>invalid configuration, client or window was not loaded</CenteredDiv>
            </div>
        );
    }

    return (
        <div
            className={clsx("mainapp", PLATFORM, {
                fullscreen: isFullScreen,
                "prefers-reduced-motion": prefersReducedMotion,
            })}
            onContextMenu={handleContextMenu}
        >
            <AppBackground />
            <AppKeyHandlers />
            <AppFocusHandler />
            <AppSettingsUpdater />
            <DndProvider backend={HTML5Backend}>
                <Workspace />
            </DndProvider>
            <FlashError />
        </div>
    );
};

export { App };
