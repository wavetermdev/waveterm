// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ClientService, FileService, ObjectService, WindowService, WorkspaceService } from "@/app/store/services";
import { fireAndForget } from "@/util/util";
import { BaseWindow, BaseWindowConstructorOptions, dialog, ipcMain, screen } from "electron";
import path from "path";
import { debounce } from "throttle-debounce";
import {
    getGlobalIsQuitting,
    getGlobalIsRelaunching,
    setGlobalIsRelaunching,
    setWasActive,
    setWasInFg,
} from "./emain-activity";
import { getOrCreateWebViewForTab, getWaveTabViewByWebContentsId, WaveTabView } from "./emain-tabview";
import { delay, ensureBoundsAreVisible } from "./emain-util";
import { log } from "./log";
import { getElectronAppBasePath, unamePlatform } from "./platform";
import { updater } from "./updater";
export type WindowOpts = {
    unamePlatform: string;
};

export const waveWindowMap = new Map<string, WaveBrowserWindow>(); // waveWindowId -> WaveBrowserWindow
export let focusedWaveWindow = null; // on blur we do not set this to null (but on destroy we do)

let cachedClientId: string = null;

async function getClientId() {
    if (cachedClientId != null) {
        return cachedClientId;
    }
    const clientData = await ClientService.GetClientData();
    cachedClientId = clientData?.oid;
    return cachedClientId;
}

type TabSwitchQueueEntry =
    | {
          createTab: false;
          tabId: string;
          setInBackend: boolean;
      }
    | {
          createTab: true;
          pinned: boolean;
      };

export class WaveBrowserWindow extends BaseWindow {
    waveWindowId: string;
    workspaceId: string;
    waveReadyPromise: Promise<void>;
    allLoadedTabViews: Map<string, WaveTabView>;
    activeTabView: WaveTabView;
    private canClose: boolean;
    private deleteAllowed: boolean;
    private tabSwitchQueue: TabSwitchQueueEntry[];

