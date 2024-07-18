// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WaveDevVarName, WaveDevViteVarName } from "@/util/isdev";
import * as electron from "electron";
import { autoUpdater } from "electron-updater";
import fs from "fs";
import * as child_process from "node:child_process";
import os from "os";
import * as path from "path";
import * as readline from "readline";
import { sprintf } from "sprintf-js";
import { debounce } from "throttle-debounce";
import * as util from "util";
import winston from "winston";
import * as services from "../frontend/app/store/services";
import { WSServerEndpointVarName, WebServerEndpointVarName, getWebServerEndpoint } from "../frontend/util/endpoints";
import * as keyutil from "../frontend/util/keyutil";
import { fireAndForget } from "../frontend/util/util";

const electronApp = electron.app;

const WaveAppPathVarName = "WAVETERM_APP_PATH";
const WaveSrvReadySignalPidVarName = "WAVETERM_READY_SIGNAL_PID";
const AuthKeyFile = "waveterm.authkey";
electron.nativeTheme.themeSource = "dark";

type WaveBrowserWindow = Electron.BrowserWindow & { waveWindowId: string; readyPromise: Promise<void> };

let waveSrvReadyResolve = (value: boolean) => {};
const waveSrvReady: Promise<boolean> = new Promise((resolve, _) => {
    waveSrvReadyResolve = resolve;
});
let globalIsQuitting = false;
let globalIsStarting = true;

const isDev = !electron.app.isPackaged;
const isDevVite = isDev && process.env.ELECTRON_RENDERER_URL;
if (isDev) {
    process.env[WaveDevVarName] = "1";
}
if (isDevVite) {
    process.env[WaveDevViteVarName] = "1";
}

let waveSrvProc: child_process.ChildProcessWithoutNullStreams | null = null;
electronApp.setName(isDev ? "TheNextWave (Dev)" : "TheNextWave");
const unamePlatform = process.platform;
let unameArch: string = process.arch;
if (unameArch == "x64") {
    unameArch = "amd64";
}
keyutil.setKeyUtilPlatform(unamePlatform);

// must match golang
function getWaveHomeDir() {
    return path.join(os.homedir(), isDev ? ".w2-dev" : ".w2");
}

const waveHome = getWaveHomeDir();

const oldConsoleLog = console.log;

const loggerTransports: winston.transport[] = [
    new winston.transports.File({ filename: path.join(waveHome, "waveterm-app.log"), level: "info" }),
];
if (isDev) {
    loggerTransports.push(new winston.transports.Console());
}
const loggerConfig = {
    level: "info",
    format: winston.format.combine(
        winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        winston.format.printf((info) => `${info.timestamp} ${info.message}`)
    ),
    transports: loggerTransports,
};
const logger = winston.createLogger(loggerConfig);
function log(...msg: any[]) {
    try {
        logger.info(util.format(...msg));
    } catch (e) {
        oldConsoleLog(...msg);
    }
}
console.log = log;
console.log(
    sprintf(
        "waveterm-app starting, WAVETERM_HOME=%s, electronpath=%s gopath=%s arch=%s/%s",
        waveHome,
        getElectronAppBasePath(),
        getGoAppBasePath(),
        unamePlatform,
        unameArch
    )
);
if (isDev) {
    console.log("waveterm-app WAVETERM_DEV set");
}

function getElectronAppBasePath(): string {
    return path.dirname(__dirname);
}

function getGoAppBasePath(): string {
    return getElectronAppBasePath().replace("app.asar", "app.asar.unpacked");
}

const wavesrvBinName = `wavesrv.${unameArch}`;

function getWaveSrvPath(): string {
    return path.join(getGoAppBasePath(), "bin", wavesrvBinName);
}

function getWaveSrvPathWin(): string {
    const winBinName = `${wavesrvBinName}.exe`;
    const appPath = path.join(getGoAppBasePath(), "bin", winBinName);
    return `& "${appPath}"`;
}

