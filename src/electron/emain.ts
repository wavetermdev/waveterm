// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as electron from "electron";
import * as path from "path";
import * as fs from "fs";
import fetch from "node-fetch";
import * as child_process from "node:child_process";
import { debounce } from "throttle-debounce";
import * as winston from "winston";
import * as util from "util";
import * as waveutil from "../util/util";
import { sprintf } from "sprintf-js";
import { handleJsonFetchResponse } from "@/util/util";
import { v4 as uuidv4 } from "uuid";
import { checkKeyPressed, adaptFromElectronKeyEvent, setKeyUtilPlatform } from "@/util/keyutil";
import { platform } from "os";

const WaveAppPathVarName = "WAVETERM_APP_PATH";
const WaveDevVarName = "WAVETERM_DEV";
const AuthKeyFile = "waveterm.authkey";
const DevServerEndpoint = "http://127.0.0.1:8090";
const ProdServerEndpoint = "http://127.0.0.1:1619";

let isDev = process.env[WaveDevVarName] != null;
let waveHome = getWaveHomeDir();
let DistDir = isDev ? "dist-dev" : "dist";
let GlobalAuthKey = "";
let instanceId = uuidv4();
let oldConsoleLog = console.log;
let wasActive = true;
let wasInFg = true;
let currentGlobalShortcut: string | null = null;
let initialClientData: ClientDataType = null;
let autoUpdateInterval: NodeJS.Timeout | null = null;
let availableUpdateReleaseName: string | null = null;
let availableUpdateReleaseNotes: string | null = null;

checkPromptMigrate();
ensureDir(waveHome);

// these are either "darwin/amd64" or "darwin/arm64"
// normalize darwin/x64 to darwin/amd64 for GOARCH compatibility
let unamePlatform = process.platform;
let unameArch: string = process.arch;
if (unameArch == "x64") {
    unameArch = "amd64";
}
let loggerTransports: winston.transport[] = [
    new winston.transports.File({ filename: path.join(waveHome, "waveterm-app.log"), level: "info" }),
];
if (isDev) {
    loggerTransports.push(new winston.transports.Console());
}
let loggerConfig = {
    level: "info",
    format: winston.format.combine(
        winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        winston.format.printf((info) => `${info.timestamp} ${info.message}`)
    ),
    transports: loggerTransports,
};
let logger = winston.createLogger(loggerConfig);
function log(...msg) {
    try {
        logger.info(util.format(...msg));
    } catch (e) {
        oldConsoleLog(...msg);
    }
}
console.log = log;
console.log(
    sprintf(
        "waveterm-app starting, WAVETERM_HOME=%s, apppath=%s arch=%s/%s",
        waveHome,
        getAppBasePath(),
        unamePlatform,
        unameArch
    )
);
if (isDev) {
    console.log("waveterm-app WAVETERM_DEV set");
}
let app = electron.app;
app.setName(isDev ? "Wave (Dev)" : "Wave");
let waveSrvProc: child_process.ChildProcessWithoutNullStreams | null = null;
let waveSrvShouldRestart = false;

electron.dialog.showErrorBox = (title, content) => {
    oldConsoleLog("ERROR", title, content);
};

// must match golang
function getWaveHomeDir() {
    let waveHome = process.env.WAVETERM_HOME;
    if (waveHome == null) {
        let homeDir = process.env.HOME;
        if (homeDir == null) {
            homeDir = "/";
        }
        waveHome = path.join(homeDir, isDev ? ".waveterm-dev" : ".waveterm");
    }
    return waveHome;
}

