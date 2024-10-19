// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as electron from "electron";
import {
    getActivityState,
    getForceQuit,
    getGlobalIsRelaunching,
    setForceQuit,
    setGlobalIsQuitting,
    setGlobalIsRelaunching,
    setGlobalIsStarting,
    setWasActive,
    setWasInFg,
} from "emain/emain-activity";
import { handleCtrlShiftState } from "emain/emain-util";
import {
    createBrowserWindow,
    ensureHotSpareTab,
    getAllWaveWindows,
    getFocusedWaveWindow,
    getLastFocusedWaveWindow,
    getWaveTabViewByWebContentsId,
    getWaveWindowById,
    getWaveWindowByWebContentsId,
    setActiveTab,
    setMaxTabCacheSize,
} from "emain/emain-viewmgr";
import { getIsWaveSrvDead, getWaveSrvProc, getWaveSrvReady, getWaveVersion, runWaveSrv } from "emain/emain-wavesrv";
import { FastAverageColor } from "fast-average-color";
import fs from "fs";
import * as child_process from "node:child_process";
import * as path from "path";
import { PNG } from "pngjs";
import { sprintf } from "sprintf-js";
import { Readable } from "stream";
import * as util from "util";
import winston from "winston";
import * as services from "../frontend/app/store/services";
import { initElectronWshrpc, shutdownWshrpc } from "../frontend/app/store/wshrpcutil";
import { getWebServerEndpoint } from "../frontend/util/endpoints";
import { fetch } from "../frontend/util/fetchutil";
import * as keyutil from "../frontend/util/keyutil";
import { fireAndForget } from "../frontend/util/util";
import { AuthKey, configureAuthKeyRequestInjection } from "./authkey";
import { initDocsite } from "./docsite";
import { ElectronWshClient, initElectronWshClient } from "./emain-wsh";
import { getLaunchSettings } from "./launchsettings";
import { getAppMenu } from "./menu";
import {
    getElectronAppBasePath,
    getElectronAppUnpackedBasePath,
    getWaveHomeDir,
    isDev,
    unameArch,
    unamePlatform,
} from "./platform";
import { configureAutoUpdater, updater } from "./updater";

const electronApp = electron.app;

electron.nativeTheme.themeSource = "dark";

let webviewFocusId: number = null; // set to the getWebContentsId of the webview that has focus (null if not focused)
let webviewKeys: string[] = []; // the keys to trap when webview has focus
const waveHome = getWaveHomeDir();
const oldConsoleLog = console.log;

const loggerTransports: winston.transport[] = [
    new winston.transports.File({ filename: path.join(getWaveHomeDir(), "waveapp.log"), level: "info" }),
];
if (isDev) {
    loggerTransports.push(new winston.transports.Console());
}
const loggerConfig = {
    level: "info",
    format: winston.format.combine(
        winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
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
        getElectronAppUnpackedBasePath(),
        unamePlatform,
        unameArch
    )
);
if (isDev) {
    console.log("waveterm-app WAVETERM_DEV set");
}

async function handleWSEvent(evtMsg: WSEventType) {
    console.log("handleWSEvent", evtMsg?.eventtype);
    if (evtMsg.eventtype == "electron:newwindow") {
        const windowId: string = evtMsg.data;
        const windowData: WaveWindow = (await services.ObjectService.GetObject("window:" + windowId)) as WaveWindow;
        if (windowData == null) {
            return;
        }
        const clientData = await services.ClientService.GetClientData();
        const fullConfig = await services.FileService.GetFullConfig();
        const newWin = createBrowserWindow(clientData.oid, windowData, fullConfig, { unamePlatform });
        await newWin.waveReadyPromise;
        newWin.show();
    } else if (evtMsg.eventtype == "electron:closewindow") {
        if (evtMsg.data === undefined) return;
        const ww = getWaveWindowById(evtMsg.data);
        if (ww != null) {
            ww.alreadyClosed = true;
            ww.destroy(); // bypass the "are you sure?" dialog
        }
    } else {
        console.log("unhandled electron ws eventtype", evtMsg.eventtype);
    }
}

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

