// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as electron from "electron";
import fs from "fs";
import * as child_process from "node:child_process";
import os from "os";
import * as path from "path";
import * as readline from "readline";
import { debounce } from "throttle-debounce";
import * as services from "../frontend/app/store/services";

const electronApp = electron.app;
const isDev = process.env.WAVETERM_DEV;
const isDevServer = !electronApp.isPackaged && process.env.ELECTRON_RENDERER_URL;

const WaveAppPathVarName = "WAVETERM_APP_PATH";
const WaveDevVarName = "WAVETERM_DEV";
const WaveSrvReadySignalPidVarName = "WAVETERM_READY_SIGNAL_PID";
const AuthKeyFile = "waveterm.authkey";
const DevServerEndpoint = "http://127.0.0.1:8190";
const ProdServerEndpoint = "http://127.0.0.1:1719";

type WaveBrowserWindow = Electron.BrowserWindow & { waveWindowId: string; readyPromise: Promise<void> };

let waveSrvReadyResolve = (value: boolean) => {};
let waveSrvReady: Promise<boolean> = new Promise((resolve, _) => {
    waveSrvReadyResolve = resolve;
});
let globalIsQuitting = false;
let globalIsStarting = true;

let waveSrvProc: child_process.ChildProcessWithoutNullStreams | null = null;
electronApp.setName(isDev ? "NextWave (Dev)" : "NextWave");
const unamePlatform = process.platform;
let unameArch: string = process.arch;
if (unameArch == "x64") {
    unameArch = "amd64";
}

function getBaseHostPort(): string {
    if (isDev) {
        return DevServerEndpoint;
    }
    return ProdServerEndpoint;
}

// must match golang
function getWaveHomeDir() {
    return path.join(os.homedir(), ".w2");
}

function getElectronAppBasePath(): string {
    return path.dirname(__dirname);
}

function getGoAppBasePath(): string {
    const appDir = getElectronAppBasePath();
    if (appDir.endsWith(".asar")) {
        return `${appDir}.unpacked`;
    } else {
        return appDir;
    }
}

function getWaveSrvPath(): string {
    return path.join(getGoAppBasePath(), "bin", "wavesrv");
}

function getWaveSrvPathWin(): string {
    const appPath = path.join(getGoAppBasePath(), "bin", "wavesrv.exe");
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
    if (isDev) {
        envCopy[WaveDevVarName] = "1";
    }
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
            waveSrvReadyResolve(true);
            return;
        }
        console.log(line);
    });
    return rtnPromise;
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
        (url.startsWith("blob:file:///") || url.startsWith(getBaseHostPort() + "/wave/stream-file?"))
    ) {
        // allowed
        return;
    }
    event.preventDefault();
    console.log("frame navigation canceled");
}

function createBrowserWindow(client: Client, waveWindow: WaveWindow): WaveBrowserWindow {
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
    // const indexHtml = isDev ? "index-dev.html" : "index.html";
    let usp = new URLSearchParams();
    usp.set("clientid", client.oid);
    usp.set("windowid", waveWindow.oid);
    const indexHtml = "index.html";
    if (isDevServer) {
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
        for (let display of displays) {
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

electron.ipcMain.on("isDev", (event) => {
    event.returnValue = isDev;
});

electron.ipcMain.on("isDevServer", (event) => {
    event.returnValue = isDevServer;
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

async function createNewWaveWindow() {
    let clientData = await services.ClientService.GetClientData();
    const newWindow = await services.ClientService.MakeWindow();
    createBrowserWindow(clientData, newWindow);
}

electron.ipcMain.on("openNewWindow", createNewWaveWindow);

electron.ipcMain.on("context-editmenu", (_, { x, y }, opts) => {
    if (opts == null) {
        opts = {};
    }
    console.log("context-editmenu");
    const menu = new electron.Menu();
    if (!opts.onlyPaste) {
        if (opts.showCut) {
            const menuItem = new electron.MenuItem({ label: "Cut", role: "cut" });
            menu.append(menuItem);
        }
        const menuItem = new electron.MenuItem({ label: "Copy", role: "copy" });
        menu.append(menuItem);
    }
    const menuItem = new electron.MenuItem({ label: "Paste", role: "paste" });
    menu.append(menuItem);
    menu.popup({ x, y });
});

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
    let fileMenu: Electron.MenuItemConstructorOptions[] = [];
    fileMenu.push({
        label: "New Window",
        click: createNewWaveWindow,
    });
    fileMenu.push({
        label: "Close Window",
        click: () => {
            electron.BrowserWindow.getFocusedWindow()?.close();
        },
    });
    const menuTemplate: Electron.MenuItemConstructorOptions[] = [
        {
            role: "appMenu",
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
    let clientData = await services.ClientService.GetClientData();
    console.log("client data ready");
    await electronApp.whenReady();
    let wins: WaveBrowserWindow[] = [];
    for (let windowId of clientData.windowids.slice().reverse()) {
        let windowData: WaveWindow = (await services.ObjectService.GetObject("window:" + windowId)) as WaveWindow;
        const win = createBrowserWindow(clientData, windowData);
        wins.push(win);
    }
    for (let win of wins) {
        await win.readyPromise;
        console.log("show", win.waveWindowId);
        win.show();
    }
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
