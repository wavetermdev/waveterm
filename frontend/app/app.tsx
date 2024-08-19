// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useWaveObjectValue } from "@/app/store/wos";
import { Workspace } from "@/app/workspace/workspace";
import { deleteLayoutModelForTab, getLayoutModelForTab } from "@/layout/index";
import { ContextMenuModel } from "@/store/contextmenu";
import { PLATFORM, WOS, atoms, getApi, globalStore, setBlockFocus } from "@/store/global";
import * as services from "@/store/services";
import { getWebServerEndpoint } from "@/util/endpoints";
import * as keyutil from "@/util/keyutil";
import * as util from "@/util/util";
import useResizeObserver from "@react-hook/resize-observer";
import clsx from "clsx";
import Color from "color";
import * as csstree from "css-tree";
import * as jotai from "jotai";
import "overlayscrollbars/overlayscrollbars.css";
import * as React from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { debounce } from "throttle-debounce";
import "./app.less";
import { CenteredDiv } from "./element/quickelems";

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

function switchTabAbs(index: number) {
    const ws = globalStore.get(atoms.workspace);
    const newTabIdx = index - 1;
    if (newTabIdx < 0 || newTabIdx >= ws.tabids.length) {
        return;
    }
    const newActiveTabId = ws.tabids[newTabIdx];
    services.ObjectService.SetActiveTab(newActiveTabId);
}

function switchTab(offset: number) {
    const ws = globalStore.get(atoms.workspace);
    const activeTabId = globalStore.get(atoms.tabAtom).oid;
    let tabIdx = -1;
    for (let i = 0; i < ws.tabids.length; i++) {
        if (ws.tabids[i] == activeTabId) {
            tabIdx = i;
            break;
        }
    }
    if (tabIdx == -1) {
        return;
    }
    const newTabIdx = (tabIdx + offset + ws.tabids.length) % ws.tabids.length;
    const newActiveTabId = ws.tabids[newTabIdx];
    console.log("switching tabs", tabIdx, newTabIdx, activeTabId, newActiveTabId, ws.tabids);
    services.ObjectService.SetActiveTab(newActiveTabId);
}

const transformRegexp = /translate3d\(\s*([0-9.]+)px\s*,\s*([0-9.]+)px,\s*0\)/;

function parseFloatFromCSS(s: string | number): number {
    if (typeof s == "number") {
        return s;
    }
    return parseFloat(s);
}

function readBoundsFromTransform(fullTransform: React.CSSProperties): Bounds {
    const transformProp = fullTransform.transform;
    if (transformProp == null || fullTransform.width == null || fullTransform.height == null) {
        return null;
    }
    const m = transformRegexp.exec(transformProp);
    if (m == null) {
        return null;
    }
    return {
        x: parseFloat(m[1]),
        y: parseFloat(m[2]),
        width: parseFloatFromCSS(fullTransform.width),
        height: parseFloatFromCSS(fullTransform.height),
    };
}

function boundsMapMaxX(m: Map<string, Bounds>): number {
    let max = 0;
    for (let p of m.values()) {
        if (p.x + p.width > max) {
            max = p.x + p.width;
        }
    }
    return max;
}

function boundsMapMaxY(m: Map<string, Bounds>): number {
    let max = 0;
    for (let p of m.values()) {
        if (p.y + p.height > max) {
            max = p.y + p.height;
        }
    }
    return max;
}

function findBlockAtPoint(m: Map<string, Bounds>, p: Point): string {
    for (let [blockId, bounds] of m.entries()) {
        if (p.x >= bounds.x && p.x <= bounds.x + bounds.width && p.y >= bounds.y && p.y <= bounds.y + bounds.height) {
            return blockId;
        }
    }
    return null;
}

function switchBlockIdx(index: number) {
    const tabId = globalStore.get(atoms.activeTabId);
    const tabAtom = WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId));
    const layoutModel = getLayoutModelForTab(tabAtom);
    if (layoutModel?.leafs == null) {
        return;
    }
    const newLeafIdx = index - 1;
    if (newLeafIdx < 0 || newLeafIdx >= layoutModel.leafs.length) {
        return;
    }
    const leaf = layoutModel.leafs[newLeafIdx];
    if (leaf?.data?.blockId == null) {
        return;
    }
    setBlockFocus(leaf.data.blockId);
}