type UrlInSessionResult = {
    stream: Readable;
    mimeType: string;
    fileName: string;
};

function getSingleHeaderVal(headers: Record<string, string | string[]>, key: string): string {
    const val = headers[key];
    if (val == null) {
        return null;
    }
    if (Array.isArray(val)) {
        return val[0];
    }
    return val;
}

function cleanMimeType(mimeType: string): string {
    if (mimeType == null) {
        return null;
    }
    const parts = mimeType.split(";");
    return parts[0].trim();
}

function getFileNameFromUrl(url: string): string {
    try {
        const pathname = new URL(url).pathname;
        const filename = pathname.substring(pathname.lastIndexOf("/") + 1);
        return filename;
    } catch (e) {
        return null;
    }
}

function getUrlInSession(session: Electron.Session, url: string): Promise<UrlInSessionResult> {
    return new Promise((resolve, reject) => {
        // Handle data URLs directly
        if (url.startsWith("data:")) {
            const parts = url.split(",");
            if (parts.length < 2) {
                return reject(new Error("Invalid data URL"));
            }
            const header = parts[0]; // Get the data URL header (e.g., data:image/png;base64)
            const base64Data = parts[1]; // Get the base64 data part
            const mimeType = header.split(";")[0].slice(5); // Extract the MIME type (after "data:")
            const buffer = Buffer.from(base64Data, "base64");
            const readable = Readable.from(buffer);
            resolve({ stream: readable, mimeType, fileName: "image" });
            return;
        }
        const request = electron.net.request({
            url,
            method: "GET",
            session, // Attach the session directly to the request
        });
        const readable = new Readable({
            read() {}, // No-op, we'll push data manually
        });
        request.on("response", (response) => {
            const mimeType = cleanMimeType(getSingleHeaderVal(response.headers, "content-type"));
            const fileName = getFileNameFromUrl(url) || "image";
            response.on("data", (chunk) => {
                readable.push(chunk); // Push data to the readable stream
            });
            response.on("end", () => {
                readable.push(null); // Signal the end of the stream
                resolve({ stream: readable, mimeType, fileName });
            });
        });
        request.on("error", (err) => {
            readable.destroy(err); // Destroy the stream on error
            reject(err);
        });
        request.end();
    });
}

electron.ipcMain.on("webview-image-contextmenu", (event: electron.IpcMainEvent, payload: { src: string }) => {
    const menu = new electron.Menu();
    const win = getWaveWindowByWebContentsId(event.sender.hostWebContents.id);
    if (win == null) {
        return;
    }
    menu.append(
        new electron.MenuItem({
            label: "Save Image",
            click: () => {
                const resultP = getUrlInSession(event.sender.session, payload.src);
                resultP
                    .then((result) => {
                        saveImageFileWithNativeDialog(result.fileName, result.mimeType, result.stream);
                    })
                    .catch((e) => {
                        console.log("error getting image", e);
                    });
            },
        })
    );
    const { x, y } = electron.screen.getCursorScreenPoint();
    const windowPos = win.getPosition();
    menu.popup();
});

electron.ipcMain.on("download", (event, payload) => {
    const streamingUrl = getWebServerEndpoint() + "/wave/stream-file?path=" + encodeURIComponent(payload.filePath);
    event.sender.downloadURL(streamingUrl);
});

electron.ipcMain.on("set-active-tab", async (event, tabId) => {
    const ww = getWaveWindowByWebContentsId(event.sender.id);
    console.log("set-active-tab", tabId, ww?.waveWindowId);
    await setActiveTab(ww, tabId);
});