function checkPromptMigrate() {
    let waveHome = getWaveHomeDir();
    if (isDev || fs.existsSync(waveHome)) {
        // don't migrate if we're running dev version or if wave home directory already exists
        return;
    }
    if (process.env.HOME == null) {
        return;
    }
    let homeDir: string = process.env.HOME;
    let promptHome: string = path.join(homeDir, "prompt");
    if (!fs.existsSync(promptHome) || !fs.existsSync(path.join(promptHome, "prompt.db"))) {
        // make sure we have a valid prompt home directory (prompt.db must exist inside)
        return;
    }
    // rename directory, and then rename db and authkey files
    fs.renameSync(promptHome, waveHome);
    fs.renameSync(path.join(waveHome, "prompt.db"), path.join(waveHome, "waveterm.db"));
    if (fs.existsSync(path.join(waveHome, "prompt.db-wal"))) {
        fs.renameSync(path.join(waveHome, "prompt.db-wal"), path.join(waveHome, "waveterm.db-wal"));
    }
    if (fs.existsSync(path.join(waveHome, "prompt.db-shm"))) {
        fs.renameSync(path.join(waveHome, "prompt.db-shm"), path.join(waveHome, "waveterm.db-shm"));
    }
    if (fs.existsSync(path.join(waveHome, "prompt.authkey"))) {
        fs.renameSync(path.join(waveHome, "prompt.authkey"), path.join(waveHome, "waveterm.authkey"));
    }
}

// for dev, this is just the waveterm directory
// for prod, this is .../Wave.app/Contents/Resources/app
function getAppBasePath() {
    return path.dirname(__dirname);
}

function getBaseHostPort() {
    if (isDev) {
        return DevServerEndpoint;
    }
    return ProdServerEndpoint;
}

function getWaveSrvPath() {
    return path.join(getAppBasePath(), "bin", "wavesrv");
}

function getWaveSrvCmd() {
    let waveSrvPath = getWaveSrvPath();
    let waveHome = getWaveHomeDir();
    let logFile = path.join(waveHome, "wavesrv.log");
    return `"${waveSrvPath}" >> "${logFile}" 2>&1`;
}

function getWaveSrvCwd() {
    let waveHome = getWaveHomeDir();
    return waveHome;
}

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function readAuthKey() {
    let homeDir = getWaveHomeDir();
    let authKeyFileName = path.join(homeDir, AuthKeyFile);
    if (!fs.existsSync(authKeyFileName)) {
        let authKeyStr = String(uuidv4());
        fs.writeFileSync(authKeyFileName, authKeyStr, { mode: 0o600 });
        return authKeyStr;
    }
    let authKeyData = fs.readFileSync(authKeyFileName);
    let authKeyStr = String(authKeyData);
    if (authKeyStr == null || authKeyStr == "") {
        throw new Error("cannot read authkey");
    }
    return authKeyStr.trim();
}
const reloadAcceleratorKey = unamePlatform == "darwin" ? "Option+R" : "Super+R";
let cmdOrAlt = process.platform === "darwin" ? "Cmd" : "Alt";
let menuTemplate: Electron.MenuItemConstructorOptions[] = [
    {
        role: "appMenu",
        submenu: [
            {
                label: "About Wave Terminal",
                click: () => {
                    MainWindow?.webContents.send("menu-item-about");
                },
            },
            { type: "separator" },
            { role: "services" },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { type: "separator" },
            { role: "quit" },
        ],
    },
    {
        role: "editMenu",
    },
    {
        role: "viewMenu",
        submenu: [
            { role: "reload", accelerator: reloadAcceleratorKey },
            { role: "toggleDevTools" },
            { type: "separator" },
            {
                label: "Actual Size",
                accelerator: cmdOrAlt + "+0",
                click: () => {
                    if (MainWindow == null) {
                        return;
                    }
                    MainWindow.webContents.setZoomFactor(1);
                    MainWindow.webContents.send("zoom-changed");
                },
            },
            {
                label: "Zoom In",
                accelerator: cmdOrAlt + "+Plus",
                click: () => {
                    if (MainWindow == null) {
                        return;
                    }
                    const zoomFactor = MainWindow.webContents.getZoomFactor();
                    MainWindow.webContents.setZoomFactor(zoomFactor * 1.1);
                    MainWindow.webContents.send("zoom-changed");
                },
            },
            {
                label: "Zoom Out",
                accelerator: cmdOrAlt + "+-",
                click: () => {
                    if (MainWindow == null) {
                        return;
                    }
                    const zoomFactor = MainWindow.webContents.getZoomFactor();
                    MainWindow.webContents.setZoomFactor(zoomFactor / 1.1);
                    MainWindow.webContents.send("zoom-changed");
                },
            },
            { type: "separator" },
            { role: "togglefullscreen" },
        ],
    },
    {
        role: "windowMenu",
    },
    {
        role: "help",
    },
];