function getWaveSrvCwd(): string {
    return getWaveHomeDir();
}

function getWindowForEvent(event: Electron.IpcMainEvent): Electron.BrowserWindow {
    const windowId = event.sender.id;
    return electron.BrowserWindow.fromId(windowId);
}

function runWaveSrv(): Promise<boolean> {
    let pResolve: (value: boolean) => void;
    let pReject: (reason?: any) => void;
    const rtnPromise = new Promise<boolean>((argResolve, argReject) => {
        pResolve = argResolve;
        pReject = argReject;
    });
    const envCopy = { ...process.env };
    envCopy[WaveAppPathVarName] = getGoAppBasePath();
    envCopy[WaveSrvReadySignalPidVarName] = process.pid.toString();
    let waveSrvCmd: string;
    if (process.platform === "win32") {
        waveSrvCmd = getWaveSrvPathWin();
    } else {
        waveSrvCmd = getWaveSrvPath();
    }
    console.log("trying to run local server", waveSrvCmd);
    const proc = child_process.spawn(getWaveSrvPath(), {
        cwd: getWaveSrvCwd(),
        env: envCopy,
    });
    proc.on("exit", (e) => {
        if (globalIsQuitting) {
            return;
        }
        console.log("wavesrv exited, shutting down");
        electronApp.quit();
    });
    proc.on("spawn", (e) => {
        console.log("spawned wavesrv");
        waveSrvProc = proc;
        pResolve(true);
    });
    proc.on("error", (e) => {
        console.log("error running wavesrv", e);
        pReject(e);
    });
    const rlStdout = readline.createInterface({
        input: proc.stdout,
        terminal: false,
    });
    rlStdout.on("line", (line) => {
        console.log(line);
    });
    const rlStderr = readline.createInterface({
        input: proc.stderr,
        terminal: false,
    });
    rlStderr.on("line", (line) => {
        if (line.includes("WAVESRV-ESTART")) {
            const addrs = /ws:([a-z0-9.:]+) web:([a-z0-9.:]+)/gm.exec(line);
            if (addrs == null) {
                console.log("error parsing WAVESRV-ESTART line", line);
                electron.app.quit();
                return;
            }
            process.env[WSServerEndpointVarName] = addrs[1];
            process.env[WebServerEndpointVarName] = addrs[2];
            waveSrvReadyResolve(true);
            return;
        }
        if (line.startsWith("WAVESRV-EVENT:")) {
            const evtJson = line.slice("WAVESRV-EVENT:".length);
            try {
                const evtMsg: WSEventType = JSON.parse(evtJson);
                handleWSEvent(evtMsg);
            } catch (e) {
                console.log("error handling WAVESRV-EVENT", e);
            }
            return;
        }
        console.log(line);
    });
    return rtnPromise;
}

async function handleWSEvent(evtMsg: WSEventType) {
    if (evtMsg.eventtype == "electron:newwindow") {
        const windowId: string = evtMsg.data;
        const windowData: WaveWindow = (await services.ObjectService.GetObject("window:" + windowId)) as WaveWindow;
        if (windowData == null) {
            return;
        }
        const clientData = await services.ClientService.GetClientData();
        const newWin = createBrowserWindow(clientData.oid, windowData);
        await newWin.readyPromise;
        newWin.show();
    } else {
        console.log("unhandled electron ws eventtype", evtMsg.eventtype);
    }
}

async function mainResizeHandler(_: any, windowId: string, win: WaveBrowserWindow) {
    if (win == null || win.isDestroyed() || win.fullScreen) {
        return;
    }
    const bounds = win.getBounds();
    try {
        await services.WindowService.SetWindowPosAndSize(
            windowId,
            { x: bounds.x, y: bounds.y },
            { width: bounds.width, height: bounds.height }
        );
    } catch (e) {
        console.log("error resizing window", e);
    }
}

