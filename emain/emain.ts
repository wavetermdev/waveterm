// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as electron from "electron";
import * as child_process from "node:child_process";
import * as path from "path";
import { debounce } from "throttle-debounce";
import * as services from "../frontend/app/store/services";

const electronApp = electron.app;
const isDev = true;

const WaveAppPathVarName = "WAVETERM_APP_PATH";
const WaveDevVarName = "WAVETERM_DEV";
const WaveSrvReadySignalPidVarName = "WAVETERM_READY_SIGNAL_PID";
const AuthKeyFile = "waveterm.authkey";
const DevServerEndpoint = "http://127.0.0.1:8190";
const ProdServerEndpoint = "http://127.0.0.1:1719";
const DistDir = "dist-dev";

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
    return path.join(process.env.HOME, ".w2");
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

function getWaveSrvCmd(): string {
    const waveSrvPath = getWaveSrvPath();
    const waveHome = getWaveHomeDir();
    const logFile = path.join(waveHome, "wavesrv.log");
    return `"${waveSrvPath}" >> "${logFile}" 2>&1`;
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
    const waveSrvCmd = getWaveSrvCmd();
    console.log("trying to run local server", waveSrvCmd);
    const proc = child_process.execFile("bash", ["-c", waveSrvCmd], {
        cwd: getWaveSrvCwd(),
        env: envCopy,
    });
    proc.on("exit", (e) => {
        console.log("wavesrv exited, shutting down");
        electronApp.quit();
    });
    proc.on("spawn", (e) => {
        console.log("spawnned wavesrv");
        waveSrvProc = proc;
        pResolve(true);
    });
    proc.on("error", (e) => {
        console.log("error running wavesrv", e);
        pReject(e);
    });
    proc.stdout.on("data", (_) => {
        return;
    });
    proc.stderr.on("data", (_) => {
        return;
    });
    return rtnPromise;
}

function mainResizeHandler(_: any, win: Electron.BrowserWindow) {
    if (win == null || win.isDestroyed() || win.fullScreen) {
        return;
    }
    const bounds = win.getBounds();
    const winSize = { width: bounds.width, height: bounds.height, top: bounds.y, left: bounds.x };
    const url = new URL(getBaseHostPort() + "/api/set-winsize");
    // TODO
}

function shNavHandler(event: Electron.Event<Electron.WebContentsWillNavigateEventParams>, url: string) {
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
    if (event.frame.name == "pdfview" && url.startsWith("blob:file:///")) {
        // allowed
        return;
    }
    event.preventDefault();
    console.log("frame navigation canceled");
}

function createWindow(client: Client, waveWindow: WaveWindow): Electron.BrowserWindow {
    const win = new electron.BrowserWindow({
        x: 200,
        y: 200,
        titleBarStyle: "hiddenInset",
        width: waveWindow.winsize.width,
        height: waveWindow.winsize.height,
        minWidth: 500,
        minHeight: 300,
        icon:
            unamePlatform == "linux"
                ? path.join(getElectronAppBasePath(), "public/logos/wave-logo-dark.png")
                : undefined,
        webPreferences: {
            preload: path.join(getElectronAppBasePath(), DistDir, "preload.js"),
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
    win.loadFile(path.join(getElectronAppBasePath(), "public", indexHtml), { search: usp.toString() });
    win.webContents.on("will-navigate", shNavHandler);
    win.webContents.on("will-frame-navigate", shFrameNavHandler);
    win.on(
        "resize",
        debounce(400, (e) => mainResizeHandler(e, win))
    );
    win.on(
        "move",
        debounce(400, (e) => mainResizeHandler(e, win))
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

process.on("SIGUSR1", function () {
    waveSrvReadyResolve(true);
});

(async () => {
    const startTs = Date.now();
    const instanceLock = electronApp.requestSingleInstanceLock();
    if (!instanceLock) {
        console.log("waveterm-app could not get single-instance-lock, shutting down");
        electronApp.quit();
        return;
    }
    try {
        await runWaveSrv();
    } catch (e) {
        console.log(e.toString());
    }
    console.log("waiting for wavesrv ready signal (SIGUSR1)");
    const ready = await waveSrvReady;
    console.log("wavesrv ready signal received", ready, Date.now() - startTs, "ms");

    let clientData = await services.ClientService.GetClientData();
    let windowData: WaveWindow = (await services.ObjectService.GetObject(
        "window:" + clientData.mainwindowid
    )) as WaveWindow;
    await electronApp.whenReady();
    await createWindow(clientData, windowData);

    electronApp.on("activate", () => {
        if (electron.BrowserWindow.getAllWindows().length === 0) {
            createWindow(clientData, windowData);
        }
    });
})();
