// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { adaptFromElectronKeyEvent } from "@/util/keyutil";
import { Rectangle, shell, WebContentsView } from "electron";
import path from "path";
import { configureAuthKeyRequestInjection } from "./authkey";
import { setWasActive } from "./emain-activity";
import { handleCtrlShiftFocus, handleCtrlShiftState, shFrameNavHandler, shNavHandler } from "./emain-util";
import { waveWindowMap } from "./emain-window";
import { getElectronAppBasePath, isDevVite } from "./platform";

function computeBgColor(fullConfig: FullConfigType): string {
    const settings = fullConfig?.settings;
    const isTransparent = settings?.["window:transparent"] ?? false;
    const isBlur = !isTransparent && (settings?.["window:blur"] ?? false);
    if (isTransparent) {
        return "#00000000";
    } else if (isBlur) {
        return "#00000000";
    } else {
        return "#222222";
    }
}

const wcIdToWaveTabMap = new Map<number, WaveTabView>();

export function getWaveTabViewByWebContentsId(webContentsId: number): WaveTabView {
    return wcIdToWaveTabMap.get(webContentsId);
}

export class WaveTabView extends WebContentsView {
    isActiveTab: boolean;
    waveWindowId: string; // set when showing in an active window
    waveTabId: string; // always set, WaveTabViews are unique per tab
    lastUsedTs: number; // ts milliseconds
    createdTs: number; // ts milliseconds
    initPromise: Promise<void>;
    savedInitOpts: WaveInitOpts;
    waveReadyPromise: Promise<void>;
    initResolve: () => void;
    waveReadyResolve: () => void;

    constructor(fullConfig: FullConfigType) {
        console.log("createBareTabView");
        super({
            webPreferences: {
                preload: path.join(getElectronAppBasePath(), "preload", "index.cjs"),
                webviewTag: true,
            },
        });
        this.createdTs = Date.now();
        this.savedInitOpts = null;
        this.initPromise = new Promise((resolve, _) => {
            this.initResolve = resolve;
        });
        this.initPromise.then(() => {
            console.log("tabview init", Date.now() - this.createdTs + "ms");
        });
        this.waveReadyPromise = new Promise((resolve, _) => {
            this.waveReadyResolve = resolve;
        });
        wcIdToWaveTabMap.set(this.webContents.id, this);
        if (isDevVite) {
            this.webContents.loadURL(`${process.env.ELECTRON_RENDERER_URL}/index.html}`);
        } else {
            this.webContents.loadFile(path.join(getElectronAppBasePath(), "frontend", "index.html"));
        }
        this.webContents.on("destroyed", () => {
            wcIdToWaveTabMap.delete(this.webContents.id);
            removeWaveTabView(this.waveTabId);
        });
        this.setBackgroundColor(computeBgColor(fullConfig));
    }

    positionTabOnScreen(winBounds: Rectangle) {
        const curBounds = this.getBounds();
        if (
            curBounds.width == winBounds.width &&
            curBounds.height == winBounds.height &&
            curBounds.x == 0 &&
            curBounds.y == 0
        ) {
            return;
        }
        this.setBounds({ x: 0, y: 0, width: winBounds.width, height: winBounds.height });
    }

    positionTabOffScreen(winBounds: Rectangle) {
        this.setBounds({
            x: -15000,
            y: -15000,
            width: winBounds.width,
            height: winBounds.height,
        });
    }

    isOnScreen() {
        const bounds = this.getBounds();
        return bounds.x == 0 && bounds.y == 0;
    }

    destroy() {
        console.log("destroy tab", this.waveTabId);
        this.webContents.close();
        removeWaveTabView(this.waveTabId);

        // TODO: circuitous
        const waveWindow = waveWindowMap.get(this.waveWindowId);
        if (waveWindow) {
            waveWindow.allLoadedTabViews.delete(this.waveTabId);
        }
    }
}

let MaxCacheSize = 10;
const wcvCache = new Map<string, WaveTabView>();

