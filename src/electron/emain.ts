// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as electron from "electron";
import { autoUpdater } from "electron-updater";
import * as path from "path";
import * as fs from "fs";
import fetch from "node-fetch";
import * as child_process from "node:child_process";
import { debounce } from "throttle-debounce";
import * as winston from "winston";
import * as util from "util";
import * as waveutil from "../util/util";
import { sprintf } from "sprintf-js";
import { handleJsonFetchResponse, fireAndForget } from "@/util/util";
import { v4 as uuidv4 } from "uuid";
import { checkKeyPressed, adaptFromElectronKeyEvent, setKeyUtilPlatform } from "@/util/keyutil";
import { platform } from "os";

const WaveAppPathVarName = "WAVETERM_APP_PATH";
const WaveDevVarName = "WAVETERM_DEV";
const AuthKeyFile = "waveterm.authkey";
const DevServerEndpoint = "http://127.0.0.1:8090";
const ProdServerEndpoint = "http://127.0.0.1:1619";
const startTs = Date.now();

const isDev = process.env[WaveDevVarName] != null;
const waveHome = getWaveHomeDir();
const DistDir = isDev ? "dist-dev" : "dist";
const instanceId = uuidv4();
const oldConsoleLog = console.log;

let GlobalAuthKey = "";
let wasActive = true;
let wasInFg = true;
let currentGlobalShortcut: string | null = null;
let initialClientData: ClientDataType = null;
let MainWindow: Electron.BrowserWindow | null = null;

checkPromptMigrate();
ensureDir(waveHome);

// these are either "darwin/amd64" or "darwin/arm64"
// normalize darwin/x64 to darwin/amd64 for GOARCH compatibility
const unamePlatform = process.platform;
let unameArch: string = process.arch;
if (unameArch == "x64") {
    unameArch = "amd64";
}
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
const app = electron.app;
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
    const waveHome = getWaveHomeDir();
    if (isDev || fs.existsSync(waveHome)) {
        // don't migrate if we're running dev version or if wave home directory already exists
        return;
    }
    if (process.env.HOME == null) {
        return;
    }
    const homeDir: string = process.env.HOME;
    const promptHome: string = path.join(homeDir, "prompt");
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

/**
 * Gets the base path to the Electron app resources. For dev, this is the root of the project. For packaged apps, this is the app.asar archive.
 * @returns The base path of the Electron application
 */
function getElectronAppBasePath(): string {
    return path.dirname(__dirname);
}

/**
 * Gets the base path to the Go backend. If the app is packaged as an asar, the path will be in a separate unpacked directory.
 * @returns The base path of the Go backend
 */
function getGoAppBasePath(): string {
    const appDir = getElectronAppBasePath();
    if (appDir.endsWith(".asar")) {
        return `${appDir}.unpacked`;
    } else {
        return appDir;
    }
}

function getBaseHostPort(): string {
    if (isDev) {
        return DevServerEndpoint;
    }
    return ProdServerEndpoint;
}