electron.ipcMain.on("create-tab", async (event, opts) => {
    const senderWc = event.sender;
    const tabView = getWaveTabViewByWebContentsId(senderWc.id);
    if (tabView == null) {
        return;
    }
    const waveWindowId = tabView.waveWindowId;
    const waveWindow = (await services.ObjectService.GetObject("window:" + waveWindowId)) as WaveWindow;
    if (waveWindow == null) {
        return;
    }
    const newTabId = await services.ObjectService.AddTabToWorkspace(waveWindowId, null, true);
    const ww = getWaveWindowById(waveWindowId);
    if (ww == null) {
        return;
    }
    await setActiveTab(ww, newTabId);
    event.returnValue = true;
    return null;
});

electron.ipcMain.on("close-tab", async (event, tabId) => {
    const tabView = getWaveTabViewByWebContentsId(event.sender.id);
    if (tabView == null) {
        return;
    }
    const rtn = await services.WindowService.CloseTab(tabView.waveWindowId, tabId, true);
    if (rtn?.closewindow) {
        const ww = getWaveWindowById(tabView.waveWindowId);
        ww.alreadyClosed = true;
        ww?.destroy(); // bypass the "are you sure?" dialog
    } else if (rtn?.newactivetabid) {
        setActiveTab(getWaveWindowById(tabView.waveWindowId), rtn.newactivetabid);
    }
    event.returnValue = true;
    return null;
});

electron.ipcMain.on("get-cursor-point", (event) => {
    const tabView = getWaveTabViewByWebContentsId(event.sender.id);
    if (tabView == null) {
        event.returnValue = null;
        return;
    }
    const screenPoint = electron.screen.getCursorScreenPoint();
    const windowRect = tabView.getBounds();
    const retVal: Electron.Point = {
        x: screenPoint.x - windowRect.x,
        y: screenPoint.y - windowRect.y,
    };
    event.returnValue = retVal;
});

electron.ipcMain.on("get-env", (event, varName) => {
    event.returnValue = process.env[varName] ?? null;
});

electron.ipcMain.on("get-about-modal-details", (event) => {
    event.returnValue = getWaveVersion() as AboutModalDetails;
});

const hasBeforeInputRegisteredMap = new Map<number, boolean>();

electron.ipcMain.on("webview-focus", (event: Electron.IpcMainEvent, focusedId: number) => {
    webviewFocusId = focusedId;
    console.log("webview-focus", focusedId);
    if (focusedId == null) {
        return;
    }
    const parentWc = event.sender;
    const webviewWc = electron.webContents.fromId(focusedId);
    if (webviewWc == null) {
        webviewFocusId = null;
        return;
    }
    if (!hasBeforeInputRegisteredMap.get(focusedId)) {
        hasBeforeInputRegisteredMap.set(focusedId, true);
        webviewWc.on("before-input-event", (e, input) => {
            let waveEvent = keyutil.adaptFromElectronKeyEvent(input);
            // console.log(`WEB ${focusedId}`, waveEvent.type, waveEvent.code);
            handleCtrlShiftState(parentWc, waveEvent);
            if (webviewFocusId != focusedId) {
                return;
            }
            if (input.type != "keyDown") {
                return;
            }
            for (let keyDesc of webviewKeys) {
                if (keyutil.checkKeyPressed(waveEvent, keyDesc)) {
                    e.preventDefault();
                    parentWc.send("reinject-key", waveEvent);
                    console.log("webview reinject-key", keyDesc);
                    return;
                }
            }
        });
        webviewWc.on("destroyed", () => {
            hasBeforeInputRegisteredMap.delete(focusedId);
        });
    }
});

electron.ipcMain.on("register-global-webview-keys", (event, keys: string[]) => {
    webviewKeys = keys ?? [];
});