export function setMaxTabCacheSize(size: number) {
    console.log("setMaxTabCacheSize", size);
    MaxCacheSize = size;
}

export function getWaveTabView(waveTabId: string): WaveTabView | undefined {
    const rtn = wcvCache.get(waveTabId);
    if (rtn) {
        rtn.lastUsedTs = Date.now();
    }
    return rtn;
}

function checkAndEvictCache(): void {
    if (wcvCache.size <= MaxCacheSize) {
        return;
    }
    const sorted = Array.from(wcvCache.values()).sort((a, b) => {
        // Prioritize entries which are active
        if (a.isActiveTab && !b.isActiveTab) {
            return -1;
        }
        // Otherwise, sort by lastUsedTs
        return a.lastUsedTs - b.lastUsedTs;
    });
    for (let i = 0; i < sorted.length - MaxCacheSize; i++) {
        if (sorted[i].isActiveTab) {
            // don't evict WaveTabViews that are currently showing in a window
            continue;
        }
        const tabView = sorted[i];
        tabView?.destroy();
    }
}

export function clearTabCache() {
    const wcVals = Array.from(wcvCache.values());
    for (let i = 0; i < wcVals.length; i++) {
        const tabView = wcVals[i];
        if (tabView.isActiveTab) {
            continue;
        }
        tabView?.destroy();
    }
}

// returns [tabview, initialized]
export function getOrCreateWebViewForTab(fullConfig: FullConfigType, tabId: string): [WaveTabView, boolean] {
    let tabView = getWaveTabView(tabId);
    if (tabView) {
        return [tabView, true];
    }
    tabView = getSpareTab(fullConfig);
    tabView.lastUsedTs = Date.now();
    tabView.waveTabId = tabId;
    setWaveTabView(tabId, tabView);
    tabView.webContents.on("will-navigate", shNavHandler);
    tabView.webContents.on("will-frame-navigate", shFrameNavHandler);
    tabView.webContents.on("did-attach-webview", (event, wc) => {
        wc.setWindowOpenHandler((details) => {
            tabView.webContents.send("webview-new-window", wc.id, details);
            return { action: "deny" };
        });
    });
    tabView.webContents.on("before-input-event", (e, input) => {
        const waveEvent = adaptFromElectronKeyEvent(input);
        // console.log("WIN bie", tabView.waveTabId.substring(0, 8), waveEvent.type, waveEvent.code);
        handleCtrlShiftState(tabView.webContents, waveEvent);
        setWasActive(true);
    });
    tabView.webContents.on("zoom-changed", (e) => {
        tabView.webContents.send("zoom-changed");
    });
    tabView.webContents.setWindowOpenHandler(({ url, frameName }) => {
        if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("file://")) {
            console.log("openExternal fallback", url);
            shell.openExternal(url);
        }
        console.log("window-open denied", url);
        return { action: "deny" };
    });
    tabView.webContents.on("blur", () => {
        handleCtrlShiftFocus(tabView.webContents, false);
    });
    configureAuthKeyRequestInjection(tabView.webContents.session);
    return [tabView, false];
}

export function setWaveTabView(waveTabId: string, wcv: WaveTabView): void {
    wcvCache.set(waveTabId, wcv);
    checkAndEvictCache();
}

function removeWaveTabView(waveTabId: string): void {
    wcvCache.delete(waveTabId);
}

let HotSpareTab: WaveTabView = null;

export function ensureHotSpareTab(fullConfig: FullConfigType) {
    console.log("ensureHotSpareTab");
    if (HotSpareTab == null) {
        HotSpareTab = new WaveTabView(fullConfig);
    }
}

export function getSpareTab(fullConfig: FullConfigType): WaveTabView {
    setTimeout(ensureHotSpareTab, 500);
    if (HotSpareTab != null) {
        const rtn = HotSpareTab;
        HotSpareTab = null;
        console.log("getSpareTab: returning hotspare");
        return rtn;
    } else {
        console.log("getSpareTab: creating new tab");
        return new WaveTabView(fullConfig);
    }
}