function shNavHandler(event: Electron.Event<Electron.WebContentsWillNavigateEventParams>, url: string) {
    if (url.startsWith("http://127.0.0.1:5173/index.html") || url.startsWith("http://localhost:5173/index.html")) {
        // this is a dev-mode hot-reload, ignore it
        console.log("allowing hot-reload of index.html");
        return;
    }
    event.preventDefault();
    if (url.startsWith("https://") || url.startsWith("http://") || url.startsWith("file://")) {
        console.log("open external, shNav", url);
        electron.shell.openExternal(url);
    } else {
        console.log("navigation canceled", url);
    }
}

function shFrameNavHandler(event: Electron.Event<Electron.WebContentsWillFrameNavigateEventParams>) {
    if (!event.frame?.parent) {
        // only use this handler to process iframe events (non-iframe events go to shNavHandler)
        return;
    }
    const url = event.url;
    console.log(`frame-navigation url=${url} frame=${event.frame.name}`);
    if (event.frame.name == "webview") {
        // "webview" links always open in new window
        // this will *not* effect the initial load because srcdoc does not count as an electron navigation
        console.log("open external, frameNav", url);
        event.preventDefault();
        electron.shell.openExternal(url);
        return;
    }
    if (
        event.frame.name == "pdfview" &&
        (url.startsWith("blob:file:///") || url.startsWith(getWebServerEndpoint() + "/wave/stream-file?"))
    ) {
        // allowed
        return;
    }
    event.preventDefault();
    console.log("frame navigation canceled");
}