if (unamePlatform !== "darwin") {
    const fac = new FastAverageColor();

    electron.ipcMain.on("update-window-controls-overlay", async (event, rect: Dimensions) => {
        // Bail out if the user requests the native titlebar
        const fullConfig = await services.FileService.GetFullConfig();
        if (fullConfig.settings["window:nativetitlebar"]) return;

        const zoomFactor = event.sender.getZoomFactor();
        const electronRect: Electron.Rectangle = {
            x: rect.left * zoomFactor,
            y: rect.top * zoomFactor,
            height: rect.height * zoomFactor,
            width: rect.width * zoomFactor,
        };
        const overlay = await event.sender.capturePage(electronRect);
        const overlayBuffer = overlay.toPNG();
        const png = PNG.sync.read(overlayBuffer);
        const color = fac.prepareResult(fac.getColorFromArray4(png.data));
        const ww = getWaveWindowByWebContentsId(event.sender.id);
        ww.setTitleBarOverlay({
            color: unamePlatform === "linux" ? color.rgba : "#00000000", // Windows supports a true transparent overlay, so we don't need to set a background color.
            symbolColor: color.isDark ? "white" : "black",
        });
    });
}

electron.ipcMain.on("quicklook", (event, filePath: string) => {
    if (unamePlatform == "darwin") {
        child_process.execFile("/usr/bin/qlmanage", ["-p", filePath], (error, stdout, stderr) => {
            if (error) {
                console.error(`Error opening Quick Look: ${error}`);
                return;
            }
        });
    }
});

async function createNewWaveWindow(): Promise<void> {
    const clientData = await services.ClientService.GetClientData();
    const fullConfig = await services.FileService.GetFullConfig();
    let recreatedWindow = false;
    const allWindows = getAllWaveWindows();
    if (allWindows.length === 0 && clientData?.windowids?.length >= 1) {
        // reopen the first window
        const existingWindowId = clientData.windowids[0];
        const existingWindowData = (await services.ObjectService.GetObject("window:" + existingWindowId)) as WaveWindow;
        if (existingWindowData != null) {
            const win = createBrowserWindow(clientData.oid, existingWindowData, fullConfig, { unamePlatform });
            await win.waveReadyPromise;
            win.show();
            recreatedWindow = true;
        }
    }
    if (recreatedWindow) {
        return;
    }
    const newWindow = await services.ClientService.MakeWindow();
    const newBrowserWindow = createBrowserWindow(clientData.oid, newWindow, fullConfig, { unamePlatform });
    await newBrowserWindow.waveReadyPromise;
    newBrowserWindow.show();
}

electron.ipcMain.on("set-window-init-status", (event, status: "ready" | "wave-ready") => {
    const tabView = getWaveTabViewByWebContentsId(event.sender.id);
    if (tabView == null || tabView.initResolve == null) {
        return;
    }
    if (status === "ready") {
        console.log("initResolve");
        tabView.initResolve();
        if (tabView.savedInitOpts) {
            tabView.webContents.send("wave-init", tabView.savedInitOpts);
        }
    } else if (status === "wave-ready") {
        console.log("waveReadyResolve");
        tabView.waveReadyResolve();
    }
});

electron.ipcMain.on("fe-log", (event, logStr: string) => {
    console.log("fe-log", logStr);
});

function saveImageFileWithNativeDialog(defaultFileName: string, mimeType: string, readStream: Readable) {
    if (defaultFileName == null || defaultFileName == "") {
        defaultFileName = "image";
    }
    const ww = getFocusedWaveWindow();
    const mimeToExtension: { [key: string]: string } = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/gif": "gif",
        "image/webp": "webp",
        "image/bmp": "bmp",
        "image/tiff": "tiff",
        "image/heic": "heic",
    };
    function addExtensionIfNeeded(fileName: string, mimeType: string): string {
        const extension = mimeToExtension[mimeType];
        if (!path.extname(fileName) && extension) {
            return `${fileName}.${extension}`;
        }
        return fileName;
    }
    defaultFileName = addExtensionIfNeeded(defaultFileName, mimeType);
    electron.dialog
        .showSaveDialog(ww, {
            title: "Save Image",
            defaultPath: defaultFileName,
            filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff", "heic"] }],
        })
        .then((file) => {
            if (file.canceled) {
                return;
            }
            const writeStream = fs.createWriteStream(file.filePath);
            readStream.pipe(writeStream);
            writeStream.on("finish", () => {
                console.log("saved file", file.filePath);
            });
            writeStream.on("error", (err) => {
                console.log("error saving file (writeStream)", err);
                readStream.destroy();
            });
            readStream.on("error", (err) => {
                console.error("error saving file (readStream)", err);
                writeStream.destroy(); // Stop the write stream
            });
        })
        .catch((err) => {
            console.log("error trying to save file", err);
        });
}