let menu = electron.Menu.buildFromTemplate(menuTemplate);
electron.Menu.setApplicationMenu(menu);

let MainWindow: Electron.BrowserWindow | null = null;

function getMods(input: any) {
    return { meta: input.meta, shift: input.shift, ctrl: input.control, alt: input.alt };
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
    event.preventDefault();
    let url = event.url;
    console.log(`frame-navigation url=${url} frame=${event.frame.name}`);
    if (event.frame.name == "webview") {
        // "webview" links always open in new window
        // this will *not* effect the initial load because srcdoc does not count as an electron navigation
        console.log("open external, frameNav", url);
        electron.shell.openExternal(url);
        return;
    }
    console.log("frame navigation canceled");
}

function createMainWindow(clientData: ClientDataType | null) {
    let bounds = calcBounds(clientData);
    setKeyUtilPlatform(platform());
    let win = new electron.BrowserWindow({
        x: bounds.x,
        y: bounds.y,
        titleBarStyle: "hiddenInset",
        width: bounds.width,
        height: bounds.height,
        minWidth: 800,
        minHeight: 600,
        transparent: true,
        icon: unamePlatform == "linux" ? "public/logos/wave-logo-dark.png" : undefined,
        webPreferences: {
            preload: path.join(getAppBasePath(), DistDir, "preload.js"),
        },
    });
    let indexHtml = isDev ? "index-dev.html" : "index.html";
    win.loadFile(path.join(getAppBasePath(), "public", indexHtml));
    win.webContents.on("before-input-event", (e, input) => {
        let waveEvent = adaptFromElectronKeyEvent(input);
        if (win.isFocused()) {
            wasActive = true;
        }
        if (input.type != "keyDown") {
            return;
        }
        let mods = getMods(input);
        if (checkKeyPressed(waveEvent, "Cmd:t")) {
            win.webContents.send("t-cmd", mods);
            e.preventDefault();
            return;
        }
        if (checkKeyPressed(waveEvent, "Cmd:i")) {
            e.preventDefault();
            if (!input.alt) {
                win.webContents.send("i-cmd", mods);
            } else {
                win.webContents.toggleDevTools();
            }
            return;
        }
        if (checkKeyPressed(waveEvent, "Cmd:r")) {
            e.preventDefault();
            win.webContents.send("r-cmd", mods);
            return;
        }
        if (checkKeyPressed(waveEvent, "Cmd:l")) {
            win.webContents.send("l-cmd", mods);
            e.preventDefault();
            return;
        }
        if (checkKeyPressed(waveEvent, "Cmd:w")) {
            e.preventDefault();
            win.webContents.send("w-cmd", mods);
            return;
        }
        if (checkKeyPressed(waveEvent, "Cmd:h")) {
            win.webContents.send("h-cmd", mods);
            e.preventDefault();
            return;
        }
        if (checkKeyPressed(waveEvent, "Cmd:p")) {
            win.webContents.send("p-cmd", mods);
            e.preventDefault();
            return;
        }
        if (checkKeyPressed(waveEvent, "Cmd:ArrowUp") || checkKeyPressed(waveEvent, "Cmd:ArrowDown")) {
            if (checkKeyPressed(waveEvent, "Cmd:ArrowUp")) {
                win.webContents.send("meta-arrowup");
            } else {
                win.webContents.send("meta-arrowdown");
            }
            e.preventDefault();
            return;
        }
        if (checkKeyPressed(waveEvent, "Cmd:PageUp") || checkKeyPressed(waveEvent, "Cmd:PageDown")) {
            if (checkKeyPressed(waveEvent, "Cmd:PageUp")) {
                win.webContents.send("meta-pageup");
            } else {
                win.webContents.send("meta-pagedown");
            }
            e.preventDefault();
            return;
        }
        if (input.code.startsWith("Digit") && input.meta) {
            let digitNum = parseInt(input.code.substring(5));
            if (isNaN(digitNum) || digitNum < 1 || digitNum > 9) {
                return;
            }
            e.preventDefault();
            win.webContents.send("digit-cmd", { digit: digitNum }, mods);
        }
        if (checkKeyPressed(waveEvent, "Cmd:[") || checkKeyPressed(waveEvent, "Cmd:]")) {
            let rel = checkKeyPressed(waveEvent, "Cmd:]") ? 1 : -1;
            win.webContents.send("bracket-cmd", { relative: rel }, mods);
            e.preventDefault();
            return;
        }
    });
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
    win.on("focus", () => {
        wasInFg = true;
        wasActive = true;
    });
    win.on("close", () => {
        MainWindow = null;
    });
    win.webContents.on("zoom-changed", (e) => {
        win.webContents.send("zoom-changed");
    });
    win.webContents.setWindowOpenHandler(({ url, frameName }) => {
        if (url.startsWith("https://docs.waveterm.dev/")) {
            console.log("openExternal docs", url);
            electron.shell.openExternal(url);
        } else if (url.startsWith("https://discord.gg/")) {
            console.log("openExternal discord", url);
            electron.shell.openExternal(url);
        } else if (url.startsWith("https://extern/?")) {
            let qmark = url.indexOf("?");
            let param = url.substring(qmark + 1);
            let newUrl = decodeURIComponent(param);
            console.log("openExternal extern", newUrl);
            electron.shell.openExternal(newUrl);
        } else if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("file://")) {
            console.log("openExternal fallback", url);
            electron.shell.openExternal(url);
        }
        console.log("window-open denied", url);
        return { action: "deny" };
    });

    return win;
}

