// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import * as electron from "electron";
import { globalEvents } from "emain/emain-events";
import { FastAverageColor } from "fast-average-color";
import fs from "fs";
import * as child_process from "node:child_process";
import * as path from "path";
import { PNG } from "pngjs";
import { sprintf } from "sprintf-js";
import { Readable } from "stream";
import * as services from "../frontend/app/store/services";
import { initElectronWshrpc, shutdownWshrpc } from "../frontend/app/store/wshrpcutil";
import { getWebServerEndpoint } from "../frontend/util/endpoints";
import * as keyutil from "../frontend/util/keyutil";
import { fireAndForget, sleep } from "../frontend/util/util";
import { AuthKey, configureAuthKeyRequestInjection } from "./authkey";
import { initDocsite } from "./docsite";
import {
    getActivityState,
    getForceQuit,
    getGlobalIsRelaunching,
    setForceQuit,
    setGlobalIsQuitting,
    setGlobalIsStarting,
    setWasActive,
    setWasInFg,
} from "./emain-activity";
import { ensureHotSpareTab, getWaveTabViewByWebContentsId, setMaxTabCacheSize } from "./emain-tabview";
import { handleCtrlShiftState } from "./emain-util";
import { getIsWaveSrvDead, getWaveSrvProc, getWaveSrvReady, getWaveVersion, runWaveSrv } from "./emain-wavesrv";
import {
    createBrowserWindow,
    createNewWaveWindow,
    focusedWaveWindow,
    getAllWaveWindows,
    getWaveWindowById,
    getWaveWindowByWebContentsId,
    getWaveWindowByWorkspaceId,
    registerGlobalHotkey,
    relaunchBrowserWindows,
    WaveBrowserWindow,
} from "./emain-window";
import { ElectronWshClient, initElectronWshClient } from "./emain-wsh";
import { getLaunchSettings } from "./launchsettings";
import { log } from "./log";
import { makeAppMenu, makeDockTaskbar } from "./menu";
import {
    callWithOriginalXdgCurrentDesktopAsync,
    checkIfRunningUnderARM64Translation,
    getElectronAppBasePath,
    getElectronAppUnpackedBasePath,
    getWaveConfigDir,
    getWaveDataDir,
    isDev,
    unameArch,
    unamePlatform,
} from "./platform";
import { configureAutoUpdater, updater } from "./updater";

const electronApp = electron.app;

const waveDataDir = getWaveDataDir();
const waveConfigDir = getWaveConfigDir();

electron.nativeTheme.themeSource = "dark";

let webviewFocusId: number = null; // set to the getWebContentsId of the webview that has focus (null if not focused)
let webviewKeys: string[] = []; // the keys to trap when webview has focus

console.log = log;
console.log(
    sprintf(
        "waveterm-app starting, data_dir=%s, config_dir=%s electronpath=%s gopath=%s arch=%s/%s electron=%s",
        waveDataDir,
        waveConfigDir,
        getElectronAppBasePath(),
        getElectronAppUnpackedBasePath(),
        unamePlatform,
        unameArch,
        process.versions.electron
    )
);
if (isDev) {
    console.log("waveterm-app WAVETERM_DEV set");
}

function handleWSEvent(evtMsg: WSEventType) {
    fireAndForget(async () => {
        console.log("handleWSEvent", evtMsg?.eventtype);
        if (evtMsg.eventtype == "electron:newwindow") {
            console.log("electron:newwindow", evtMsg.data);
            const windowId: string = evtMsg.data;
            const windowData: WaveWindow = (await services.ObjectService.GetObject("window:" + windowId)) as WaveWindow;
            if (windowData == null) {
                return;
            }
            const fullConfig = await RpcApi.GetFullConfigCommand(ElectronWshClient);
            const newWin = await createBrowserWindow(windowData, fullConfig, { unamePlatform });
            newWin.show();
        } else if (evtMsg.eventtype == "electron:closewindow") {
            console.log("electron:closewindow", evtMsg.data);
            if (evtMsg.data === undefined) return;
            const ww = getWaveWindowById(evtMsg.data);
            if (ww != null) {
                ww.destroy(); // bypass the "are you sure?" dialog
            }
        } else if (evtMsg.eventtype == "electron:updateactivetab") {
            const activeTabUpdate: { workspaceid: string; newactivetabid: string } = evtMsg.data;
            console.log("electron:updateactivetab", activeTabUpdate);
            const ww = getWaveWindowByWorkspaceId(activeTabUpdate.workspaceid);
            if (ww == null) {
                return;
            }
            await ww.setActiveTab(activeTabUpdate.newactivetabid, false);
        } else {
            console.log("unhandled electron ws eventtype", evtMsg.eventtype);
        }
    });
}