electron.ipcMain.on("open-new-window", () => fireAndForget(createNewWaveWindow));

electron.ipcMain.on("contextmenu-show", (event, menuDefArr?: ElectronContextMenuItem[]) => {
    if (menuDefArr?.length === 0) {
        return;
    }
    const menu = menuDefArr ? convertMenuDefArrToMenu(menuDefArr) : instantiateAppMenu();
    // const { x, y } = electron.screen.getCursorScreenPoint();
    // const windowPos = window.getPosition();
    menu.popup();
    event.returnValue = true;
});

async function logActiveState() {
    const astate = getActivityState();
    const activeState = { fg: astate.wasInFg, active: astate.wasActive, open: true };
    const url = new URL(getWebServerEndpoint() + "/wave/log-active-state");
    try {
        const resp = await fetch(url, { method: "post", body: JSON.stringify(activeState) });
        if (!resp.ok) {
            console.log("error logging active state", resp.status, resp.statusText);
            return;
        }
    } catch (e) {
        console.log("error logging active state", e);
    } finally {
        // for next iteration
        const ww = getFocusedWaveWindow();
        setWasInFg(ww?.isFocused() ?? false);
        setWasActive(false);
    }
}

// this isn't perfect, but gets the job done without being complicated
function runActiveTimer() {
    logActiveState();
    setTimeout(runActiveTimer, 60000);
}

function convertMenuDefArrToMenu(menuDefArr: ElectronContextMenuItem[]): electron.Menu {
    const menuItems: electron.MenuItem[] = [];
    for (const menuDef of menuDefArr) {
        const menuItemTemplate: electron.MenuItemConstructorOptions = {
            role: menuDef.role as any,
            label: menuDef.label,
            type: menuDef.type,
            click: (_, window) => {
                const ww = window as WaveBrowserWindow;
                const tabView = ww.activeTabView;
                tabView?.webContents?.send("contextmenu-click", menuDef.id);
            },
            checked: menuDef.checked,
        };
        if (menuDef.submenu != null) {
            menuItemTemplate.submenu = convertMenuDefArrToMenu(menuDef.submenu);
        }
        const menuItem = new electron.MenuItem(menuItemTemplate);
        menuItems.push(menuItem);
    }
    return electron.Menu.buildFromTemplate(menuItems);
}

function instantiateAppMenu(): electron.Menu {
    return getAppMenu({
        createNewWaveWindow,
        relaunchBrowserWindows,
        getLastFocusedWaveWindow: getLastFocusedWaveWindow,
    });
}

function makeAppMenu() {
    const menu = instantiateAppMenu();
    electron.Menu.setApplicationMenu(menu);
}