function mainResizeHandler(e, win) {
    if (win == null || win.isDestroyed() || win.fullScreen) {
        return;
    }
    let bounds = win.getBounds();
    // console.log("resize/move", win.getBounds());
    let winSize = { width: bounds.width, height: bounds.height, top: bounds.y, left: bounds.x };
    let url = new URL(getBaseHostPort() + "/api/set-winsize");
    let fetchHeaders = getFetchHeaders();
    fetch(url, { method: "post", body: JSON.stringify(winSize), headers: fetchHeaders })
        .then((resp) => handleJsonFetchResponse(url, resp))
        .catch((err) => {
            console.log("error setting winsize", err);
        });
}

function calcBounds(clientData: ClientDataType) {
    let primaryDisplay = electron.screen.getPrimaryDisplay();
    let pdBounds = primaryDisplay.bounds;
    let size = { x: 100, y: 100, width: pdBounds.width - 200, height: pdBounds.height - 200 };
    if (clientData?.winsize?.width > 0) {
        let cwinSize = clientData.winsize;
        if (cwinSize.width > 0) {
            size.width = cwinSize.width;
        }
        if (cwinSize.height > 0) {
            size.height = cwinSize.height;
        }
        if (cwinSize.top >= 0) {
            size.y = cwinSize.top;
        }
        if (cwinSize.left >= 0) {
            size.x = cwinSize.left;
        }
    }
    if (size.width < 300) {
        size.width = 300;
    }
    if (size.height < 300) {
        size.height = 300;
    }
    if (pdBounds.width < size.width) {
        size.width = pdBounds.width;
    }
    if (pdBounds.height < size.height) {
        size.height = pdBounds.height;
    }
    if (pdBounds.width < size.x + size.width) {
        size.x = pdBounds.width - size.width;
    }
    if (pdBounds.height < size.y + size.height) {
        size.y = pdBounds.height - size.height;
    }
    return size;
}

app.on("window-all-closed", () => {
    if (unamePlatform !== "darwin") app.quit();
});

electron.ipcMain.on("get-id", (event) => {
    event.returnValue = instanceId + ":" + event.processId;
});

electron.ipcMain.on("get-platform", (event) => {
    event.returnValue = unamePlatform;
});

electron.ipcMain.on("get-isdev", (event) => {
    event.returnValue = isDev;
});

electron.ipcMain.on("get-authkey", (event) => {
    event.returnValue = GlobalAuthKey;
});

electron.ipcMain.on("wavesrv-status", (event) => {
    event.returnValue = waveSrvProc != null;
});

