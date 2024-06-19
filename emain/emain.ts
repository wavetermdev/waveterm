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

let waveSrvReadyResolve = (value: boolean) => {};
let waveSrvReady: Promise<boolean> = new Promise((resolve, _) => {
    waveSrvReadyResolve = resolve;
});

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

async function mainResizeHandler(_: any, windowId: string, win: Electron.BrowserWindow) {
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

function createWindow(client: Client, waveWindow: WaveWindow): Electron.BrowserWindow {
    const primaryDisplay = electron.screen.getPrimaryDisplay();
    let winHeight = waveWindow.winsize.height;
    let winWidth = waveWindow.winsize.width;
    if (winHeight > primaryDisplay.workAreaSize.height) {
        winHeight = primaryDisplay.workAreaSize.height;
    }
    if (winWidth > primaryDisplay.workAreaSize.width) {
        winWidth = primaryDisplay.workAreaSize.width;
    }
    let winX = waveWindow.pos.x;
    let winY = waveWindow.pos.y;
    if (winX + winWidth > primaryDisplay.workAreaSize.width) {
        winX = Math.floor((primaryDisplay.workAreaSize.width - winWidth) / 2);
    }
    if (winY + winHeight > primaryDisplay.workAreaSize.height) {
        winY = Math.floor((primaryDisplay.workAreaSize.height - winHeight) / 2);
    }
    const win = new electron.BrowserWindow({
        x: winX,
        y: winY,
        titleBarStyle: "hiddenInset",
        width: winWidth,
        height: winHeight,
        minWidth: 500,
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
    win.once("ready-to-show", () => {
        win.show();
    });
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

(async () => {
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
    try {
        await runWaveSrv();
    } catch (e) {
        console.log(e.toString());
    }
    const ready = await waveSrvReady;
    console.log("wavesrv ready signal received", ready, Date.now() - startTs, "ms");

    console.log("get client data");
    let clientData = (await services.ClientService.GetClientData().catch((e) => console.log(e))) as Client;
    console.log("client data ready");
    let windowData: WaveWindow = (await services.ObjectService.GetObject(
        "window:" + clientData.mainwindowid
    )) as WaveWindow;
    await electronApp.whenReady();
    createWindow(clientData, windowData);

    electronApp.on("activate", () => {
        if (electron.BrowserWindow.getAllWindows().length === 0) {
            createWindow(clientData, windowData);
        }
    });
})();
