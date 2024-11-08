// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as electron from "electron";
import * as path from "path";
import { debounce } from "throttle-debounce";
import { ClientService, FileService, ObjectService, WindowService } from "../frontend/app/store/services";
import * as keyutil from "../frontend/util/keyutil";
import { configureAuthKeyRequestInjection } from "./authkey";
import {
    getGlobalIsQuitting,
    getGlobalIsRelaunching,
    getGlobalIsStarting,
    setWasActive,
    setWasInFg,
} from "./emain-activity";
import {
    delay,
    ensureBoundsAreVisible,
    handleCtrlShiftFocus,
    handleCtrlShiftState,
    shFrameNavHandler,
    shNavHandler,
} from "./emain-util";
import { getElectronAppBasePath, isDevVite } from "./platform";
import { updater } from "./updater";

let MaxCacheSize = 10;
let HotSpareTab: WaveTabView = null;

const waveWindowMap = new Map<string, WaveBrowserWindow>(); // waveWindowId -> WaveBrowserWindow
let focusedWaveWindow = null; // on blur we do not set this to null (but on destroy we do)
const wcvCache = new Map<string, WaveTabView>();
const wcIdToWaveTabMap = new Map<number, WaveTabView>();
let tabSwitchQueue: { bwin: WaveBrowserWindow; tabView: WaveTabView; tabInitialized: boolean }[] = [];

export function setMaxTabCacheSize(size: number) {
    console.log("setMaxTabCacheSize", size);
    MaxCacheSize = size;
}

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

function createBareTabView(fullConfig: FullConfigType): WaveTabView {
    console.log("createBareTabView");
    const tabView = new electron.WebContentsView({
        webPreferences: {
            preload: path.join(getElectronAppBasePath(), "preload", "index.cjs"),
            webviewTag: true,
        },
    }) as WaveTabView;
    tabView.createdTs = Date.now();
    tabView.savedInitOpts = null;
    tabView.initPromise = new Promise((resolve, _) => {
        tabView.initResolve = resolve;
    });
    tabView.initPromise.then(() => {
        console.log("tabview init", Date.now() - tabView.createdTs + "ms");
    });
    tabView.waveReadyPromise = new Promise((resolve, _) => {
        tabView.waveReadyResolve = resolve;
    });
    wcIdToWaveTabMap.set(tabView.webContents.id, tabView);
    if (isDevVite) {
        tabView.webContents.loadURL(`${process.env.ELECTRON_RENDERER_URL}/index.html}`);
    } else {
        tabView.webContents.loadFile(path.join(getElectronAppBasePath(), "frontend", "index.html"));
    }
    tabView.webContents.on("destroyed", () => {
        wcIdToWaveTabMap.delete(tabView.webContents.id);
        removeWaveTabView(tabView.waveWindowId, tabView.waveTabId);
    });
    tabView.setBackgroundColor(computeBgColor(fullConfig));
    return tabView;
}

function positionTabOffScreen(tabView: WaveTabView, winBounds: Electron.Rectangle) {
    if (tabView == null) {
        return;
    }
    tabView.setBounds({
        x: -15000,
        y: -15000,
        width: winBounds.width,
        height: winBounds.height,
    });
}

async function repositionTabsSlowly(waveWindow: WaveBrowserWindow, delayMs: number) {
    const activeTabView = waveWindow.activeTabView;
    const winBounds = waveWindow.getContentBounds();
    if (activeTabView == null) {
        return;
    }
    if (isOnScreen(activeTabView)) {
        activeTabView.setBounds({
            x: 0,
            y: 0,
            width: winBounds.width,
            height: winBounds.height,
        });
    } else {
        activeTabView.setBounds({
            x: winBounds.width - 10,
            y: winBounds.height - 10,
            width: winBounds.width,
            height: winBounds.height,
        });
    }
    await delay(delayMs);
    if (waveWindow.activeTabView != activeTabView) {
        // another tab view has been set, do not finalize this layout
        return;
    }
    finalizePositioning(waveWindow);
}

function isOnScreen(tabView: WaveTabView) {
    const bounds = tabView.getBounds();
    return bounds.x == 0 && bounds.y == 0;
}