electron.ipcMain.on("get-initial-termfontfamily", (event) => {
    event.returnValue = initialClientData?.feopts?.termfontfamily;
});

electron.ipcMain.on("restart-server", (event) => {
    if (waveSrvProc != null) {
        waveSrvProc.kill();
        waveSrvShouldRestart = true;
        return;
    } else {
        runWaveSrv();
    }
    event.returnValue = true;
});

electron.ipcMain.on("reload-window", (event) => {
    if (MainWindow != null) {
        MainWindow.reload();
    }
    event.returnValue = true;
});

electron.ipcMain.on("open-external-link", (_, url) => {
    (async () => {
        try {
            await electron.shell.openExternal(url);
        } catch (err) {
            console.warn("error opening external link", err);
        }
    })();
});

electron.ipcMain.on("reregister-global-shortcut", (event, shortcut: string) => {
    reregisterGlobalShortcut(shortcut);
    event.returnValue = true;
});

electron.ipcMain.on("get-last-logs", (event, numberOfLines) => {
    (async () => {
        try {
            const logPath = path.join(getWaveHomeDir(), "wavesrv.log");
            const lastLines = await readLastLinesOfFile(logPath, numberOfLines);
            event.reply("last-logs", lastLines);
        } catch (err) {
            console.error("Error reading log file:", err);
            event.reply("last-logs", "Error reading log file.");
        }
    })();
});

electron.ipcMain.on("change-auto-update", (_, enable) => {
    configureAutoUpdater(enable);
});

function readLastLinesOfFile(filePath: string, lineCount: number) {
    return new Promise((resolve, reject) => {
        child_process.exec(`tail -n ${lineCount} "${filePath}"`, (err, stdout, stderr) => {
            if (err) {
                reject(err.message);
                return;
            }
            if (stderr) {
                reject(stderr);
                return;
            }
            resolve(stdout);
        });
    });
}

function getContextMenu(): any {
    let menu = new electron.Menu();
    let menuItem = new electron.MenuItem({ label: "Testing", click: () => console.log("click testing!") });
    menu.append(menuItem);
    return menu;
}

function getFetchHeaders() {
    return {
        "x-authkey": GlobalAuthKey,
    };
}

async function getClientDataPoll(loopNum: number) {
    let lastTime = loopNum >= 6;
    let cdata = await getClientData(!lastTime, loopNum);
    if (lastTime || cdata != null) {
        return cdata;
    }
    await sleep(1000);
    return getClientDataPoll(loopNum + 1);
}

function getClientData(willRetry: boolean, retryNum: number) {
    let url = new URL(getBaseHostPort() + "/api/get-client-data");
    let fetchHeaders = getFetchHeaders();
    return fetch(url, { headers: fetchHeaders })
        .then((resp) => handleJsonFetchResponse(url, resp))
        .then((data) => {
            if (data == null) {
                return null;
            }
            return data.data;
        })
        .catch((err) => {
            if (willRetry) {
                console.log("error getting client-data from wavesrv, will retry", "(" + retryNum + ")");
            } else {
                console.log("error getting client-data from wavesrv, failed: ", err);
            }
            return null;
        });
}

function sendWSSC() {
    if (MainWindow != null) {
        if (waveSrvProc == null) {
            MainWindow.webContents.send("wavesrv-status-change", false);
            return;
        }
        MainWindow.webContents.send("wavesrv-status-change", true, waveSrvProc.pid);
    }
}