function getWaveSrvPath(): string {
    if (isDev) {
        return path.join(getGoAppBasePath(), "bin", "wavesrv");
    }
    return path.join(getGoAppBasePath(), "bin", `wavesrv.${unameArch}`);
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

function ensureDir(dir: fs.PathLike) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function readAuthKey(): string {
    const homeDir = getWaveHomeDir();
    const authKeyFileName = path.join(homeDir, AuthKeyFile);
    if (!fs.existsSync(authKeyFileName)) {
        const authKeyStr = String(uuidv4());
        fs.writeFileSync(authKeyFileName, authKeyStr, { mode: 0o600 });
        return authKeyStr;
    }
    const authKeyData = fs.readFileSync(authKeyFileName);
    const authKeyStr = String(authKeyData);
    if (authKeyStr == null || authKeyStr == "") {
        throw new Error("cannot read authkey");
    }
    return authKeyStr.trim();
}
const reloadAcceleratorKey = unamePlatform == "darwin" ? "Option+R" : "Super+R";
const cmdOrAlt = process.platform === "darwin" ? "Cmd" : "Alt";
let viewSubMenu: Electron.MenuItemConstructorOptions[] = [];
viewSubMenu.push({ role: "reload", accelerator: reloadAcceleratorKey });
viewSubMenu.push({ role: "toggleDevTools" });
if (isDev) {
    viewSubMenu.push({
        label: "Toggle Dev UI",
        click: () => {
            MainWindow?.webContents.send("toggle-devui");
        },
    });
}
viewSubMenu.push({ type: "separator" });
viewSubMenu.push({
    label: "Actual Size",
    accelerator: cmdOrAlt + "+0",
    click: () => {
        if (MainWindow == null) {
            return;
        }
        MainWindow.webContents.setZoomFactor(1);
        MainWindow.webContents.send("zoom-changed");
    },
});
viewSubMenu.push({
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
});
viewSubMenu.push({
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
});
viewSubMenu.push({ type: "separator" });
viewSubMenu.push({ role: "togglefullscreen" });
const menuTemplate: Electron.MenuItemConstructorOptions[] = [
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
            {
                label: "Hide",
                click: () => {
                    app.hide();
                },
            },
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
        submenu: viewSubMenu,
    },
    {
        role: "windowMenu",
    },
];

const menu = electron.Menu.buildFromTemplate(menuTemplate);
electron.Menu.setApplicationMenu(menu);