electronApp.on("window-all-closed", () => {
    if (getGlobalIsRelaunching()) {
        return;
    }
    if (unamePlatform !== "darwin") {
        electronApp.quit();
    }
});
electronApp.on("before-quit", (e) => {
    setGlobalIsQuitting(true);
    updater?.stop();
    if (unamePlatform == "win32") {
        // win32 doesn't have a SIGINT, so we just let electron die, which
        // ends up killing wavesrv via closing it's stdin.
        return;
    }
    getWaveSrvProc()?.kill("SIGINT");
    shutdownWshrpc();
    if (getForceQuit()) {
        return;
    }
    e.preventDefault();
    const allWindows = getAllWaveWindows();
    for (const window of allWindows) {
        window.hide();
    }
    if (getIsWaveSrvDead()) {
        console.log("wavesrv is dead, quitting immediately");
        setForceQuit(true);
        electronApp.quit();
        return;
    }
    setTimeout(() => {
        console.log("waiting for wavesrv to exit...");
        setForceQuit(true);
        electronApp.quit();
    }, 3000);
});
process.on("SIGINT", () => {
    console.log("Caught SIGINT, shutting down");
    electronApp.quit();
});
process.on("SIGHUP", () => {
    console.log("Caught SIGHUP, shutting down");
    electronApp.quit();
});
process.on("SIGTERM", () => {
    console.log("Caught SIGTERM, shutting down");
    electronApp.quit();
});
let caughtException = false;
process.on("uncaughtException", (error) => {
    if (caughtException) {
        return;
    }
    caughtException = true;
    console.log("Uncaught Exception, shutting down: ", error);
    console.log("Stack Trace:", error.stack);
    // Optionally, handle cleanup or exit the app
    electronApp.quit();
});

async function relaunchBrowserWindows(): Promise<void> {
    setGlobalIsRelaunching(true);
    const windows = getAllWaveWindows();
    for (const window of windows) {
        window.removeAllListeners();
        window.close();
    }
    setGlobalIsRelaunching(false);

    const clientData = await services.ClientService.GetClientData();
    const fullConfig = await services.FileService.GetFullConfig();
    const wins: WaveBrowserWindow[] = [];
    for (const windowId of clientData.windowids.slice().reverse()) {
        const windowData: WaveWindow = (await services.ObjectService.GetObject("window:" + windowId)) as WaveWindow;
        if (windowData == null) {
            services.WindowService.CloseWindow(windowId, true).catch((e) => {
                /* ignore */
            });
            continue;
        }
        const win = createBrowserWindow(clientData.oid, windowData, fullConfig, { unamePlatform });
        wins.push(win);
    }
    for (const win of wins) {
        await win.waveReadyPromise;
        console.log("show window", win.waveWindowId);
        win.show();
    }
}

async function appMain() {
    // Set disableHardwareAcceleration as early as possible, if required.
    const launchSettings = getLaunchSettings();
    if (launchSettings?.["window:disablehardwareacceleration"]) {
        console.log("disabling hardware acceleration, per launch settings");
        electronApp.disableHardwareAcceleration();
    }
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
        await runWaveSrv(handleWSEvent);
    } catch (e) {
        console.log(e.toString());
    }
    const ready = await getWaveSrvReady();
    console.log("wavesrv ready signal received", ready, Date.now() - startTs, "ms");
    await electronApp.whenReady();
    configureAuthKeyRequestInjection(electron.session.defaultSession);
    const fullConfig = await services.FileService.GetFullConfig();
    ensureHotSpareTab(fullConfig);
    await relaunchBrowserWindows();
    await initDocsite();
    setTimeout(runActiveTimer, 5000); // start active timer, wait 5s just to be safe
    try {
        initElectronWshClient();
        initElectronWshrpc(ElectronWshClient, { authKey: AuthKey });
    } catch (e) {
        console.log("error initializing wshrpc", e);
    }
    await configureAutoUpdater();

    setGlobalIsStarting(false);
    if (fullConfig?.settings?.["window:maxtabcachesize"] != null) {
        setMaxTabCacheSize(fullConfig.settings["window:maxtabcachesize"]);
    }

    electronApp.on("activate", async () => {
        const allWindows = getAllWaveWindows();
        if (allWindows.length === 0) {
            await createNewWaveWindow();
        }
    });
}

appMain().catch((e) => {
    console.log("appMain error", e);
    electronApp.quit();
});