function runWaveSrv() {
    let pResolve: (value: unknown) => void;
    let pReject: (reason?: any) => void;
    let rtnPromise = new Promise((argResolve, argReject) => {
        pResolve = argResolve;
        pReject = argReject;
    });
    let envCopy = { ...process.env };
    envCopy[WaveAppPathVarName] = getAppBasePath();
    if (isDev) {
        envCopy[WaveDevVarName] = "1";
    }
    let waveSrvCmd = getWaveSrvCmd();
    console.log("trying to run local server", waveSrvCmd);
    let proc = child_process.spawn("bash", ["-c", waveSrvCmd], {
        cwd: getWaveSrvCwd(),
        env: envCopy,
    });
    proc.on("exit", (e) => {
        console.log("wavesrv exit", e);
        waveSrvProc = null;
        sendWSSC();
        pReject(new Error(sprintf("failed to start local server (%s)", waveSrvCmd)));
        if (waveSrvShouldRestart) {
            waveSrvShouldRestart = false;
            this.runWaveSrv();
        }
    });
    proc.on("spawn", (e) => {
        console.log("spawnned wavesrv");
        waveSrvProc = proc;
        pResolve(true);
        setTimeout(() => {
            sendWSSC();
        }, 100);
    });
    proc.on("error", (e) => {
        console.log("error running wavesrv", e);
    });
    proc.stdout.on("data", (output) => {
        return;
    });
    proc.stderr.on("data", (output) => {
        return;
    });
    return rtnPromise;
}

electron.ipcMain.on("context-screen", (event, { screenId }, { x, y }) => {
    console.log("context-screen", screenId);
    let menu = getContextMenu();
    menu.popup({ x, y });
});

electron.ipcMain.on("context-editmenu", (event, { x, y }, opts) => {
    if (opts == null) {
        opts = {};
    }
    console.log("context-editmenu");
    let menu = new electron.Menu();
    if (opts.showCut) {
        let menuItem = new electron.MenuItem({ label: "Cut", role: "cut" });
        menu.append(menuItem);
    }
    let menuItem = new electron.MenuItem({ label: "Copy", role: "copy" });
    menu.append(menuItem);
    menuItem = new electron.MenuItem({ label: "Paste", role: "paste" });
    menu.append(menuItem);
    menu.popup({ x, y });
});

async function createMainWindowWrap() {
    let clientData: ClientDataType | null = null;
    try {
        clientData = await getClientDataPoll(1);
        initialClientData = clientData;
    } catch (e) {
        console.log("error getting wavesrv clientdata", e.toString());
    }
    MainWindow = createMainWindow(clientData);
    if (clientData && clientData.winsize.fullscreen) {
        MainWindow.setFullScreen(true);
    }
    configureAutoUpdaterStartup(clientData);
}

async function sleep(ms: number) {
    return new Promise((resolve, _) => setTimeout(resolve, ms));
}

function logActiveState() {
    let activeState = { fg: wasInFg, active: wasActive, open: true };
    let url = new URL(getBaseHostPort() + "/api/log-active-state");
    let fetchHeaders = getFetchHeaders();
    fetch(url, { method: "post", body: JSON.stringify(activeState), headers: fetchHeaders })
        .then((resp) => handleJsonFetchResponse(url, resp))
        .catch((err) => {
            console.log("error logging active state", err);
        });
    // for next iteration
    wasInFg = MainWindow != null && MainWindow.isFocused();
    wasActive = false;
}

// this isn't perfect, but gets the job done without being complicated
function runActiveTimer() {
    logActiveState();
    setTimeout(runActiveTimer, 60000);
}

function reregisterGlobalShortcut(shortcut: string) {
    if (shortcut == "") {
        shortcut = null;
    }
    if (currentGlobalShortcut == shortcut) {
        return;
    }
    if (!waveutil.isBlank(currentGlobalShortcut)) {
        if (electron.globalShortcut.isRegistered(currentGlobalShortcut)) {
            electron.globalShortcut.unregister(currentGlobalShortcut);
        }
    }
    if (waveutil.isBlank(shortcut)) {
        currentGlobalShortcut = null;
        return;
    }
    let ok = electron.globalShortcut.register(shortcut, () => {
        console.log("global shortcut triggered, showing window");
        MainWindow?.show();
    });
    console.log("registered global shortcut", shortcut, ok ? "ok" : "failed");
    if (!ok) {
        currentGlobalShortcut = null;
        console.log("failed to register global shortcut", shortcut);
    }
    currentGlobalShortcut = shortcut;
}

function configureAutoUpdaterStartup(clientData: ClientDataType) {
    console.log("configureAutoUpdaterStartup", clientData);
    configureAutoUpdater(!clientData.clientopts.noreleasecheck);
}