function switchBlock(tabId: string, offsetX: number, offsetY: number) {
    console.log("switch block", offsetX, offsetY);
    if (offsetY == 0 && offsetX == 0) {
        return;
    }
    const tabAtom = WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId));
    const layoutModel = getLayoutModelForTab(tabAtom);
    const curBlockId = globalStore.get(atoms.waveWindow)?.activeblockid;
    const addlProps = globalStore.get(layoutModel.additionalProps);
    const blockPositions: Map<string, Bounds> = new Map();
    for (const leaf of layoutModel.leafs) {
        const pos = readBoundsFromTransform(addlProps[leaf.id]?.transform);
        if (pos) {
            blockPositions.set(leaf.data.blockId, pos);
        }
    }
    const curBlockPos = blockPositions.get(curBlockId);
    if (!curBlockPos) {
        return;
    }
    blockPositions.delete(curBlockId);
    const maxX = boundsMapMaxX(blockPositions);
    const maxY = boundsMapMaxY(blockPositions);
    const moveAmount = 10;
    let curX = curBlockPos.x + 1;
    let curY = curBlockPos.y + 1;
    while (true) {
        curX += offsetX * moveAmount;
        curY += offsetY * moveAmount;
        if (curX < 0 || curX > maxX || curY < 0 || curY > maxY) {
            return;
        }
        const blockId = findBlockAtPoint(blockPositions, { x: curX, y: curY });
        if (blockId != null) {
            setBlockFocus(blockId);
            return;
        }
    }
}

function AppSettingsUpdater() {
    const settings = jotai.useAtomValue(atoms.settingsConfigAtom);
    React.useEffect(() => {
        const isTransparentOrBlur = (settings?.window?.transparent || settings?.window?.blur) ?? false;
        const opacity = util.boundNumber(settings?.window?.opacity ?? 0.8, 0, 1);
        let baseBgColor = settings?.window?.bgcolor;
        console.log("window settings", settings.window);
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
    }, [settings?.window]);
    return null;
}

function encodeFileURL(file: string) {
    const webEndpoint = getWebServerEndpoint();
    return webEndpoint + `/wave/stream-file?path=${encodeURIComponent(file)}&no404=1`;
}