// note, this does not *show* the window.
// to show, await win.readyPromise and then win.show()
function createBrowserWindow(clientId: string, waveWindow: WaveWindow): WaveBrowserWindow {
    let winBounds = {
        x: waveWindow.pos.x,
        y: waveWindow.pos.y,
        width: waveWindow.winsize.width,
        height: waveWindow.winsize.height,
    };
    winBounds = ensureBoundsAreVisible(winBounds);
    const bwin = new electron.BrowserWindow({
        titleBarStyle: "hiddenInset",
        x: winBounds.x,
        y: winBounds.y,
        width: winBounds.width,
        height: winBounds.height,
        minWidth: 400,
        minHeight: 300,
        icon:
            unamePlatform == "linux"
                ? path.join(getElectronAppBasePath(), "public/logos/wave-logo-dark.png")
                : undefined,
        webPreferences: {
            preload: path.join(getElectronAppBasePath(), "preload", "index.cjs"),
            webviewTag: true,
        },
        show: false,
        autoHideMenuBar: true,
        backgroundColor: "#000000",
    });
    (bwin as any).waveWindowId = waveWindow.oid;
    let readyResolve: (value: void) => void;
    (bwin as any).readyPromise = new Promise((resolve, _) => {
        readyResolve = resolve;
    });
    const win: WaveBrowserWindow = bwin as WaveBrowserWindow;
    const usp = new URLSearchParams();
    usp.set("clientid", clientId);
    usp.set("windowid", waveWindow.oid);
    const indexHtml = "index.html";
    if (isDevVite) {
        console.log("running as dev server");
        win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/index.html?${usp.toString()}`);
    } else {
        console.log("running as file");
        win.loadFile(path.join(getElectronAppBasePath(), "frontend", indexHtml), { search: usp.toString() });
    }
    win.once("ready-to-show", () => {
        readyResolve();
    });
    win.webContents.on("will-navigate", shNavHandler);
    win.webContents.on("will-frame-navigate", shFrameNavHandler);
    win.webContents.on("did-attach-webview", (event, wc) => {
        wc.setWindowOpenHandler((details) => {
            win.webContents.send("webview-new-window", wc.id, details);
            return { action: "deny" };
        });
    });
    win.on(
        "resize",
        debounce(400, (e) => mainResizeHandler(e, waveWindow.oid, win))
    );
    win.on(
        "move",
        debounce(400, (e) => mainResizeHandler(e, waveWindow.oid, win))
    );
    win.on("focus", () => {
        if (globalIsStarting) {
            return;
        }
        console.log("focus", waveWindow.oid);
        services.ClientService.FocusWindow(waveWindow.oid);
    });
    win.on("close", (e) => {
        if (globalIsQuitting) {
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
        if (globalIsQuitting) {
            return;
        }
        services.WindowService.CloseWindow(waveWindow.oid);
    });
    win.webContents.on("zoom-changed", (e) => {
        win.webContents.send("zoom-changed");
    });
    win.webContents.setWindowOpenHandler(({ url, frameName }) => {
        if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("file://")) {
            console.log("openExternal fallback", url);
            electron.shell.openExternal(url);
        }
        console.log("window-open denied", url);
        return { action: "deny" };
    });
    return win;
}

function isWindowFullyVisible(bounds: electron.Rectangle): boolean {
    const displays = electron.screen.getAllDisplays();

    // Helper function to check if a point is inside any display
    function isPointInDisplay(x, y) {
        for (const display of displays) {
            const { x: dx, y: dy, width, height } = display.bounds;
            if (x >= dx && x < dx + width && y >= dy && y < dy + height) {
                return true;
            }
        }
        return false;
    }

    // Check all corners of the window
    const topLeft = isPointInDisplay(bounds.x, bounds.y);
    const topRight = isPointInDisplay(bounds.x + bounds.width, bounds.y);
    const bottomLeft = isPointInDisplay(bounds.x, bounds.y + bounds.height);
    const bottomRight = isPointInDisplay(bounds.x + bounds.width, bounds.y + bounds.height);

    return topLeft && topRight && bottomLeft && bottomRight;
}

function findDisplayWithMostArea(bounds: electron.Rectangle): electron.Display {
    const displays = electron.screen.getAllDisplays();
    let maxArea = 0;
    let bestDisplay = null;

    for (let display of displays) {
        const { x, y, width, height } = display.bounds;
        const overlapX = Math.max(0, Math.min(bounds.x + bounds.width, x + width) - Math.max(bounds.x, x));
        const overlapY = Math.max(0, Math.min(bounds.y + bounds.height, y + height) - Math.max(bounds.y, y));
        const overlapArea = overlapX * overlapY;

        if (overlapArea > maxArea) {
            maxArea = overlapArea;
            bestDisplay = display;
        }
    }

    return bestDisplay;
}

function adjustBoundsToFitDisplay(bounds: electron.Rectangle, display: electron.Display): electron.Rectangle {
    const { x: dx, y: dy, width: dWidth, height: dHeight } = display.workArea;
    let { x, y, width, height } = bounds;

    // Adjust width and height to fit within the display's work area
    width = Math.min(width, dWidth);
    height = Math.min(height, dHeight);

    // Adjust x to ensure the window fits within the display
    if (x < dx) {
        x = dx;
    } else if (x + width > dx + dWidth) {
        x = dx + dWidth - width;
    }

    // Adjust y to ensure the window fits within the display
    if (y < dy) {
        y = dy;
    } else if (y + height > dy + dHeight) {
        y = dy + dHeight - height;
    }
    return { x, y, width, height };
}

function ensureBoundsAreVisible(bounds: electron.Rectangle): electron.Rectangle {
    if (!isWindowFullyVisible(bounds)) {
        let targetDisplay = findDisplayWithMostArea(bounds);

        if (!targetDisplay) {
            targetDisplay = electron.screen.getPrimaryDisplay();
        }

        return adjustBoundsToFitDisplay(bounds, targetDisplay);
    }
    return bounds;
}

electron.ipcMain.on("getPlatform", (event, url) => {
    event.returnValue = unamePlatform;
});
// Listen for the open-external event from the renderer process
electron.ipcMain.on("open-external", (event, url) => {
    if (url && typeof url === "string") {
        electron.shell.openExternal(url).catch((err) => {
            console.error(`Failed to open URL ${url}:`, err);
        });
    } else {
        console.error("Invalid URL received in open-external event:", url);
    }
});

electron.ipcMain.on("download", (event, payload) => {
    const window = electron.BrowserWindow.fromWebContents(event.sender);
    const streamingUrl = getWebServerEndpoint() + "/wave/stream-file?path=" + encodeURIComponent(payload.filePath);
    window.webContents.downloadURL(streamingUrl);
});

electron.ipcMain.on("getCursorPoint", (event) => {
    const window = electron.BrowserWindow.fromWebContents(event.sender);
    const screenPoint = electron.screen.getCursorScreenPoint();
    const windowRect = window.getContentBounds();
    const retVal: Electron.Point = {
        x: screenPoint.x - windowRect.x,
        y: screenPoint.y - windowRect.y,
    };
    event.returnValue = retVal;
});

electron.ipcMain.on("getEnv", (event, varName) => {
    event.returnValue = process.env[varName] ?? null;
});

async function createNewWaveWindow() {
    const clientData = await services.ClientService.GetClientData();
    const newWindow = await services.ClientService.MakeWindow();
    const newBrowserWindow = createBrowserWindow(clientData.oid, newWindow);
    newBrowserWindow.show();
}

electron.ipcMain.on("openNewWindow", () => fireAndForget(createNewWaveWindow));

electron.ipcMain.on("contextmenu-show", (event, menuDefArr: ElectronContextMenuItem[], { x, y }) => {
    if (menuDefArr == null || menuDefArr.length == 0) {
        return;
    }
    const menu = convertMenuDefArrToMenu(menuDefArr);
    menu.popup({ x, y });
    event.returnValue = true;
});

function convertMenuDefArrToMenu(menuDefArr: ElectronContextMenuItem[]): electron.Menu {
    const menuItems: electron.MenuItem[] = [];
    for (const menuDef of menuDefArr) {
        const menuItemTemplate: electron.MenuItemConstructorOptions = {
            role: menuDef.role as any,
            label: menuDef.label,
            type: menuDef.type,
            click: (_, window) => {
                window?.webContents.send("contextmenu-click", menuDef.id);
            },
        };
        if (menuDef.submenu != null) {
            menuItemTemplate.submenu = convertMenuDefArrToMenu(menuDef.submenu);
        }
        const menuItem = new electron.MenuItem(menuItemTemplate);
        menuItems.push(menuItem);
    }
    return electron.Menu.buildFromTemplate(menuItems);
}

function makeAppMenu() {
    const fileMenu: Electron.MenuItemConstructorOptions[] = [
        {
            label: "New Window",
            accelerator: "CommandOrControl+N",
            click: () => fireAndForget(createNewWaveWindow),
        },
        {
            role: "close",
            click: () => {
                electron.BrowserWindow.getFocusedWindow()?.close();
            },
        },
    ];
    const appMenu: Electron.MenuItemConstructorOptions[] = [
        {
            role: "about",
        },
        {
            label: "Check for Updates",
            click: () => {
                const checkingNotification = new electron.Notification({
                    title: "Wave Terminal",
                    body: "Checking for updates.",
                });
                checkingNotification.show();
                fireAndForget(() => checkForUpdates());
            },
        },
        {
            type: "separator",
        },
        {
            role: "services",
        },
        {
            type: "separator",
        },
        {
            role: "hide",
        },
        {
            role: "hideOthers",
        },
        {
            type: "separator",
        },
        {
            role: "quit",
        },
    ];
    const menuTemplate: Electron.MenuItemConstructorOptions[] = [
        {
            role: "appMenu",
            submenu: appMenu,
        },
        {
            role: "fileMenu",
            submenu: fileMenu,
        },
        {
            role: "editMenu",
        },
        {
            role: "viewMenu",
        },
        {
            role: "windowMenu",
        },
    ];
    const menu = electron.Menu.buildFromTemplate(menuTemplate);
    electron.Menu.setApplicationMenu(menu);
}

electron.app.on("before-quit", () => {
    globalIsQuitting = true;
});
process.on("SIGINT", () => {
    console.log("Caught SIGINT, shutting down");
    electron.app.quit();
});
process.on("SIGHUP", () => {
    console.log("Caught SIGHUP, shutting down");
    electron.app.quit();
});
process.on("SIGTERM", () => {
    console.log("Caught SIGTERM, shutting down");
    electron.app.quit();
});
let caughtException = false;
process.on("uncaughtException", (error) => {
    if (caughtException) {
        return;
    }
    logger.error("Uncaught Exception, shutting down: ", error);
    caughtException = true;
    // Optionally, handle cleanup or exit the app
    electron.app.quit();
});

// ====== AUTO-UPDATER ====== //
let autoUpdateLock = false;
let autoUpdateInterval: NodeJS.Timeout | null = null;
let availableUpdateReleaseName: string | null = null;
let availableUpdateReleaseNotes: string | null = null;
let appUpdateStatus = "unavailable";
let lastUpdateCheck: Date = null;

/**
 * Sets the app update status and sends it to the main window
 * @param status The AppUpdateStatus to set, either "ready" or "unavailable"
 */
function setAppUpdateStatus(status: string) {
    appUpdateStatus = status;
    electron.BrowserWindow.getAllWindows().forEach((window) => {
        window.webContents.send("app-update-status", appUpdateStatus);
    });
}

/**
 * Checks if an hour has passed since the last update check, and if so, checks for updates using the `autoUpdater` object
 */
async function checkForUpdates() {
    const autoUpdateOpts = (await services.FileService.GetSettingsConfig()).autoupdate;

    if (!autoUpdateOpts.enabled) {
        console.log("Auto update is disabled in settings. Removing the auto update interval.");
        clearInterval(autoUpdateInterval);
        autoUpdateInterval = null;
        return;
    }
    const now = new Date();
    if (!lastUpdateCheck || Math.abs(now.getTime() - lastUpdateCheck.getTime()) > autoUpdateOpts.intervalms) {
        fireAndForget(() => autoUpdater.checkForUpdates());
        lastUpdateCheck = now;
    }
}

/**
 * Initializes the updater and sets up event listeners
 */
function initUpdater() {
    if (isDev) {
        console.log("skipping auto-updater in dev mode");
        return null;
    }

    setAppUpdateStatus("unavailable");

    autoUpdater.removeAllListeners();

    autoUpdater.on("error", (err) => {
        console.log("updater error");
        console.log(err);
    });

    autoUpdater.on("checking-for-update", () => {
        console.log("checking-for-update");
    });

    autoUpdater.on("update-available", () => {
        console.log("update-available; downloading...");
    });

    autoUpdater.on("update-not-available", () => {
        console.log("update-not-available");
    });

    autoUpdater.on("update-downloaded", (event) => {
        console.log("update-downloaded", [event]);
        availableUpdateReleaseName = event.releaseName;
        availableUpdateReleaseNotes = event.releaseNotes as string | null;

        // Display the update banner and create a system notification
        setAppUpdateStatus("ready");
        const updateNotification = new electron.Notification({
            title: "Wave Terminal",
            body: "A new version of Wave Terminal is ready to install.",
        });
        updateNotification.on("click", () => {
            fireAndForget(() => installAppUpdate());
        });
        updateNotification.show();
    });
}

/**
 * Starts the auto update check interval.
 * @returns The timeout object for the auto update checker.
 */
function startAutoUpdateInterval(): NodeJS.Timeout {
    // check for updates right away and keep checking later
    checkForUpdates();
    return setInterval(() => {
        checkForUpdates();
    }, 600000); // intervals are unreliable when an app is suspended so we will check every 10 mins if an hour has passed.
}

/**
 * Prompts the user to install the downloaded application update and restarts the application
 */
async function installAppUpdate() {
    const dialogOpts: Electron.MessageBoxOptions = {
        type: "info",
        buttons: ["Restart", "Later"],
        title: "Application Update",
        message: process.platform === "win32" ? availableUpdateReleaseNotes : availableUpdateReleaseName,
        detail: "A new version has been downloaded. Restart the application to apply the updates.",
    };

    const allWindows = electron.BrowserWindow.getAllWindows();
    if (allWindows.length > 0) {
        await electron.dialog
            .showMessageBox(electron.BrowserWindow.getFocusedWindow() ?? allWindows[0], dialogOpts)
            .then(({ response }) => {
                if (response === 0) autoUpdater.quitAndInstall();
            });
    }
}

electron.ipcMain.on("install-app-update", () => fireAndForget(() => installAppUpdate()));
electron.ipcMain.on("get-app-update-status", (event) => {
    event.returnValue = appUpdateStatus;
});

/**
 * Configures the auto-updater based on the user's preference
 * @param enabled Whether the auto-updater should be enabled
 */
async function configureAutoUpdater() {
    // simple lock to prevent multiple auto-update configuration attempts, this should be very rare
    if (autoUpdateLock) {
        console.log("auto-update configuration already in progress, skipping");
        return;
    }

    autoUpdateLock = true;

    const autoUpdateEnabled = (await services.FileService.GetSettingsConfig()).autoupdate.enabled;

    try {
        console.log("Configuring updater");
        initUpdater();
    } catch (e) {
        console.warn("error configuring updater", e.toString());
    }

    if (autoUpdateEnabled && autoUpdateInterval == null) {
        lastUpdateCheck = null;
        try {
            console.log("configuring auto update interval");
            autoUpdateInterval = startAutoUpdateInterval();
        } catch (e) {
            console.log("error configuring auto update interval", e.toString());
        }
    } else if (!autoUpdateEnabled && autoUpdateInterval != null) {
        console.log("disabling auto updater");
        clearInterval(autoUpdateInterval);
        autoUpdateInterval = null;
    }
    autoUpdateLock = false;
}
// ====== AUTO-UPDATER ====== //

async function appMain() {
    const startTs = Date.now();
    const instanceLock = electronApp.requestSingleInstanceLock();
    if (!instanceLock) {
        console.log("waveterm-app could not get single-instance-lock, shutting down");
        electronApp.quit();
        return;
    }
    const waveHomeDir = getWaveHomeDir();
    if (!fs.existsSync(waveHomeDir)) {
        fs.mkdirSync(waveHomeDir);
    }
    makeAppMenu();
    try {
        await runWaveSrv();
    } catch (e) {
        console.log(e.toString());
    }
    const ready = await waveSrvReady;
    console.log("wavesrv ready signal received", ready, Date.now() - startTs, "ms");
    console.log("get client data");
    const clientData = await services.ClientService.GetClientData();
    console.log("client data ready");
    await electronApp.whenReady();
    const wins: WaveBrowserWindow[] = [];
    for (const windowId of clientData.windowids.slice().reverse()) {
        const windowData: WaveWindow = (await services.ObjectService.GetObject("window:" + windowId)) as WaveWindow;
        if (windowData == null) {
            services.WindowService.CloseWindow(windowId).catch((e) => {
                /* ignore */
            });
            continue;
        }
        const win = createBrowserWindow(clientData.oid, windowData);
        wins.push(win);
    }
    for (const win of wins) {
        await win.readyPromise;
        console.log("show", win.waveWindowId);
        win.show();
    }
    configureAutoUpdater();
    globalIsStarting = false;

    electronApp.on("activate", () => {
        if (electron.BrowserWindow.getAllWindows().length === 0) {
            createNewWaveWindow();
        }
    });
}

appMain().catch((e) => {
    console.log("appMain error", e);
    electronApp.quit();
});