    constructor(waveWindow: WaveWindow, fullConfig: FullConfigType, opts: WindowOpts) {
        console.log("create win", waveWindow.oid);
        let winWidth = waveWindow?.winsize?.width;
        let winHeight = waveWindow?.winsize?.height;
        let winPosX = waveWindow.pos.x;
        let winPosY = waveWindow.pos.y;
        if (winWidth == null || winWidth == 0) {
            const primaryDisplay = screen.getPrimaryDisplay();
            const { width } = primaryDisplay.workAreaSize;
            winWidth = width - winPosX - 100;
            if (winWidth > 2000) {
                winWidth = 2000;
            }
        }
        if (winHeight == null || winHeight == 0) {
            const primaryDisplay = screen.getPrimaryDisplay();
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
        const winOpts: BaseWindowConstructorOptions = {
            titleBarStyle:
                opts.unamePlatform === "darwin"
                    ? "hiddenInset"
                    : settings["window:nativetitlebar"]
                      ? "default"
                      : "hidden",
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

        super(winOpts);
        this.tabSwitchQueue = [];
        this.waveWindowId = waveWindow.oid;
        this.workspaceId = waveWindow.workspaceid;
        this.allLoadedTabViews = new Map<string, WaveTabView>();
        const winBoundsPoller = setInterval(() => {
            if (this.isDestroyed()) {
                clearInterval(winBoundsPoller);
                return;
            }
            if (this.tabSwitchQueue.length > 0) {
                return;
            }
            this.finalizePositioning();
        }, 1000);
        this.on(
            // @ts-expect-error
            "resize",
            debounce(400, (e) => this.mainResizeHandler(e))
        );
        this.on("resize", () => {
            if (this.isDestroyed()) {
                return;
            }
            this.activeTabView?.positionTabOnScreen(this.getContentBounds());
        });
        this.on(
            // @ts-expect-error
            "move",
            debounce(400, (e) => this.mainResizeHandler(e))
        );
        this.on("enter-full-screen", async () => {
            if (this.isDestroyed()) {
                return;
            }
            console.log("enter-full-screen event", this.getContentBounds());
            const tabView = this.activeTabView;
            if (tabView) {
                tabView.webContents.send("fullscreen-change", true);
            }
            this.activeTabView?.positionTabOnScreen(this.getContentBounds());
        });
        this.on("leave-full-screen", async () => {
            if (this.isDestroyed()) {
                return;
            }
            const tabView = this.activeTabView;
            if (tabView) {
                tabView.webContents.send("fullscreen-change", false);
            }
            this.activeTabView?.positionTabOnScreen(this.getContentBounds());
        });
        this.on("focus", () => {
            if (this.isDestroyed()) {
                return;
            }
            if (getGlobalIsRelaunching()) {
                return;
            }
            focusedWaveWindow = this;
            console.log("focus win", this.waveWindowId);
            fireAndForget(() => ClientService.FocusWindow(this.waveWindowId));
            setWasInFg(true);
            setWasActive(true);
        });
        this.on("blur", () => {
            if (this.isDestroyed()) {
                return;
            }
            if (focusedWaveWindow == this) {
                focusedWaveWindow = null;
            }
        });
        this.on("close", (e) => {
            if (this.canClose) {
                return;
            }
            if (this.isDestroyed()) {
                return;
            }
            console.log("win 'close' handler fired", this.waveWindowId);
            if (getGlobalIsQuitting() || updater?.status == "installing" || getGlobalIsRelaunching()) {
                return;
            }
            e.preventDefault();
            fireAndForget(async () => {
                const numWindows = waveWindowMap.size;
                if (numWindows > 1) {
                    console.log("numWindows > 1", numWindows);
                    const workspace = await WorkspaceService.GetWorkspace(this.workspaceId);
                    console.log("workspace", workspace);
                    if (!workspace.name && !workspace.icon && workspace.tabids.length > 1) {
                        console.log("workspace has no name, icon, and multiple tabs", workspace);
                        const choice = dialog.showMessageBoxSync(this, {
                            type: "question",
                            buttons: ["Cancel", "Yes"],
                            title: "Confirm",
                            message:
                                "Are you sure you want to close this window (all tabs and blocks will be deleted)?",
                        });
                        if (choice === 0) {
                            console.log("user cancelled close window", this.waveWindowId);
                            return;
                        }
                    }
                    console.log("deleteAllowed = true", this.waveWindowId);
                    this.deleteAllowed = true;
                }
                console.log("canClose = true", this.waveWindowId);
                this.canClose = true;
                this.close();
            });
        });
        this.on("closed", () => {
            console.log("win 'closed' handler fired", this.waveWindowId);
            if (getGlobalIsQuitting() || updater?.status == "installing") {
                console.log("win quitting or updating", this.waveWindowId);
                return;
            }
            if (getGlobalIsRelaunching()) {
                console.log("win relaunching", this.waveWindowId);
                this.destroy();
                return;
            }
            const numWindows = waveWindowMap.size;
            if (numWindows == 0) {
                console.log("win no windows left", this.waveWindowId);
                return;
            }
            if (this.deleteAllowed) {
                console.log("win removing window from backend DB", this.waveWindowId);
                fireAndForget(() => WindowService.CloseWindow(this.waveWindowId, true));
            }
            for (const tabView of this.allLoadedTabViews.values()) {
                tabView?.destroy();
            }
            waveWindowMap.delete(this.waveWindowId);
            if (focusedWaveWindow == this) {
                focusedWaveWindow = null;
            }
        });
        waveWindowMap.set(waveWindow.oid, this);
    }

    async switchWorkspace(workspaceId: string) {
        console.log("switchWorkspace", workspaceId, this.waveWindowId);
        if (workspaceId == this.workspaceId) {
            console.log("switchWorkspace already on this workspace", this.waveWindowId);
            return;
        }
        const curWorkspace = await WorkspaceService.GetWorkspace(this.workspaceId);
        if (curWorkspace.tabids.length > 1 && (!curWorkspace.name || !curWorkspace.icon)) {
            const choice = dialog.showMessageBoxSync(this, {
                type: "question",
                buttons: ["Cancel", "Open in New Window", "Yes"],
                title: "Confirm",
                message:
                    "This window has unsaved tabs, switching workspaces will delete the existing tabs. Would you like to continue?",
            });
            if (choice === 0) {
                console.log("user cancelled switch workspace", this.waveWindowId);
                return;
            } else if (choice === 1) {
                console.log("user chose open in new window", this.waveWindowId);
                const newWin = await WindowService.CreateWindow(null, workspaceId);
                if (!newWin) {
                    console.log("error creating new window", this.waveWindowId);
                }
                const newBwin = await createBrowserWindow(newWin, await FileService.GetFullConfig(), { unamePlatform });
                newBwin.show();
                return;
            }
        }
        const newWs = await WindowService.SwitchWorkspace(this.waveWindowId, workspaceId);
        if (!newWs) {
            return;
        }
        console.log("switchWorkspace newWs", newWs);
        if (this.allLoadedTabViews.size) {
            for (const tab of this.allLoadedTabViews.values()) {
                this.contentView.removeChildView(tab);
                tab?.destroy();
            }
        }
        console.log("destroyed all tabs", this.waveWindowId);
        this.workspaceId = workspaceId;
        this.allLoadedTabViews = new Map();
        await this.setActiveTab(newWs.activetabid, false);
    }

    async setActiveTab(tabId: string, setInBackend: boolean) {
        console.log("setActiveTab", tabId, this.waveWindowId, this.workspaceId, setInBackend);
        await this.queueTabSwitch(tabId, setInBackend);
    }

    async closeTab(tabId: string) {
        console.log(`closeTab tabid=${tabId} ws=${this.workspaceId} window=${this.waveWindowId}`);
        const rtn = await WorkspaceService.CloseTab(this.workspaceId, tabId, true);
        if (rtn == null) {
            console.log("[error] closeTab: no return value", tabId, this.workspaceId, this.waveWindowId);
            return;
        }
        if (rtn.closewindow) {
            this.close();
            return;
        }
        if (!rtn.newactivetabid) {
            console.log("[error] closeTab, no new active tab", tabId, this.workspaceId, this.waveWindowId);
            return;
        }
        await this.setActiveTab(rtn.newactivetabid, false);
        this.allLoadedTabViews.delete(tabId);
    }

    async initializeTab(tabView: WaveTabView) {
        const clientId = await getClientId();
        await tabView.initPromise;
        this.contentView.addChildView(tabView);
        const initOpts = {
            tabId: tabView.waveTabId,
            clientId: clientId,
            windowId: this.waveWindowId,
            activate: true,
        };
        tabView.savedInitOpts = { ...initOpts };
        tabView.savedInitOpts.activate = false;
        let startTime = Date.now();
        console.log("before wave ready, init tab, sending wave-init", tabView.waveTabId);
        tabView.webContents.send("wave-init", initOpts);
        await tabView.waveReadyPromise;
        console.log("wave-ready init time", Date.now() - startTime + "ms");
    }

    async setTabViewIntoWindow(tabView: WaveTabView, tabInitialized: boolean) {
        if (this.activeTabView == tabView) {
            return;
        }
        const oldActiveView = this.activeTabView;
        tabView.isActiveTab = true;
        if (oldActiveView != null) {
            oldActiveView.isActiveTab = false;
        }
        this.activeTabView = tabView;
        this.allLoadedTabViews.set(tabView.waveTabId, tabView);
        if (!tabInitialized) {
            console.log("initializing a new tab");
            const p1 = this.initializeTab(tabView);
            const p2 = this.repositionTabsSlowly(100);
            await Promise.all([p1, p2]);
        } else {
            console.log("reusing an existing tab, calling wave-init", tabView.waveTabId);
            const p1 = this.repositionTabsSlowly(35);
            const p2 = tabView.webContents.send("wave-init", tabView.savedInitOpts); // reinit
            await Promise.all([p1, p2]);
        }

        // something is causing the new tab to lose focus so it requires manual refocusing
        tabView.webContents.focus();
        setTimeout(() => {
            if (this.activeTabView == tabView && !tabView.webContents.isFocused()) {
                tabView.webContents.focus();
            }
        }, 10);
        setTimeout(() => {
            if (this.activeTabView == tabView && !tabView.webContents.isFocused()) {
                tabView.webContents.focus();
            }
        }, 30);
    }

    async repositionTabsSlowly(delayMs: number) {
        const activeTabView = this.activeTabView;
        const winBounds = this.getContentBounds();
        if (activeTabView == null) {
            return;
        }
        if (activeTabView.isOnScreen()) {
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
        if (this.activeTabView != activeTabView) {
            // another tab view has been set, do not finalize this layout
            return;
        }
        this.finalizePositioning();
    }

    finalizePositioning() {
        if (this.isDestroyed()) {
            return;
        }
        const curBounds = this.getContentBounds();
        this.activeTabView?.positionTabOnScreen(curBounds);
        for (const tabView of this.allLoadedTabViews.values()) {
            if (tabView == this.activeTabView) {
                continue;
            }
            tabView?.positionTabOffScreen(curBounds);
        }
    }

    async queueTabSwitch(tabId: string, setInBackend: boolean) {
        await this._queueTabSwitchInternal({ createTab: false, tabId, setInBackend });
    }

    async queueCreateTab(pinned = false) {
        await this._queueTabSwitchInternal({ createTab: true, pinned });
    }

    async _queueTabSwitchInternal(entry: TabSwitchQueueEntry) {
        if (this.tabSwitchQueue.length >= 2) {
            this.tabSwitchQueue[1] = entry;
            return;
        }
        const wasEmpty = this.tabSwitchQueue.length === 0;
        this.tabSwitchQueue.push(entry);
        if (wasEmpty) {
            await this.processTabSwitchQueue();
        }
    }

    // the queue and this function are used to serialize tab switches
    // [0] => the tab that is currently being switched to
    // [1] => the tab that will be switched to next
    // queueTabSwitch will replace [1] if it is already set
    // we don't mess with [0] because it is "in process"
    // we replace [1] because there is no point to switching to a tab that will be switched out of immediately
    async processTabSwitchQueue() {
        while (this.tabSwitchQueue.length > 0) {
            try {
                const entry = this.tabSwitchQueue[0];
                let tabId: string = null;
                // have to use "===" here to get the typechecker to work :/
                if (entry.createTab === true) {
                    const { pinned } = entry;
                    tabId = await WorkspaceService.CreateTab(this.workspaceId, null, true, pinned);
                } else if (entry.createTab === false) {
                    let setInBackend: boolean = false;
                    ({ tabId, setInBackend } = entry);
                    if (this.activeTabView?.waveTabId == tabId) {
                        continue;
                    }
                    if (setInBackend) {
                        await WorkspaceService.SetActiveTab(this.workspaceId, tabId);
                    }
                }
                if (tabId == null) {
                    return;
                }
                const [tabView, tabInitialized] = await getOrCreateWebViewForTab(tabId);
                await this.setTabViewIntoWindow(tabView, tabInitialized);
            } catch (e) {
                console.log("error caught in processTabSwitchQueue", e);
            } finally {
                this.tabSwitchQueue.shift();
            }
        }
    }

    async mainResizeHandler(_: any) {
        if (this == null || this.isDestroyed() || this.fullScreen) {
            return;
        }
        const bounds = this.getBounds();
        try {
            await WindowService.SetWindowPosAndSize(
                this.waveWindowId,
                { x: bounds.x, y: bounds.y },
                { width: bounds.width, height: bounds.height }
            );
        } catch (e) {
            console.log("error sending new window bounds to backend", e);
        }
    }

    destroy() {
        console.log("destroy win", this.waveWindowId);
        this.deleteAllowed = true;
        super.destroy();
    }
}

export function getWaveWindowByTabId(tabId: string): WaveBrowserWindow {
    for (const ww of waveWindowMap.values()) {
        if (ww.allLoadedTabViews.has(tabId)) {
            return ww;
        }
    }
}

export function getWaveWindowByWebContentsId(webContentsId: number): WaveBrowserWindow {
    const tabView = getWaveTabViewByWebContentsId(webContentsId);
    if (tabView == null) {
        return null;
    }
    return getWaveWindowByTabId(tabView.waveTabId);
}

export function getWaveWindowById(windowId: string): WaveBrowserWindow {
    return waveWindowMap.get(windowId);
}

export function getWaveWindowByWorkspaceId(workspaceId: string): WaveBrowserWindow {
    for (const waveWindow of waveWindowMap.values()) {
        if (waveWindow.workspaceId === workspaceId) {
            return waveWindow;
        }
    }
}

export function getAllWaveWindows(): WaveBrowserWindow[] {
    return Array.from(waveWindowMap.values());
}

// note, this does not *show* the window.
// to show, await win.readyPromise and then win.show()
export async function createBrowserWindow(
    waveWindow: WaveWindow,
    fullConfig: FullConfigType,
    opts: WindowOpts
): Promise<WaveBrowserWindow> {
    if (!waveWindow) {
        console.log("createBrowserWindow: no waveWindow");
        waveWindow = await WindowService.CreateWindow(null, "");
    }
    let workspace = await WorkspaceService.GetWorkspace(waveWindow.workspaceid);
    if (!workspace) {
        console.log("createBrowserWindow: no workspace, creating new window");
        await WindowService.CloseWindow(waveWindow.oid, true);
        waveWindow = await WindowService.CreateWindow(null, "");
        workspace = await WorkspaceService.GetWorkspace(waveWindow.workspaceid);
    }
    console.log("createBrowserWindow", waveWindow.oid, workspace.oid, workspace);
    const bwin = new WaveBrowserWindow(waveWindow, fullConfig, opts);
    if (workspace.activetabid) {
        await bwin.setActiveTab(workspace.activetabid, false);
    }
    return bwin;
}

ipcMain.on("set-active-tab", async (event, tabId) => {
    const ww = getWaveWindowByWebContentsId(event.sender.id);
    console.log("set-active-tab", tabId, ww?.waveWindowId);
    await ww?.setActiveTab(tabId, true);
});

ipcMain.on("create-tab", async (event, opts) => {
    const senderWc = event.sender;
    const ww = getWaveWindowByWebContentsId(senderWc.id);
    if (ww != null) {
        await ww.queueCreateTab();
    }
    event.returnValue = true;
    return null;
});

ipcMain.on("close-tab", async (event, workspaceId, tabId) => {
    const ww = getWaveWindowByWorkspaceId(workspaceId);
    if (ww == null) {
        console.log(`close-tab: no window found for workspace ws=${workspaceId} tab=${tabId}`);
        return;
    }
    if (ww != null) {
        await ww.closeTab(tabId);
    }
    event.returnValue = true;
    return null;
});

ipcMain.on("switch-workspace", (event, workspaceId) => {
    fireAndForget(async () => {
        const ww = getWaveWindowByWebContentsId(event.sender.id);
        console.log("switch-workspace", workspaceId, ww?.waveWindowId);
        await ww?.switchWorkspace(workspaceId);
    });
});

export async function createWorkspace(window: WaveBrowserWindow) {
    if (!window) {
        return;
    }
    const newWsId = await WorkspaceService.CreateWorkspace();
    if (newWsId) {
        await window.switchWorkspace(newWsId);
    }
}

ipcMain.on("create-workspace", (event) => {
    fireAndForget(async () => {
        const ww = getWaveWindowByWebContentsId(event.sender.id);
        console.log("create-workspace", ww?.waveWindowId);
        await createWorkspace(ww);
    });
});

ipcMain.on("delete-workspace", (event, workspaceId) => {
    fireAndForget(async () => {
        const ww = getWaveWindowByWebContentsId(event.sender.id);
        console.log("delete-workspace", workspaceId, ww?.waveWindowId);
        await WorkspaceService.DeleteWorkspace(workspaceId);
        console.log("delete-workspace done", workspaceId, ww?.waveWindowId);
        if (ww?.workspaceId == workspaceId) {
            console.log("delete-workspace closing window", workspaceId, ww?.waveWindowId);
            ww.destroy();
        }
    });
});

export async function createNewWaveWindow() {
    log("createNewWaveWindow");
    const clientData = await ClientService.GetClientData();
    const fullConfig = await FileService.GetFullConfig();
    let recreatedWindow = false;
    const allWindows = getAllWaveWindows();
    if (allWindows.length === 0 && clientData?.windowids?.length >= 1) {
        console.log("no windows, but clientData has windowids, recreating first window");
        // reopen the first window
        const existingWindowId = clientData.windowids[0];
        const existingWindowData = (await ObjectService.GetObject("window:" + existingWindowId)) as WaveWindow;
        if (existingWindowData != null) {
            const win = await createBrowserWindow(existingWindowData, fullConfig, { unamePlatform });
            await win.waveReadyPromise;
            win.show();
            recreatedWindow = true;
        }
    }
    if (recreatedWindow) {
        console.log("recreated window, returning");
        return;
    }
    console.log("creating new window");
    const newBrowserWindow = await createBrowserWindow(null, fullConfig, { unamePlatform });
    await newBrowserWindow.waveReadyPromise;
    newBrowserWindow.show();
}

export async function relaunchBrowserWindows() {
    console.log("relaunchBrowserWindows");
    setGlobalIsRelaunching(true);
    const windows = getAllWaveWindows();
    for (const window of windows) {
        console.log("relaunch -- closing window", window.waveWindowId);
        window.close();
    }
    setGlobalIsRelaunching(false);

    const clientData = await ClientService.GetClientData();
    const fullConfig = await FileService.GetFullConfig();
    const wins: WaveBrowserWindow[] = [];
    for (const windowId of clientData.windowids.slice().reverse()) {
        const windowData: WaveWindow = await WindowService.GetWindow(windowId);
        if (windowData == null) {
            console.log("relaunch -- window data not found, closing window", windowId);
            await WindowService.CloseWindow(windowId, true);
            continue;
        }
        console.log("relaunch -- creating window", windowId, windowData);
        const win = await createBrowserWindow(windowData, fullConfig, { unamePlatform });
        wins.push(win);
    }
    for (const win of wins) {
        await win.waveReadyPromise;
        console.log("show window", win.waveWindowId);
        win.show();
    }
}