(window as any).csstree = csstree;

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
        debounce(10, () => {
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

function genericClose(tabId: string) {
    const tabORef = WOS.makeORef("tab", tabId);
    const tabAtom = WOS.getWaveObjectAtom<Tab>(tabORef);
    const tabData = globalStore.get(tabAtom);
    if (tabData == null) {
        return;
    }
    if (tabData.blockids == null || tabData.blockids.length == 0) {
        // close tab
        services.WindowService.CloseTab(tabId);
        deleteLayoutModelForTab(tabId);
        return;
    }
    // close block
    const activeBlockId = globalStore.get(atoms.waveWindow)?.activeblockid;
    if (activeBlockId == null) {
        return;
    }
    const layoutModel = getLayoutModelForTab(tabAtom);
    const curBlockLeafId = layoutModel.getNodeByBlockId(activeBlockId)?.id;
    layoutModel.closeNodeById(curBlockLeafId);
}

const simpleControlShiftAtom = jotai.atom(false);

const AppKeyHandlers = () => {
    const tabId = jotai.useAtomValue(atoms.activeTabId);

    function setControlShift() {
        globalStore.set(simpleControlShiftAtom, true);
        setTimeout(() => {
            const simpleState = globalStore.get(simpleControlShiftAtom);
            if (simpleState) {
                globalStore.set(atoms.controlShiftDelayAtom, true);
            }
        }, 400);
    }

    function unsetControlShift() {
        globalStore.set(simpleControlShiftAtom, false);
        globalStore.set(atoms.controlShiftDelayAtom, false);
    }

    function handleKeyUp(event: KeyboardEvent) {
        const waveEvent = keyutil.adaptFromReactOrNativeKeyEvent(event);
        if (waveEvent.key === "Control" || waveEvent.key === "Shift") {
            unsetControlShift();
        }
        if (waveEvent.key == "Meta") {
            if (waveEvent.control && waveEvent.shift) {
                setControlShift();
            }
        }
    }

    function handleKeyDown(waveEvent: WaveKeyboardEvent): boolean {
        if (waveEvent.key === "Control" || waveEvent.key === "Shift" || waveEvent.key === "Meta") {
            if (waveEvent.control && waveEvent.shift && !waveEvent.meta) {
                // Set the control and shift without the Meta key
                setControlShift();
            } else {
                // Unset if Meta is pressed
                unsetControlShift();
            }
            return false;
        }

        // global key handler for now (refactor later)
        if (keyutil.checkKeyPressed(waveEvent, "Cmd:]") || keyutil.checkKeyPressed(waveEvent, "Shift:Cmd:]")) {
            switchTab(1);
            return true;
        }
        if (keyutil.checkKeyPressed(waveEvent, "Cmd:[") || keyutil.checkKeyPressed(waveEvent, "Shift:Cmd:[")) {
            switchTab(-1);
            return true;
        }
        for (let idx = 1; idx <= 9; idx++) {
            if (keyutil.checkKeyPressed(waveEvent, `Cmd:${idx}`)) {
                switchTabAbs(idx);
                return true;
            }
        }
        for (let idx = 1; idx <= 9; idx++) {
            if (
                keyutil.checkKeyPressed(waveEvent, `Ctrl:Shift:c{Digit${idx}}`) ||
                keyutil.checkKeyPressed(waveEvent, `Ctrl:Shift:c{Numpad${idx}}`)
            ) {
                switchBlockIdx(idx);
                return true;
            }
        }
        if (keyutil.checkKeyPressed(waveEvent, "Ctrl:Shift:ArrowUp")) {
            switchBlock(tabId, 0, -1);
            return true;
        }
        if (keyutil.checkKeyPressed(waveEvent, "Ctrl:Shift:ArrowDown")) {
            switchBlock(tabId, 0, 1);
            return true;
        }
        if (keyutil.checkKeyPressed(waveEvent, "Ctrl:Shift:ArrowLeft")) {
            switchBlock(tabId, -1, 0);
            return true;
        }
        if (keyutil.checkKeyPressed(waveEvent, "Ctrl:Shift:ArrowRight")) {
            switchBlock(tabId, 1, 0);
            return true;
        }
        if (keyutil.checkKeyPressed(waveEvent, "Cmd:w")) {
            // close block, if no more blocks, close tab
            genericClose(tabId);
            return true;
        }
        return false;
    }
    React.useEffect(() => {
        const staticKeyDownHandler = keyutil.keydownWrapper(handleKeyDown);
        document.addEventListener("keydown", staticKeyDownHandler);
        const savedKeyUpHandler = handleKeyUp;
        document.addEventListener("keyup", savedKeyUpHandler);

        return () => {
            document.removeEventListener("keydown", staticKeyDownHandler);
            document.removeEventListener("keyup", savedKeyUpHandler);
        };
    }, []);
    return null;
};

const AppInner = () => {
    const [prefersReducedMotion, setPrefersReducedMotion] = React.useState(false);
    const prefersReducedMotionSetting = jotai.useAtomValue(atoms.reducedMotionPreferenceAtom);
    const client = jotai.useAtomValue(atoms.client);
    const windowData = jotai.useAtomValue(atoms.waveWindow);
    const isFullScreen = jotai.useAtomValue(atoms.isFullScreen);

    React.useEffect(() => {
        const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
        setPrefersReducedMotion(!reducedMotionQuery || reducedMotionQuery.matches);
        reducedMotionQuery.addEventListener("change", () => {
            setPrefersReducedMotion(reducedMotionQuery.matches);
        });
    }, []);

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
                "prefers-reduced-motion": prefersReducedMotion || prefersReducedMotionSetting,
            })}
            onContextMenu={handleContextMenu}
        >
            <AppBackground />
            <AppKeyHandlers />
            <AppSettingsUpdater />
            <DndProvider backend={HTML5Backend}>
                <Workspace />
            </DndProvider>
        </div>
    );
};

export { App };