// Listen for the open-external event from the renderer process
electron.ipcMain.on("open-external", (event, url) => {
    if (url && typeof url === "string") {
        fireAndForget(() =>
            callWithOriginalXdgCurrentDesktopAsync(() =>
                electron.shell.openExternal(url).catch((err) => {
                    console.error(`Failed to open URL ${url}:`, err);
                })
            )
        );
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
    const baseName = encodeURIComponent(path.basename(payload.filePath));
    const streamingUrl =
        getWebServerEndpoint() + "/wave/stream-file/" + baseName + "?path=" + encodeURIComponent(payload.filePath);
    event.sender.downloadURL(streamingUrl);
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

electron.ipcMain.handle("capture-screenshot", async (event, rect) => {
    const tabView = getWaveTabViewByWebContentsId(event.sender.id);
    if (!tabView) {
        throw new Error("No tab view found for the given webContents id");
    }
    const image = await tabView.webContents.capturePage(rect);
    const base64String = image.toPNG().toString("base64");
    return `data:image/png;base64,${base64String}`;
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

electron.ipcMain.on("set-keyboard-chord-mode", (event) => {
    event.returnValue = null;
    const tabView = getWaveTabViewByWebContentsId(event.sender.id);
    tabView?.setKeyboardChordMode(true);
});

if (unamePlatform !== "darwin") {
    const fac = new FastAverageColor();

    electron.ipcMain.on("update-window-controls-overlay", async (event, rect: Dimensions) => {
        // Bail out if the user requests the native titlebar
        const fullConfig = await RpcApi.GetFullConfigCommand(ElectronWshClient);
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

electron.ipcMain.handle("clear-webview-storage", async (event, webContentsId: number) => {
    try {
        const wc = electron.webContents.fromId(webContentsId);
        if (wc && wc.session) {
            await wc.session.clearStorageData();
            console.log("Cleared cookies and storage for webContentsId:", webContentsId);
        }
    } catch (e) {
        console.error("Failed to clear cookies and storage:", e);
        throw e;
    }
});

electron.ipcMain.on("open-native-path", (event, filePath: string) => {
    console.log("open-native-path", filePath);
    filePath = filePath.replace("~", electronApp.getPath("home"));
    fireAndForget(() =>
        callWithOriginalXdgCurrentDesktopAsync(() =>
            electron.shell.openPath(filePath).then((excuse) => {
                if (excuse) console.error(`Failed to open ${filePath} in native application: ${excuse}`);
            })
        )
    );
});

electron.ipcMain.on("set-window-init-status", (event, status: "ready" | "wave-ready") => {
    const tabView = getWaveTabViewByWebContentsId(event.sender.id);
    if (tabView == null || tabView.initResolve == null) {
        return;
    }
    if (status === "ready") {
        tabView.initResolve();
        if (tabView.savedInitOpts) {
            // this handles the "reload" case.  we'll re-send the init opts to the frontend
            console.log("savedInitOpts calling wave-init", tabView.waveTabId);
            tabView.webContents.send("wave-init", tabView.savedInitOpts);
        }
    } else if (status === "wave-ready") {
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
    const ww = focusedWaveWindow;
    if (ww == null) {
        return;
    }
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

// we try to set the primary display as index [0]
function getActivityDisplays(): ActivityDisplayType[] {
    const displays = electron.screen.getAllDisplays();
    const primaryDisplay = electron.screen.getPrimaryDisplay();
    const rtn: ActivityDisplayType[] = [];
    for (const display of displays) {
        const adt = {
            width: display.size.width,
            height: display.size.height,
            dpr: display.scaleFactor,
            internal: display.internal,
        };
        if (display.id === primaryDisplay?.id) {
            rtn.unshift(adt);
        } else {
            rtn.push(adt);
        }
    }
    return rtn;
}

async function sendDisplaysTDataEvent() {
    const displays = getActivityDisplays();
    if (displays.length === 0) {
        return;
    }
    const props: TEventProps = {};
    props["display:count"] = displays.length;
    props["display:height"] = displays[0].height;
    props["display:width"] = displays[0].width;
    props["display:dpr"] = displays[0].dpr;
    props["display:all"] = displays;
    try {
        await RpcApi.RecordTEventCommand(
            ElectronWshClient,
            {
                event: "app:display",
                props,
            },
            { noresponse: true }
        );
    } catch (e) {
        console.log("error sending display tdata event", e);
    }
}

function logActiveState() {
    fireAndForget(async () => {
        const astate = getActivityState();
        const activity: ActivityUpdate = { openminutes: 1 };
        if (astate.wasInFg) {
            activity.fgminutes = 1;
        }
        if (astate.wasActive) {
            activity.activeminutes = 1;
        }
        activity.displays = getActivityDisplays();
        try {
            await RpcApi.ActivityCommand(ElectronWshClient, activity, { noresponse: true });
            await RpcApi.RecordTEventCommand(
                ElectronWshClient,
                {
                    event: "app:activity",
                    props: {
                        "activity:activeminutes": activity.activeminutes,
                        "activity:fgminutes": activity.fgminutes,
                        "activity:openminutes": activity.openminutes,
                    },
                },
                { noresponse: true }
            );
        } catch (e) {
            console.log("error logging active state", e);
        } finally {
            // for next iteration
            const ww = focusedWaveWindow;
            setWasInFg(ww?.isFocused() ?? false);
            setWasActive(false);
        }
    });
}

// this isn't perfect, but gets the job done without being complicated
function runActiveTimer() {
    logActiveState();
    setTimeout(runActiveTimer, 60000);
}

function hideWindowWithCatch(window: WaveBrowserWindow) {
    if (window == null) {
        return;
    }
    try {
        if (window.isDestroyed()) {
            return;
        }
        window.hide();
    } catch (e) {
        console.log("error hiding window", e);
    }
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
        hideWindowWithCatch(window);
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

    // Check if the error is related to QUIC protocol, if so, ignore (can happen with the updater)
    if (error?.message?.includes("net::ERR_QUIC_PROTOCOL_ERROR")) {
        console.log("Ignoring QUIC protocol error:", error.message);
        console.log("Stack Trace:", error.stack);
        return;
    }

    caughtException = true;
    console.log("Uncaught Exception, shutting down: ", error);
    console.log("Stack Trace:", error.stack);
    // Optionally, handle cleanup or exit the app
    electronApp.quit();
});

let lastWaveWindowCount = 0;
globalEvents.on("windows-updated", () => {
    const wwCount = getAllWaveWindows().length;
    if (wwCount == lastWaveWindowCount) {
        return;
    }
    lastWaveWindowCount = wwCount;
    console.log("windows-updated", wwCount);
    makeAppMenu();
});

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
    try {
        await runWaveSrv(handleWSEvent);
    } catch (e) {
        console.log(e.toString());
    }
    const ready = await getWaveSrvReady();
    console.log("wavesrv ready signal received", ready, Date.now() - startTs, "ms");
    await electronApp.whenReady();
    configureAuthKeyRequestInjection(electron.session.defaultSession);

    await sleep(10); // wait a bit for wavesrv to be ready
    try {
        initElectronWshClient();
        initElectronWshrpc(ElectronWshClient, { authKey: AuthKey });
    } catch (e) {
        console.log("error initializing wshrpc", e);
    }
    const fullConfig = await RpcApi.GetFullConfigCommand(ElectronWshClient);
    checkIfRunningUnderARM64Translation(fullConfig);
    ensureHotSpareTab(fullConfig);
    await relaunchBrowserWindows();
    await initDocsite();
    setTimeout(runActiveTimer, 5000); // start active timer, wait 5s just to be safe
    setTimeout(sendDisplaysTDataEvent, 5000);

    makeAppMenu();
    makeDockTaskbar();
    await configureAutoUpdater();
    setGlobalIsStarting(false);
    if (fullConfig?.settings?.["window:maxtabcachesize"] != null) {
        setMaxTabCacheSize(fullConfig.settings["window:maxtabcachesize"]);
    }

    electronApp.on("activate", () => {
        const allWindows = getAllWaveWindows();
        if (allWindows.length === 0) {
            fireAndForget(createNewWaveWindow);
        }
    });
    const rawGlobalHotKey = launchSettings?.["app:globalhotkey"];
    if (rawGlobalHotKey) {
        registerGlobalHotkey(rawGlobalHotKey);
    }
}

appMain().catch((e) => {
    console.log("appMain error", e);
    electronApp.quit();
});
