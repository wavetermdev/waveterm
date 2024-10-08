// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ClientService, ObjectService, WindowService } from "@/app/store/services";
import * as electron from "electron";
import {
    ensureBoundsAreVisible,
    handleCtrlShiftFocus,
    handleCtrlShiftState,
    shFrameNavHandler,
    shNavHandler,
} from "emain/emain-util";
import * as keyutil from "frontend/util/keyutil";
import * as path from "path";
import { debounce } from "throttle-debounce";
import { configureAuthKeyRequestInjection } from "./authkey";
import { getGlobalIsQuitting, getGlobalIsStarting, setWasActive, setWasInFg } from "./emain-activity";
import { getElectronAppBasePath, isDevVite } from "./platform";
import { updater } from "./updater";

const MaxCacheSize = 10;
let HotSpareTab: WaveTabView = null;

const waveWindowMap = new Map<string, WaveBrowserWindow>(); // waveWindowId -> WaveBrowserWindow
let focusedWaveWindow = null; // on blur we do not set this to null (but on destroy we do)
const wcvCache = new Map<string, WaveTabView>();
const wcIdToWaveTabMap = new Map<number, WaveTabView>();

function createBareTabView(): WaveTabView {
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
    return tabView;
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

export function ensureHotSpareTab() {
    console.log("ensureHotSpareTab");
    if (HotSpareTab == null) {
        HotSpareTab = createBareTabView();
    }
}

function getSpareTab(): WaveTabView {
    setTimeout(ensureHotSpareTab, 500);
    if (HotSpareTab != null) {
        const rtn = HotSpareTab;
        HotSpareTab = null;
        console.log("getSpareTab: returning hotspare");
        return rtn;
    } else {
        console.log("getSpareTab: creating new tab");
        return createBareTabView();
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
        tabView.webContents.close();
        wcvCache.delete(sorted[i].waveTabId);
    }
}

// returns [tabview, initialized]
function getOrCreateWebViewForTab(windowId: string, tabId: string): [WaveTabView, boolean] {
    let tabView = getWaveTabView(windowId, tabId);
    if (tabView) {
        return [tabView, true];
    }
    tabView = getSpareTab();
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
        // console.log("WIN bie", waveEvent.type, waveEvent.code);
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
        console.log("error resizing window", e);
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
        autoHideMenuBar: true,
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
    win.allTabViews = new Map<string, WaveTabView>();
    win.hotSpareTab = null;
    win.on(
        "resize",
        debounce(400, (e) => mainResizeHandler(e, waveWindow.oid, win))
    );
    win.on(
        "move",
        debounce(400, (e) => mainResizeHandler(e, waveWindow.oid, win))
    );
    win.on("focus", () => {
        setWasInFg(true);
        setWasActive(true);
        focusedWaveWindow = win;
        if (getGlobalIsStarting()) {
            return;
        }
        console.log("focus", waveWindow.oid);
        ClientService.FocusWindow(waveWindow.oid);
    });
    win.on("blur", () => {
        const tabView: WaveTabView = win.getContentView() as any;
        if (tabView) {
            handleCtrlShiftFocus(tabView.webContents, false);
        }
        if (focusedWaveWindow == win) {
            focusedWaveWindow = null;
        }
    });
    win.on("enter-full-screen", async () => {
        const tabView: WaveTabView = win.getContentView() as any;
        if (tabView) {
            tabView.webContents.send("fullscreen-change", true);
        }
    });
    win.on("leave-full-screen", async () => {
        const tabView: WaveTabView = win.getContentView() as any;
        if (tabView) {
            tabView.webContents.send("fullscreen-change", false);
        }
    });
    win.on("close", (e) => {
        if (getGlobalIsQuitting() || updater?.status == "installing") {
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
        }
    });
    win.on("closed", () => {
        if (getGlobalIsQuitting() || updater?.status == "installing") {
            return;
        }
        const numWindows = waveWindowMap.size;
        if (numWindows == 0) {
            return;
        }
        WindowService.CloseWindow(waveWindow.oid);
        for (const tabView of win.allTabViews.values()) {
            removeWaveTabView(tabView.waveWindowId, tabView.waveTabId);
            tabView.webContents.close();
        }
        waveWindowMap.delete(waveWindow.oid);
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
    ObjectService.SetActiveTab(waveWindow.waveWindowId, tabId);
    const [tabView, tabInitialized] = getOrCreateWebViewForTab(windowId, tabId);
    setTabViewIntoWindow(waveWindow, tabView, tabInitialized);
}

async function setTabViewIntoWindow(bwin: WaveBrowserWindow, tabView: WaveTabView, tabInitialized: boolean) {
    const curTabView: WaveTabView = bwin.getContentView() as any;
    const clientData = await ClientService.GetClientData();
    if (curTabView != null) {
        curTabView.isActiveTab = false;
    }
    tabView.isActiveTab = true;
    bwin.activeTabView = tabView;
    bwin.allTabViews.set(tabView.waveTabId, tabView);
    if (!tabInitialized) {
        await tabView.initPromise;
        bwin.setContentView(tabView);
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
        await tabView.waveReadyPromise;
        console.log("wave-ready init time", Date.now() - startTime + "ms");
    } else {
        bwin.setContentView(tabView);
    }
    tabView.webContents.focus();
}
