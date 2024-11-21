// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ClientService, FileService, WindowService, WorkspaceService } from "@/app/store/services";
import { BaseWindow, BaseWindowConstructorOptions, dialog, ipcMain, screen } from "electron";
import path from "path";
import { debounce } from "throttle-debounce";
import { getGlobalIsQuitting, getGlobalIsRelaunching, setWasActive, setWasInFg } from "./emain-activity";
import { getOrCreateWebViewForTab, getWaveTabViewByWebContentsId, WaveTabView } from "./emain-tabview";
import { delay, ensureBoundsAreVisible } from "./emain-util";
import { getElectronAppBasePath } from "./platform";
import { updater } from "./updater";

export type WindowOpts = {
    unamePlatform: string;
};

export const waveWindowMap = new Map<string, WaveBrowserWindow>(); // waveWindowId -> WaveBrowserWindow
export let focusedWaveWindow = null; // on blur we do not set this to null (but on destroy we do)

export class WaveBrowserWindow extends BaseWindow {
    baseWindow: BaseWindow;
    waveWindowId: string;
    workspaceId: string;
    waveReadyPromise: Promise<void>;
    allTabViews: Map<string, WaveTabView>;
    activeTabView: WaveTabView;
    alreadyClosed: boolean;
    deleteAllowed: boolean;
    private tabSwitchQueue: { tabView: WaveTabView; tabInitialized: boolean }[];

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
        this.alreadyClosed = false;
        this.allTabViews = new Map<string, WaveTabView>();
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
            console.log("enter-full-screen event", this.getContentBounds());
            const tabView = this.activeTabView;
            if (tabView) {
                tabView.webContents.send("fullscreen-change", true);
            }
            this.activeTabView?.positionTabOnScreen(this.getContentBounds());
        });
        this.on("leave-full-screen", async () => {
            const tabView = this.activeTabView;
            if (tabView) {
                tabView.webContents.send("fullscreen-change", false);
            }
            this.activeTabView?.positionTabOnScreen(this.getContentBounds());
        });
        this.on("focus", () => {
            if (getGlobalIsRelaunching()) {
                return;
            }
            focusedWaveWindow = this;
            console.log("focus win", this.waveWindowId);
            ClientService.FocusWindow(this.waveWindowId);
            setWasInFg(true);
            setWasActive(true);
        });
        this.on("blur", () => {
            if (focusedWaveWindow == this) {
                focusedWaveWindow = null;
            }
        });
        this.on("close", (e) => {
            console.log("win 'close' handler fired", this.waveWindowId);
            if (getGlobalIsQuitting() || updater?.status == "installing" || getGlobalIsRelaunching()) {
                return;
            }
            const numWindows = waveWindowMap.size;
            if (numWindows == 1) {
                return;
            }
            const choice = dialog.showMessageBoxSync(this, {
                type: "question",
                buttons: ["Cancel", "Yes"],
                title: "Confirm",
                message: "Are you sure you want to close this window (all tabs and blocks will be deleted)?",
            });
            if (choice === 0) {
                e.preventDefault();
            } else {
                this.deleteAllowed = true;
            }
        });
        this.on("closed", () => {
            console.log("win 'closed' handler fired", this.waveWindowId);
            if (getGlobalIsQuitting() || updater?.status == "installing") {
                return;
            }
            if (getGlobalIsRelaunching()) {
                this.destroy();
                return;
            }
            const numWindows = waveWindowMap.size;
            if (numWindows == 0) {
                return;
            }
            if (!this.alreadyClosed && this.deleteAllowed) {
                console.log("win removing window from backend DB", this.waveWindowId);
                WindowService.CloseWindow(this.waveWindowId, true);
            }
            this.destroy();
        });
        waveWindowMap.set(waveWindow.oid, this);
    }

    async switchWorkspace(workspaceId: string) {
        const newWs = await WindowService.SwitchWorkspace(this.waveWindowId, workspaceId);
        if (this.allTabViews.size) {
            for (const tab of this.allTabViews.values()) {
                tab?.destroy();
            }
        }
        this.workspaceId = workspaceId;
        this.allTabViews = new Map();
        const fullConfig = await FileService.GetFullConfig();
        const [tabView, tabInitialized] = getOrCreateWebViewForTab(fullConfig, newWs.activetabid);
        this.queueTabSwitch(tabView, tabInitialized);
    }

    async setActiveTab(tabId: string) {
        console.log("setActiveTab", this);
        const workspace = await ClientService.GetWorkspace(this.workspaceId);
        await WorkspaceService.SetActiveTab(workspace.oid, tabId);
        const fullConfig = await FileService.GetFullConfig();
        const [tabView, tabInitialized] = getOrCreateWebViewForTab(fullConfig, tabId);
        this.queueTabSwitch(tabView, tabInitialized);
    }

    async createTab() {
        const tabId = await WorkspaceService.CreateTab(this.workspaceId, null, true);
        this.setActiveTab(tabId);
    }

    async closeTab(tabId: string) {
        const tabView = this.allTabViews.get(tabId);
        if (tabView) {
            const rtn = await WorkspaceService.CloseTab(this.workspaceId, tabId, true);
            this.allTabViews.delete(tabId);
            if (rtn?.closewindow && !this.alreadyClosed) {
                this.destroy(); // bypass the "are you sure?" dialog
            } else if (rtn?.newactivetabid) {
                this.setActiveTab(rtn.newactivetabid);
            }
        }
    }

    async setTabViewIntoWindow(tabView: WaveTabView, tabInitialized: boolean) {
        console.log("setTabViewIntoWindow", this, tabView, tabInitialized);
        const clientData = await ClientService.GetClientData();
        if (this.activeTabView == tabView) {
            return;
        }
        const oldActiveView = this.activeTabView;
        tabView.isActiveTab = true;
        if (oldActiveView != null) {
            oldActiveView.isActiveTab = false;
        }
        this.activeTabView = tabView;
        this.allTabViews.set(tabView.waveTabId, tabView);
        if (!tabInitialized) {
            console.log("initializing a new tab");
            await tabView.initPromise;
            this.contentView.addChildView(tabView);
            const initOpts = {
                tabId: tabView.waveTabId,
                clientId: clientData.oid,
                windowId: this.waveWindowId,
                activate: true,
            };
            tabView.savedInitOpts = { ...initOpts };
            tabView.savedInitOpts.activate = false;
            let startTime = Date.now();
            tabView.webContents.send("wave-init", initOpts);
            console.log("before wave ready");
            await tabView.waveReadyPromise;
            // positionTabOnScreen(tabView, this.getContentBounds());
            console.log("wave-ready init time", Date.now() - startTime + "ms");
            // positionTabOffScreen(oldActiveView, this.getContentBounds());
            await this.repositionTabsSlowly(100);
        } else {
            console.log("reusing an existing tab");
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
        for (const tabView of this.allTabViews.values()) {
            if (tabView == this.activeTabView) {
                continue;
            }
            tabView?.positionTabOffScreen(curBounds);
        }
    }

    queueTabSwitch(tabView: WaveTabView, tabInitialized: boolean) {
        if (this.tabSwitchQueue.length == 2) {
            this.tabSwitchQueue[1] = { tabView, tabInitialized };
            return;
        }
        this.tabSwitchQueue.push({ tabView, tabInitialized });
        if (this.tabSwitchQueue.length == 1) {
            this.processTabSwitchQueue();
        }
    }

    async processTabSwitchQueue() {
        if (this.tabSwitchQueue.length == 0) {
            this.tabSwitchQueue = [];
            return;
        }
        try {
            const { tabView, tabInitialized } = this.tabSwitchQueue[0];
            await this.setTabViewIntoWindow(tabView, tabInitialized);
        } finally {
            this.tabSwitchQueue.shift();
            this.processTabSwitchQueue();
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
        for (const tabView of this.allTabViews.values()) {
            tabView?.destroy();
        }
        waveWindowMap.delete(this.waveWindowId);
        super.destroy();
    }
}

export function getWaveWindowByTabId(tabId: string): WaveBrowserWindow {
    for (const ww of waveWindowMap.values()) {
        if (ww.allTabViews.has(tabId)) {
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

// TODO:
// note, this does not *show* the window.
// to show, await win.readyPromise and then win.show()
export async function createBrowserWindow(
    clientId: string,
    waveWindow: WaveWindow,
    fullConfig: FullConfigType,
    opts: WindowOpts
): Promise<WaveBrowserWindow> {
    console.log("createBrowserWindow", waveWindow.oid);
    const bwin = new WaveBrowserWindow(waveWindow, fullConfig, opts);

    const workspace = await ClientService.GetWorkspace(waveWindow.workspaceid);
    console.log("workspace", workspace);
    if (workspace.activetabid) {
        console.log("set active tab id");
        await bwin.setActiveTab(workspace.activetabid);
    }
    return bwin;
}

ipcMain.on("set-active-tab", async (event, tabId) => {
    const ww = getWaveWindowByWebContentsId(event.sender.id);
    console.log("set-active-tab", tabId, ww?.waveWindowId);
    await ww?.setActiveTab(tabId);
});

ipcMain.on("create-tab", async (event, opts) => {
    const senderWc = event.sender;
    const ww = getWaveWindowByWebContentsId(senderWc.id);
    if (!ww) {
        return;
    }
    await ww.createTab();
    event.returnValue = true;
    return null;
});

ipcMain.on("close-tab", async (event, tabId) => {
    const ww = getWaveWindowByTabId(tabId);
    await ww.closeTab(tabId);
    event.returnValue = true;
    return null;
});

ipcMain.on("switch-workspace", async (event, workspaceId) => {
    const ww = getWaveWindowByWebContentsId(event.sender.id);
    console.log("switch-workspace", workspaceId, ww?.waveWindowId);
    await ww?.switchWorkspace(workspaceId);
});

ipcMain.on("delete-workspace", async (event, workspaceId) => {
    const ww = getWaveWindowByWebContentsId(event.sender.id);
    console.log("delete-workspace", workspaceId, ww?.waveWindowId);
    await WorkspaceService.DeleteWorkspace(workspaceId);
});