function finalizePositioning(waveWindow: WaveBrowserWindow) {
    if (waveWindow.isDestroyed()) {
        return;
    }
    const curBounds = waveWindow.getContentBounds();
    positionTabOnScreen(waveWindow.activeTabView, curBounds);
    for (const tabView of waveWindow.allTabViews.values()) {
        if (tabView == waveWindow.activeTabView) {
            continue;
        }
        positionTabOffScreen(tabView, curBounds);
    }
}

function positionTabOnScreen(tabView: WaveTabView, winBounds: Electron.Rectangle) {
    if (tabView == null) {
        return;
    }
    const curBounds = tabView.getBounds();
    if (
        curBounds.width == winBounds.width &&
        curBounds.height == winBounds.height &&
        curBounds.x == 0 &&
        curBounds.y == 0
    ) {
        return;
    }
    tabView.setBounds({ x: 0, y: 0, width: winBounds.width, height: winBounds.height });
}

export function getWaveTabViewByWebContentsId(webContentsId: number): WaveTabView {
    return wcIdToWaveTabMap.get(webContentsId);
}

export function getWaveWindowByWebContentsId(webContentsId: number): WaveBrowserWindow {
    const tabView = wcIdToWaveTabMap.get(webContentsId);
    if (tabView == null) {
        return null;
    }
    return waveWindowMap.get(tabView.waveWindowId);
}

export function getWaveWindowById(windowId: string): WaveBrowserWindow {
    return waveWindowMap.get(windowId);
}

export function getAllWaveWindows(): WaveBrowserWindow[] {
    return Array.from(waveWindowMap.values());
}

export function getFocusedWaveWindow(): WaveBrowserWindow {
    return focusedWaveWindow;
}

export function ensureHotSpareTab(fullConfig: FullConfigType) {
    console.log("ensureHotSpareTab");
    if (HotSpareTab == null) {
        HotSpareTab = createBareTabView(fullConfig);
    }
}

export function destroyWindow(waveWindow: WaveBrowserWindow) {
    if (waveWindow == null) {
        return;
    }
    console.log("destroy win", waveWindow.waveWindowId);
    for (const tabView of waveWindow.allTabViews.values()) {
        destroyTab(tabView);
    }
    waveWindowMap.delete(waveWindow.waveWindowId);
}

export function destroyTab(tabView: WaveTabView) {
    if (tabView == null) {
        return;
    }
    console.log("destroy tab", tabView.waveTabId);
    tabView.webContents.close();
    wcIdToWaveTabMap.delete(tabView.webContents.id);
    removeWaveTabView(tabView.waveWindowId, tabView.waveTabId);
    const waveWindow = waveWindowMap.get(tabView.waveWindowId);
    if (waveWindow) {
        waveWindow.allTabViews.delete(tabView.waveTabId);
    }
}

function getSpareTab(fullConfig: FullConfigType): WaveTabView {
    setTimeout(ensureHotSpareTab, 500);
    if (HotSpareTab != null) {
        const rtn = HotSpareTab;
        HotSpareTab = null;
        console.log("getSpareTab: returning hotspare");
        return rtn;
    } else {
        console.log("getSpareTab: creating new tab");
        return createBareTabView(fullConfig);
    }
}

function getWaveTabView(waveWindowId: string, waveTabId: string): WaveTabView | undefined {
    const cacheKey = waveWindowId + "|" + waveTabId;
    const rtn = wcvCache.get(cacheKey);
    if (rtn) {
        rtn.lastUsedTs = Date.now();
    }
    return rtn;
}

function setWaveTabView(waveWindowId: string, waveTabId: string, wcv: WaveTabView): void {
    const cacheKey = waveWindowId + "|" + waveTabId;
    wcvCache.set(cacheKey, wcv);
    checkAndEvictCache();
}

function removeWaveTabView(waveWindowId: string, waveTabId: string): void {
    const cacheKey = waveWindowId + "|" + waveTabId;
    wcvCache.delete(cacheKey);
}