function getMods(input: any): object {
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

function createMainWindow(clientData: ClientDataType | null): Electron.BrowserWindow {
    const bounds = calcBounds(clientData);
    setKeyUtilPlatform(platform());
    const win = new electron.BrowserWindow({
        x: bounds.x,
        y: bounds.y,
        titleBarStyle: "hiddenInset",
        width: bounds.width,
        height: bounds.height,
        minWidth: 800,
        minHeight: 600,
        icon:
            unamePlatform == "linux"
                ? path.join(getElectronAppBasePath(), "public/logos/wave-logo-dark.png")
                : undefined,
        webPreferences: {
            preload: path.join(getElectronAppBasePath(), DistDir, "preload.js"),
        },
        show: false,
    });
    win.once("ready-to-show", () => {
        win.show();
    });
    const indexHtml = isDev ? "index-dev.html" : "index.html";
    win.loadFile(path.join(getElectronAppBasePath(), "public", indexHtml));
    win.webContents.on("before-input-event", (e, input) => {
        const waveEvent = adaptFromElectronKeyEvent(input);
        if (win.isFocused()) {
            wasActive = true;
        }
        if (input.type != "keyDown") {
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
            const qmark = url.indexOf("?");
            const param = url.substring(qmark + 1);
            const newUrl = decodeURIComponent(param);
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

function mainResizeHandler(_: any, win: Electron.BrowserWindow) {
    if (win == null || win.isDestroyed() || win.fullScreen) {
        return;
    }
    const bounds = win.getBounds();
    const winSize = { width: bounds.width, height: bounds.height, top: bounds.y, left: bounds.x };
    const url = new URL(getBaseHostPort() + "/api/set-winsize");
    const fetchHeaders = getFetchHeaders();
    fetch(url, { method: "post", body: JSON.stringify(winSize), headers: fetchHeaders })
        .then((resp) => handleJsonFetchResponse(url, resp))
        .catch((err) => {
            console.log("error setting winsize", err);
        });
}

function calcBounds(clientData: ClientDataType): Electron.Rectangle {
    const primaryDisplay = electron.screen.getPrimaryDisplay();
    const pdBounds = primaryDisplay.bounds;
    const size = { x: 100, y: 100, width: pdBounds.width - 200, height: pdBounds.height - 200 };
    if (clientData?.winsize?.width > 0) {
        const cwinSize = clientData.winsize;
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

electron.ipcMain.on("toggle-developer-tools", (event) => {
    if (MainWindow != null) {
        MainWindow.webContents.toggleDevTools();
    }
    event.returnValue = true;
});

function convertMenuDefArrToMenu(menuDefArr: ElectronContextMenuItem[]): electron.Menu {
    const menuItems: electron.MenuItem[] = [];
    for (const menuDef of menuDefArr) {
        const menuItemTemplate: electron.MenuItemConstructorOptions = {
            role: menuDef.role as any,
            label: menuDef.label,
            type: menuDef.type,
            click: () => {
                MainWindow?.webContents.send("contextmenu-click", menuDef.id);
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

electron.ipcMain.on("contextmenu-show", (event, menuDefArr: ElectronContextMenuItem[], { x, y }) => {
    if (menuDefArr == null || menuDefArr.length == 0) {
        return;
    }
    const menu = convertMenuDefArrToMenu(menuDefArr);
    menu.popup({ x, y });
    event.returnValue = true;
});

electron.ipcMain.on("hide-window", (event) => {
    if (MainWindow != null) {
        MainWindow.hide();
    }
    event.returnValue = true;
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

electron.ipcMain.on("open-external-link", (_, url) => fireAndForget(() => electron.shell.openExternal(url)));

electron.ipcMain.on("reregister-global-shortcut", (event, shortcut: string) => {
    reregisterGlobalShortcut(shortcut);
    event.returnValue = true;
});

electron.ipcMain.on("get-last-logs", (event, numberOfLines) => {
    fireAndForget(async () => {
        try {
            const logPath = path.join(getWaveHomeDir(), "wavesrv.log");
            const lastLines = await readLastLinesOfFile(logPath, numberOfLines);
            event.reply("last-logs", lastLines);
        } catch (err) {
            console.error("Error reading log file:", err);
            event.reply("last-logs", "Error reading log file.");
        }
    });
});

electron.ipcMain.on("get-shouldusedarkcolors", (event) => {
    event.returnValue = electron.nativeTheme.shouldUseDarkColors;
});

electron.ipcMain.on("get-nativethemesource", (event) => {
    event.returnValue = electron.nativeTheme.themeSource;
});

electron.ipcMain.on("set-nativethemesource", (event, themeSource: "system" | "light" | "dark") => {
    electron.nativeTheme.themeSource = themeSource;
    event.returnValue = true;
});

electron.nativeTheme.on("updated", () => {
    if (MainWindow != null) {
        MainWindow.webContents.send("nativetheme-updated");
    }
});

electron.ipcMain.on("path-basename", (event, p) => {
    event.returnValue = path.basename(p);
});

electron.ipcMain.on("path-dirname", (event, p) => {
    event.returnValue = path.dirname(p);
});

electron.ipcMain.on("path-sep", (event) => {
    event.returnValue = path.sep;
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

function getContextMenu(): electron.Menu {
    const menu = new electron.Menu();
    const menuItem = new electron.MenuItem({ label: "Testing", click: () => console.log("click testing!") });
    menu.append(menuItem);
    return menu;
}

function getFetchHeaders() {
    return {
        "x-authkey": GlobalAuthKey,
    };
}

async function getClientDataPoll(loopNum: number): Promise<ClientDataType | null> {
    const lastTime = loopNum >= 30;
    const cdata = await getClientData(!lastTime, loopNum);
    if (lastTime || cdata != null) {
        return cdata;
    }
    await sleep(200);
    return getClientDataPoll(loopNum + 1);
}

async function getClientData(willRetry: boolean, retryNum: number): Promise<ClientDataType | null> {
    const url = new URL(getBaseHostPort() + "/api/get-client-data");
    const fetchHeaders = getFetchHeaders();
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
    const rtnPromise = new Promise((argResolve, argReject) => {
        pResolve = argResolve;
        pReject = argReject;
    });
    const envCopy = { ...process.env };
    envCopy[WaveAppPathVarName] = getGoAppBasePath();
    if (isDev) {
        envCopy[WaveDevVarName] = "1";
    }
    const waveSrvCmd = getWaveSrvCmd();
    console.log("trying to run local server", waveSrvCmd);
    const proc = child_process.execFile("bash", ["-c", waveSrvCmd], {
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
    proc.stdout.on("data", (_) => {
        return;
    });
    proc.stderr.on("data", (_) => {
        return;
    });
    return rtnPromise;
}

electron.ipcMain.on("context-editmenu", (_, { x, y }, opts) => {
    if (opts == null) {
        opts = {};
    }
    console.log("context-editmenu");
    const menu = new electron.Menu();
    if (opts.showCut) {
        const menuItem = new electron.MenuItem({ label: "Cut", role: "cut" });
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
    const activeState = { fg: wasInFg, active: wasActive, open: true };
    const url = new URL(getBaseHostPort() + "/api/log-active-state");
    const fetchHeaders = getFetchHeaders();
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
    const ok = electron.globalShortcut.register(shortcut, () => {
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

// ====== AUTO-UPDATER ====== //
let autoUpdateLock = false;
let autoUpdateInterval: NodeJS.Timeout | null = null;
let availableUpdateReleaseName: string | null = null;
let availableUpdateReleaseNotes: string | null = null;
let appUpdateStatus = "unavailable";

/**
 * Sets the app update status and sends it to the main window
 * @param status The AppUpdateStatus to set, either "ready" or "unavailable"
 */
function setAppUpdateStatus(status: string) {
    appUpdateStatus = status;
    if (MainWindow != null) {
        MainWindow.webContents.send("app-update-status", appUpdateStatus);
    }
}

/**
 * Initializes the auto-updater and sets up event listeners
 * @returns The interval at which the auto-updater checks for updates
 */
function initUpdater(): NodeJS.Timeout {
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
            fireAndForget(installAppUpdate);
        });
        updateNotification.show();
    });

    // check for updates right away and keep checking later
    autoUpdater.checkForUpdates();
    return setInterval(() => fireAndForget(autoUpdater.checkForUpdates), 3600000); // 1 hour in ms
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

    await electron.dialog.showMessageBox(MainWindow, dialogOpts).then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall();
    });
}

electron.ipcMain.on("install-app-update", () => fireAndForget(installAppUpdate));
electron.ipcMain.on("get-app-update-status", (event) => {
    event.returnValue = appUpdateStatus;
});

electron.ipcMain.on("change-auto-update", (_, enable: boolean) => {
    configureAutoUpdater(enable);
});

/**
 * Configures the auto-updater based on the client data
 * @param clientData The client data to use to configure the auto-updater. If the clientData has noreleasecheck set to true, the auto-updater will be disabled.
 */
function configureAutoUpdaterStartup(clientData: ClientDataType) {
    if (clientData == null) {
        configureAutoUpdater(false);
        return;
    }
    configureAutoUpdater(!clientData.clientopts.noreleasecheck);
}

/**
 * Configures the auto-updater based on the user's preference
 * @param enabled Whether the auto-updater should be enabled
 */
function configureAutoUpdater(enabled: boolean) {
    // simple lock to prevent multiple auto-update configuration attempts, this should be very rare
    if (autoUpdateLock) {
        console.log("auto-update configuration already in progress, skipping");
        return;
    }
    autoUpdateLock = true;

    if (enabled && autoUpdateInterval == null) {
        try {
            console.log("configuring auto updater");
            autoUpdateInterval = initUpdater();
        } catch (e) {
            console.log("error configuring auto updater", e.toString());
        }
    }
    autoUpdateLock = false;
}
// ====== AUTO-UPDATER ====== //

// ====== MAIN ====== //

(async () => {
    const instanceLock = app.requestSingleInstanceLock();
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
    setTimeout(runActiveTimer, 5000); // start active timer, wait 5s just to be safe
    await app.whenReady();
    await createMainWindowWrap();
    app.on("activate", () => {
        if (electron.BrowserWindow.getAllWindows().length === 0) {
            createMainWindowWrap().then();
        }
    });
})();