function initUpdater(): NodeJS.Timeout {
    const { autoUpdater } = electron;
    let feedURL = `https://waveterm-test-autoupdate.s3.us-west-2.amazonaws.com/autoupdate/${unamePlatform}/${unameArch}`;
    let serverType: "default" | "json" = "default";

    if (unamePlatform == "darwin") {
        feedURL += "/RELEASES.json";
        serverType = "json";
    }

    const requestHeaders = { "User-Agent": "Wave Auto-Update" };

    console.log("feedURL", feedURL);
    console.log("requestHeaders", requestHeaders);
    autoUpdater.setFeedURL({
        url: feedURL,
        headers: requestHeaders,
        serverType,
    });

    autoUpdater.on("error", (err) => {
        console.log("updater error");
        console.log(err);
    });

    autoUpdater.on("checking-for-update", () => {
        console.log("checking-for-update");
    });

    autoUpdater.on("update-available", () => {
        console.log("update-available; downloading...");
        MainWindow?.webContents.send("app-update-status", AutoUpdateStatusType.Downloading);
    });

    autoUpdater.on("update-not-available", () => {
        console.log("update-not-available");
        MainWindow?.webContents.send("app-update-status", AutoUpdateStatusType.Unavailable);
    });

    autoUpdater.on("update-downloaded", (event, releaseNotes, releaseName, releaseDate, updateURL) => {
        console.log("update-downloaded", [event, releaseNotes, releaseName, releaseDate, updateURL]);
        availableUpdateReleaseName = releaseName;
        availableUpdateReleaseNotes = releaseNotes;

        MainWindow?.webContents.send("app-update-status", AutoUpdateStatusType.Ready);
        const updateNotification = new electron.Notification({
            title: "Wave Terminal",
            body: "A new version of Wave Terminal is ready to install.",
        });
        updateNotification.on("click", () => {
            (async () => {
                try {
                    await installAppUpdate();
                } catch (err) {
                    console.error("Error installing app update:", err);
                }
            })();
        });
        updateNotification.show();
    });

    // check for updates right away and keep checking later
    autoUpdater.checkForUpdates();
    return setInterval(() => {
        autoUpdater.checkForUpdates();
    }, 10 * 60 * 60);
}

async function installAppUpdate() {
    const dialogOpts: Electron.MessageBoxOptions = {
        type: "info",
        buttons: ["Restart", "Later"],
        title: "Application Update",
        message: process.platform === "win32" ? availableUpdateReleaseNotes : availableUpdateReleaseName,
        detail: "A new version has been downloaded. Restart the application to apply the updates.",
    };

    await electron.dialog.showMessageBox(MainWindow, dialogOpts).then(({ response }) => {
        if (response === 0) electron.autoUpdater.quitAndInstall();
    });
}

electron.ipcMain.on("install-app-update", () => {
    (async () => {
        try {
            await installAppUpdate();
        } catch (err) {
            console.error("Error installing app update:", err);
        }
    })();
});

function configureAutoUpdater(enabled: boolean) {
    console.log("configureAutoUpdater");
    if (unamePlatform == "darwin") {
        if (enabled && autoUpdateInterval == null) {
            try {
                console.log("configuring auto updater");
                autoUpdateInterval = initUpdater();
            } catch (e) {
                console.log("error configuring auto updater", e.toString());
            }
        } else if (autoUpdateInterval != null) {
            console.log("user has disabled auto-updates, stopping updater");
            clearInterval(autoUpdateInterval);
            autoUpdateInterval = null;
        }
    }
}

// ====== MAIN ====== //

(async () => {
    let instanceLock = app.requestSingleInstanceLock();
    if (!instanceLock) {
        console.log("waveterm-app could not get single-instance-lock, shutting down");
        app.quit();
        return;
    }
    GlobalAuthKey = readAuthKey();
    try {
        await runWaveSrv();
    } catch (e) {
        console.log(e.toString());
    }
    await app.whenReady();
    await createMainWindowWrap();
    app.on("activate", () => {
        if (electron.BrowserWindow.getAllWindows().length === 0) {
            createMainWindowWrap().then();
        }
    });
})();