function forceRemoveAllTabsForWindow(waveWindowId: string): void {
    const keys = Array.from(wcvCache.keys());
    for (const key of keys) {
        if (key.startsWith(waveWindowId)) {
            wcvCache.delete(key);
        }
    }
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
        destroyTab(tabView);
    }
}

export function clearTabCache() {
    const wcVals = Array.from(wcvCache.values());
    for (let i = 0; i < wcVals.length; i++) {
        const tabView = wcVals[i];
        if (tabView.isActiveTab) {
            continue;
        }
        destroyTab(tabView);
    }
}

// returns [tabview, initialized]
function getOrCreateWebViewForTab(fullConfig: FullConfigType, windowId: string, tabId: string): [WaveTabView, boolean] {
    let tabView = getWaveTabView(windowId, tabId);
    if (tabView) {
        return [tabView, true];
    }
    tabView = getSpareTab(fullConfig);
    tabView.lastUsedTs = Date.now();
    tabView.waveTabId = tabId;
    tabView.waveWindowId = windowId;
    setWaveTabView(windowId, tabId, tabView);
    tabView.webContents.on("will-navigate", shNavHandler);
    tabView.webContents.on("will-frame-navigate", shFrameNavHandler);
    tabView.webContents.on("did-attach-webview", (event, wc) => {
        wc.setWindowOpenHandler((details) => {
            tabView.webContents.send("webview-new-window", wc.id, details);
            return { action: "deny" };
        });
    });
    tabView.webContents.on("before-input-event", (e, input) => {
        const waveEvent = keyutil.adaptFromElectronKeyEvent(input);
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
            electron.shell.openExternal(url);
        }
        console.log("window-open denied", url);
        return { action: "deny" };
    });
    tabView.webContents.on("focus", () => {
        setWasInFg(true);
        setWasActive(true);
        if (getGlobalIsStarting()) {
            return;
        }
    });
    tabView.webContents.on("blur", () => {
        handleCtrlShiftFocus(tabView.webContents, false);
    });
    configureAuthKeyRequestInjection(tabView.webContents.session);
    return [tabView, false];
}

async function mainResizeHandler(_: any, windowId: string, win: WaveBrowserWindow) {
    if (win == null || win.isDestroyed() || win.fullScreen) {
        return;
    }
    const bounds = win.getBounds();
    try {
        await WindowService.SetWindowPosAndSize(
            windowId,
            { x: bounds.x, y: bounds.y },
            { width: bounds.width, height: bounds.height }
        );
    } catch (e) {
        console.log("error sending new window bounds to backend", e);
    }
}

type WindowOpts = {
    unamePlatform: string;
};

