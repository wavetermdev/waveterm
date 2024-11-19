import { ClientService, FileService, ObjectService, WindowService } from "@/app/store/services";
import { dialog, screen } from "electron";
import path from "path";
import { debounce } from "throttle-debounce";
import { getGlobalIsQuitting, getGlobalIsRelaunching, setWasActive, setWasInFg } from "./emain-activity";
import { ensureBoundsAreVisible } from "./emain-util";
import { destroyWindow, queueTabSwitch } from "./emain-viewmgr";
import { getElectronAppBasePath } from "./platform";
import { updater } from "./updater";

export type WindowOpts = {
    unamePlatform: string;
};

export class WaveBrowserWindow extends Electron.BaseWindow {
    baseWindow: Electron.BaseWindow;
    waveWindowId: string;
    workspaceId: string;
    waveReadyPromise: Promise<void>;
    allTabViews: Map<string, WaveTabView>;
    activeTabView: WaveTabView;
    alreadyClosed: boolean;
    deleteAllowed: boolean;

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
        const winOpts: Electron.BaseWindowConstructorOptions = {
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
        this.waveWindowId = waveWindow.oid;
        this.workspaceId = waveWindow.workspaceid;
        this.alreadyClosed = false;
        this.allTabViews = new Map<string, WaveTabView>();
        const winBoundsPoller = setInterval(() => {
            if (this.isDestroyed()) {
                clearInterval(winBoundsPoller);
                return;
            }
            if (tabSwitchQueue.length > 0) {
                return;
            }
            finalizePositioning(this);
        }, 1000);
        this.on(
            // @ts-expect-error
            "resize",
            debounce(400, (e) => mainResizeHandler(e, waveWindow.oid, win))
        );
        this.on("resize", () => {
            if (this.isDestroyed()) {
                return;
            }
            positionTabOnScreen(this.activeTabView, this.getContentBounds());
        });
        this.on(
            // @ts-expect-error
            "move",
            debounce(400, (e) => mainResizeHandler(e, waveWindow.oid, this))
        );
        this.on("enter-full-screen", async () => {
            console.log("enter-full-screen event", this.getContentBounds());
            const tabView = this.activeTabView;
            if (tabView) {
                tabView.webContents.send("fullscreen-change", true);
            }
            positionTabOnScreen(this.activeTabView, this.getContentBounds());
        });
        this.on("leave-full-screen", async () => {
            const tabView = this.activeTabView;
            if (tabView) {
                tabView.webContents.send("fullscreen-change", false);
            }
            positionTabOnScreen(this.activeTabView, this.getContentBounds());
        });
        this.on("focus", () => {
            if (getGlobalIsRelaunching()) {
                return;
            }
            focusedWaveWindow = win;
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
                destroyWindow(this);
                return;
            }
            const numWindows = waveWindowMap.size;
            if (numWindows == 0) {
                return;
            }
            if (!this.alreadyClosed && this.deleteAllowed) {
                console.log("win removing window from backend DB", this.waveWindowId);
                WindowService.CloseWindow(waveWindow.oid, true);
            }
            destroyWindow(this);
        });
        waveWindowMap.set(waveWindow.oid, this);
    }

    async setActiveTab(waveWindow: WaveBrowserWindow, tabId: string) {
        console.log("setActiveTab", waveWindow);
        const workspace = await ClientService.GetWorkspace(waveWindow.workspaceId);
        await ObjectService.SetActiveTab(workspace.oid, tabId);
        const fullConfig = await FileService.GetFullConfig();
        const [tabView, tabInitialized] = getOrCreateWebViewForTab(fullConfig, waveWindow.workspaceId, tabId);
        queueTabSwitch(waveWindow, tabView, tabInitialized);
    }
}