function createBaseWaveBrowserWindow(
    waveWindow: WaveWindow,
    fullConfig: FullConfigType,
    opts: WindowOpts
): WaveBrowserWindow {
    console.log("create win", waveWindow.oid);
    let winWidth = waveWindow?.winsize?.width;
    let winHeight = waveWindow?.winsize?.height;
    let winPosX = waveWindow.pos.x;
    let winPosY = waveWindow.pos.y;
    if (winWidth == null || winWidth == 0) {
        const primaryDisplay = electron.screen.getPrimaryDisplay();
        const { width } = primaryDisplay.workAreaSize;
        winWidth = width - winPosX - 100;
        if (winWidth > 2000) {
            winWidth = 2000;
        }
    }
    if (winHeight == null || winHeight == 0) {
        const primaryDisplay = electron.screen.getPrimaryDisplay();
        const { height } = primaryDisplay.workAreaSize;
        winHeight = height - winPosY - 100;
        if (winHeight > 1200) {
            winHeight = 1200;
        }
    }
    let winBounds = {
        x: winPosX,
        y: winPosY,
        width: winWidth,
        height: winHeight,
    };
    winBounds = ensureBoundsAreVisible(winBounds);
    const settings = fullConfig?.settings;
    const winOpts: Electron.BaseWindowConstructorOptions = {
        titleBarStyle:
            opts.unamePlatform === "darwin" ? "hiddenInset" : settings["window:nativetitlebar"] ? "default" : "hidden",
        titleBarOverlay:
            opts.unamePlatform !== "darwin"
                ? {
                      symbolColor: "white",
                      color: "#00000000",
                  }
                : false,
        x: winBounds.x,
        y: winBounds.y,
        width: winBounds.width,
        height: winBounds.height,
        minWidth: 400,
        minHeight: 300,
        icon:
            opts.unamePlatform == "linux"
                ? path.join(getElectronAppBasePath(), "public/logos/wave-logo-dark.png")
                : undefined,
        show: false,
        autoHideMenuBar: !settings?.["window:showmenubar"],
    };
    const isTransparent = settings?.["window:transparent"] ?? false;
    const isBlur = !isTransparent && (settings?.["window:blur"] ?? false);
    if (isTransparent) {
        winOpts.transparent = true;
    } else if (isBlur) {
        switch (opts.unamePlatform) {
            case "win32": {
                winOpts.backgroundMaterial = "acrylic";
                break;
            }
            case "darwin": {
                winOpts.vibrancy = "fullscreen-ui";
                break;
            }
        }
    } else {
        winOpts.backgroundColor = "#222222";
    }
    const bwin = new electron.BaseWindow(winOpts);
    const win: WaveBrowserWindow = bwin as WaveBrowserWindow;
    win.waveWindowId = waveWindow.oid;
    win.alreadyClosed = false;
    win.allTabViews = new Map<string, WaveTabView>();
    const winBoundsPoller = setInterval(() => {
        if (win.isDestroyed()) {
            clearInterval(winBoundsPoller);
            return;
        }
        if (tabSwitchQueue.length > 0) {
            return;
        }
        finalizePositioning(win);
    }, 1000);
    win.on(
        // @ts-expect-error
        "resize",
        debounce(400, (e) => mainResizeHandler(e, waveWindow.oid, win))
    );
    win.on("resize", () => {
        if (win.isDestroyed()) {
            return;
        }
        positionTabOnScreen(win.activeTabView, win.getContentBounds());
    });
    win.on(
        // @ts-expect-error
        "move",
        debounce(400, (e) => mainResizeHandler(e, waveWindow.oid, win))
    );
    win.on("enter-full-screen", async () => {
        console.log("enter-full-screen event", win.getContentBounds());
        const tabView = win.activeTabView;
        if (tabView) {
            tabView.webContents.send("fullscreen-change", true);
        }
        positionTabOnScreen(win.activeTabView, win.getContentBounds());
    });
    win.on("leave-full-screen", async () => {
        const tabView = win.activeTabView;
        if (tabView) {
            tabView.webContents.send("fullscreen-change", false);
        }
        positionTabOnScreen(win.activeTabView, win.getContentBounds());
    });
    win.on("focus", () => {
        if (getGlobalIsRelaunching()) {
            return;
        }
        focusedWaveWindow = win;
        console.log("focus win", win.waveWindowId);
        ClientService.FocusWindow(win.waveWindowId);
    });
    win.on("blur", () => {
        if (focusedWaveWindow == win) {
            focusedWaveWindow = null;
        }
    });
    win.on("close", (e) => {
        console.log("win 'close' handler fired", win.waveWindowId);
        if (getGlobalIsQuitting() || updater?.status == "installing" || getGlobalIsRelaunching()) {
            return;
        }
        const numWindows = waveWindowMap.size;
        if (numWindows == 1) {
            return;
        }
        const choice = electron.dialog.showMessageBoxSync(win, {
            type: "question",
            buttons: ["Cancel", "Yes"],
            title: "Confirm",
            message: "Are you sure you want to close this window (all tabs and blocks will be deleted)?",
        });
        if (choice === 0) {
            e.preventDefault();
        } else {
            win.deleteAllowed = true;
        }
    });
    win.on("closed", () => {
        console.log("win 'closed' handler fired", win.waveWindowId);
        if (getGlobalIsQuitting() || updater?.status == "installing") {
            return;
        }
        if (getGlobalIsRelaunching()) {
            destroyWindow(win);
            return;
        }
        const numWindows = waveWindowMap.size;
        if (numWindows == 0) {
            return;
        }
        if (!win.alreadyClosed && win.deleteAllowed) {
            console.log("win removing window from backend DB", win.waveWindowId);
            WindowService.CloseWindow(waveWindow.oid, true);
        }
        destroyWindow(win);
    });
    waveWindowMap.set(waveWindow.oid, win);
    return win;
}

export function getLastFocusedWaveWindow(): WaveBrowserWindow {
    return focusedWaveWindow;
}

// note, this does not *show* the window.
// to show, await win.readyPromise and then win.show()
export function createBrowserWindow(
    clientId: string,
    waveWindow: WaveWindow,
    fullConfig: FullConfigType,
    opts: WindowOpts
): WaveBrowserWindow {
    const bwin = createBaseWaveBrowserWindow(waveWindow, fullConfig, opts);
    // TODO fix null activetabid if it exists
    if (waveWindow.activetabid != null) {
        setActiveTab(bwin, waveWindow.activetabid);
    }
    return bwin;
}

export async function setActiveTab(waveWindow: WaveBrowserWindow, tabId: string) {
    const windowId = waveWindow.waveWindowId;
    await ObjectService.SetActiveTab(waveWindow.waveWindowId, tabId);
    const fullConfig = await FileService.GetFullConfig();
    const [tabView, tabInitialized] = getOrCreateWebViewForTab(fullConfig, windowId, tabId);
    queueTabSwitch(waveWindow, tabView, tabInitialized);
}

export function queueTabSwitch(bwin: WaveBrowserWindow, tabView: WaveTabView, tabInitialized: boolean) {
    if (tabSwitchQueue.length == 2) {
        tabSwitchQueue[1] = { bwin, tabView, tabInitialized };
        return;
    }
    tabSwitchQueue.push({ bwin, tabView, tabInitialized });
    if (tabSwitchQueue.length == 1) {
        processTabSwitchQueue();
    }
}

async function processTabSwitchQueue() {
    if (tabSwitchQueue.length == 0) {
        tabSwitchQueue = [];
        return;
    }
    try {
        const { bwin, tabView, tabInitialized } = tabSwitchQueue[0];
        await setTabViewIntoWindow(bwin, tabView, tabInitialized);
    } finally {
        tabSwitchQueue.shift();
        processTabSwitchQueue();
    }
}

async function setTabViewIntoWindow(bwin: WaveBrowserWindow, tabView: WaveTabView, tabInitialized: boolean) {
    const clientData = await ClientService.GetClientData();
    if (bwin.activeTabView == tabView) {
        return;
    }
    const oldActiveView = bwin.activeTabView;
    tabView.isActiveTab = true;
    if (oldActiveView != null) {
        oldActiveView.isActiveTab = false;
    }
    bwin.activeTabView = tabView;
    bwin.allTabViews.set(tabView.waveTabId, tabView);
    if (!tabInitialized) {
        console.log("initializing a new tab");
        await tabView.initPromise;
        bwin.contentView.addChildView(tabView);
        const initOpts = {
            tabId: tabView.waveTabId,
            clientId: clientData.oid,
            windowId: bwin.waveWindowId,
            activate: true,
        };
        tabView.savedInitOpts = { ...initOpts };
        tabView.savedInitOpts.activate = false;
        let startTime = Date.now();
        tabView.webContents.send("wave-init", initOpts);
        console.log("before wave ready");
        await tabView.waveReadyPromise;
        // positionTabOnScreen(tabView, bwin.getContentBounds());
        console.log("wave-ready init time", Date.now() - startTime + "ms");
        // positionTabOffScreen(oldActiveView, bwin.getContentBounds());
        await repositionTabsSlowly(bwin, 100);
    } else {
        console.log("reusing an existing tab");
        const p1 = repositionTabsSlowly(bwin, 35);
        const p2 = tabView.webContents.send("wave-init", tabView.savedInitOpts); // reinit
        await Promise.all([p1, p2]);
    }

    // something is causing the new tab to lose focus so it requires manual refocusing
    tabView.webContents.focus();
    setTimeout(() => {
        if (bwin.activeTabView == tabView && !tabView.webContents.isFocused()) {
            tabView.webContents.focus();
        }
    }, 10);
    setTimeout(() => {
        if (bwin.activeTabView == tabView && !tabView.webContents.isFocused()) {
            tabView.webContents.focus();
        }
    }, 30);
}
