import * as electron from "electron";
import * as path from "path";
import * as fs from "fs";
import fetch from "node-fetch";
import * as child_process from "node:child_process";
import { debounce } from "throttle-debounce";
import { handleJsonFetchResponse } from "../util/util";
import * as winston from "winston";
import * as util from "util";
import { sprintf } from "sprintf-js";
import { v4 as uuidv4 } from "uuid";

const PromptAppPathVarName = "PROMPT_APP_PATH";
const PromptDevVarName = "PROMPT_DEV";
const AuthKeyFile = "prompt.authkey";
const DevServerEndpoint = "http://127.0.0.1:8090";
const ProdServerEndpoint = "http://127.0.0.1:1619";

let isDev = process.env[PromptDevVarName] != null;
let scHome = getPromptHomeDir();
ensureDir(scHome);
let DistDir = isDev ? "dist-dev" : "dist";
let GlobalAuthKey = "";
let instanceId = uuidv4();
let oldConsoleLog = console.log;
let wasActive = true;
let wasInFg = true;

// these are either "darwin/amd64" or "darwin/arm64"
// normalize darwin/x64 to darwin/amd64 for GOARCH compatibility
let unamePlatform = process.platform;
let unameArch = process.arch;
if (unameArch == "x64") {
    unameArch = "amd64";
}
let logger;
let loggerConfig = {
    level: "info",
    format: winston.format.combine(
        winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        winston.format.printf((info) => `${info.timestamp} ${info.message}`)
    ),
    transports: [new winston.transports.File({ filename: path.join(scHome, "prompt-app.log"), level: "info" })],
};
if (isDev) {
    loggerConfig.transports.push(new winston.transports.Console());
}
logger = winston.createLogger(loggerConfig);
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
        "prompt-app starting, PROMPT_HOME=%s, apppath=%s arch=%s/%s",
        scHome,
        getAppBasePath(),
        unamePlatform,
        unameArch
    )
);
if (isDev) {
    console.log("prompt-app PROMPT_DEV set");
}
let app = electron.app;
app.setName(isDev ? "Prompt (Dev)" : "Prompt");
let localServerProc = null;
let localServerShouldRestart = false;

electron.dialog.showErrorBox = (title, content) => {
    oldConsoleLog("ERROR", title, content);
};

// must match golang
function getPromptHomeDir() {
    let scHome = process.env.PROMPT_HOME;
    if (scHome == null) {
        let homeDir = process.env.HOME;
        if (homeDir == null) {
            homeDir = "/";
        }
        scHome = path.join(homeDir, isDev ? "prompt-dev" : "prompt");
    }
    return scHome;
}

// for dev, this is just the github.com/commandlinedev/prompt-client directory
// for prod, this is .../Prompt.app/Contents/Resources/app
function getAppBasePath() {
    return path.dirname(__dirname);
}

function getBaseHostPort() {
    if (isDev) {
        return DevServerEndpoint;
    }
    return ProdServerEndpoint;
}

function getLocalServerPath() {
    if (isDev) {
        return path.join(getAppBasePath(), "local-server-bin", "local-server");
    }
    return path.join(getAppBasePath(), "bin", "prompt-local-server");
}

function getLocalServerCmd() {
    let localServerPath = getLocalServerPath();
    let scHome = getPromptHomeDir();
    let logFile = path.join(scHome, "local-server.log");
    return `${localServerPath} >> "${logFile}" 2>&1`;
}

function getLocalServerCwd() {
    let scHome = getPromptHomeDir();
    return scHome;
}

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function readAuthKey() {
    let homeDir = getPromptHomeDir();
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

let menuTemplate = [
    {
        role: "appMenu",
    },
    {
        label: "File",
        submenu: [{ role: "close" }, { role: "forceReload" }],
    },
    {
        role: "editMenu",
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

let MainWindow = null;

function getMods(input: any) {
    return { meta: input.meta, shift: input.shift, ctrl: input.control, alt: input.alt };
}

function shNavHandler(event: any, url: any) {
    event.preventDefault();
    if (url.startsWith("https://") || url.startsWith("http://") || url.startsWith("file://")) {
        console.log("open external, shNav", url);
        electron.shell.openExternal(url);
    } else {
        console.log("navigation canceled", url);
    }
}

function shFrameNavHandler(event: any, url: any) {
    if (!event.frame || event.frame.parent == null) {
        // only use this handler to process iframe events (non-iframe events go to shNavHandler)
        return;
    }
    event.preventDefault();
    console.log(`frame-navigation url=${url} frame=${event.frame.name}`);
    if (event.frame.name == "webview") {
        // "webview" links always open in new window
        // this will *not* effect the initial load because srcdoc does not count as an electron navigation
        console.log("open external, frameNav", url);
        electron.shell.openExternal(url);
        return;
    }
    console.log("frame navigation canceled");
    return;
}

function createMainWindow(clientData) {
    let bounds = calcBounds(clientData);
    let win = new electron.BrowserWindow({
        x: bounds.x,
        y: bounds.y,
        titleBarStyle: "hiddenInset",
        width: bounds.width,
        height: bounds.height,
        minWidth: 600,
        minHeight: 400,
        webPreferences: {
            preload: path.join(getAppBasePath(), DistDir, "preload.js"),
        },
    });
    let indexHtml = isDev ? "index-dev.html" : "index.html";
    win.loadFile(path.join(getAppBasePath(), "static", indexHtml));
    win.webContents.on("before-input-event", (e, input) => {
        if (win.isFocused()) {
            wasActive = true;
        }
        if (input.type != "keyDown") {
            return;
        }
        let mods = getMods(input);
        if (input.code == "KeyT" && input.meta) {
            win.webContents.send("t-cmd", mods);
            e.preventDefault();
            return;
        }
        if (input.code == "KeyI" && input.meta) {
            e.preventDefault();
            if (!input.alt) {
                win.webContents.send("i-cmd", mods);
            } else {
                win.webContents.toggleDevTools();
            }

            return;
        }
        if (input.code == "KeyR" && input.meta) {
            if (input.shift) {
                e.preventDefault();
                win.reload();
            }
            return;
        }
        if (input.code == "KeyL" && input.meta) {
            win.webContents.send("l-cmd", mods);
            e.preventDefault();
            return;
        }
        if (input.code == "KeyW" && input.meta) {
            e.preventDefault();
            win.webContents.send("w-cmd", mods);
            return;
        }
        if (input.code == "KeyH" && input.meta) {
            win.webContents.send("h-cmd", mods);
            e.preventDefault();
            return;
        }
        if (input.meta && (input.code == "ArrowUp" || input.code == "ArrowDown")) {
            if (input.code == "ArrowUp") {
                win.webContents.send("meta-arrowup");
            } else {
                win.webContents.send("meta-arrowdown");
            }
            e.preventDefault();
            return;
        }
        if (input.meta && (input.code == "PageUp" || input.code == "PageDown")) {
            if (input.code == "PageUp") {
                win.webContents.send("meta-pageup");
            } else {
                win.webContents.send("meta-pagedown");
            }
            e.preventDefault();
            return;
        }
        if (input.code.startsWith("Digit") && input.meta) {
            let digitNum = parseInt(input.code.substr(5));
            if (isNaN(digitNum) || digitNum < 1 || digitNum > 9) {
                return;
            }
            e.preventDefault();
            win.webContents.send("digit-cmd", { digit: digitNum }, mods);
        }
        if ((input.code == "BracketRight" || input.code == "BracketLeft") && input.meta) {
            let rel = input.code == "BracketRight" ? 1 : -1;
            win.webContents.send("bracket-cmd", { relative: rel }, mods);
            e.preventDefault();
            return;
        }
    });
    win.webContents.on("will-navigate", shNavHandler);
    win.webContents.on("will-frame-navigate", shFrameNavHandler);
    win.on(
        "resized",
        debounce(400, (e) => mainResizeHandler(e, win))
    );
    win.on(
        "moved",
        debounce(400, (e) => mainResizeHandler(e, win))
    );
    win.on("focus", () => {
        wasInFg = true;
        wasActive = true;
    });
    win.on("close", () => {
        MainWindow = null;
    });
    win.webContents.setWindowOpenHandler(({ url, frameName }) => {
        if (url.startsWith("https://docs.getprompt.dev/")) {
            console.log("openExternal docs", url);
            electron.shell.openExternal(url);
        } else if (url.startsWith("https://discord.gg/")) {
            console.log("openExternal discord", url);
            electron.shell.openExternal(url);
        } else if (url.startsWith("https://extern/?")) {
            let qmark = url.indexOf("?");
            let param = url.substr(qmark + 1);
            let newUrl = decodeURIComponent(param);
            console.log("openExternal extern", newUrl);
            electron.shell.openExternal(newUrl);
        } else if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("file://")) {
            console.log("openExternal fallback", url);
            electron.shell.openExternal(newUrl);
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
    console.log("resize/move", win.getBounds());
    let winSize = { width: bounds.width, height: bounds.height, top: bounds.y, left: bounds.x };
    let url = getBaseHostPort() + "/api/set-winsize";
    let fetchHeaders = getFetchHeaders();
    fetch(url, { method: "post", body: JSON.stringify(winSize), headers: fetchHeaders })
        .then((resp) => handleJsonFetchResponse(url, resp))
        .catch((err) => {
            console.log("error setting winsize", err);
        });
}

function calcBounds(clientData) {
    let primaryDisplay = electron.screen.getPrimaryDisplay();
    let pdBounds = primaryDisplay.bounds;
    let size = { x: 50, y: 50, width: pdBounds.width - 150, height: pdBounds.height - 150 };
    if (clientData != null && clientData.winsize != null && clientData.winsize.width > 0) {
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
    if (process.platform !== "darwin") app.quit();
});

electron.ipcMain.on("get-id", (event) => {
    event.returnValue = instanceId + ":" + event.processId;
    return;
});

electron.ipcMain.on("get-isdev", (event) => {
    event.returnValue = isDev;
    return;
});

electron.ipcMain.on("get-authkey", (event) => {
    event.returnValue = GlobalAuthKey;
    return;
});

electron.ipcMain.on("local-server-status", (event) => {
    event.returnValue = localServerProc != null;
    return;
});

electron.ipcMain.on("restart-server", (event) => {
    if (localServerProc != null) {
        localServerProc.kill();
        localServerShouldRestart = true;
        return;
    } else {
        runLocalServer();
    }
    event.returnValue = true;
    return;
});

electron.ipcMain.on("reload-window", (event) => {
    if (MainWindow != null) {
        MainWindow.reload();
    }
    event.returnValue = true;
    return;
});

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
    let url = getBaseHostPort() + "/api/get-client-data";
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
                console.log("error getting client-data from local-server, will retry", "(" + retryNum + ")");
                return null;
            }
            console.log("error getting client-data from local-server, failed: ", err);
            return null;
        });
}

function sendLSSC() {
    if (MainWindow != null) {
        if (localServerProc == null) {
            MainWindow.webContents.send("local-server-status-change", false);
            return;
        }
        MainWindow.webContents.send("local-server-status-change", true, localServerProc.pid);
    }
}

function runLocalServer() {
    let pResolve = null;
    let pReject = null;
    let rtnPromise = new Promise((argResolve, argReject) => {
        pResolve = argResolve;
        pReject = argReject;
    });
    let envCopy = Object.assign({}, process.env);
    envCopy[PromptAppPathVarName] = getAppBasePath();
    if (isDev) {
        envCopy[PromptDevVarName] = "1";
    }
    console.log("trying to run local server", getLocalServerPath());
    let proc = child_process.spawn("/bin/bash", ["-c", getLocalServerCmd()], {
        cwd: getLocalServerCwd(),
        env: envCopy,
    });
    proc.on("exit", (e) => {
        console.log("local-server exit", e);
        localServerProc = null;
        sendLSSC();
        pReject(new Error(sprintf("failed to start local server (%s)", getLocalServerPath())));
        if (localServerShouldRestart) {
            localServerShouldRestart = false;
            this.runLocalServer();
        }
    });
    proc.on("spawn", (e) => {
        console.log("spawnned local-server");
        localServerProc = proc;
        pResolve(true);
        setTimeout(() => {
            sendLSSC();
        }, 100);
    });
    proc.on("error", (e) => {
        console.log("error running local-server", e);
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
    let menuItem = null;
    if (opts.showCut) {
        menuItem = new electron.MenuItem({ label: "Cut", role: "cut" });
        menu.append(menuItem);
    }
    menuItem = new electron.MenuItem({ label: "Copy", role: "copy" });
    menu.append(menuItem);
    menuItem = new electron.MenuItem({ label: "Paste", role: "paste" });
    menu.append(menuItem);
    menu.popup({ x, y });
});

async function createMainWindowWrap() {
    let clientData = null;
    try {
        clientData = await getClientDataPoll(1);
    } catch (e) {
        console.log("error getting local-server clientdata", e.toString());
    }
    MainWindow = createMainWindow(clientData);
    if (clientData && clientData.winsize.fullscreen) {
        MainWindow.setFullScreen(true);
    }
}

async function sleep(ms) {
    return new Promise((resolve, reject) => setTimeout(resolve, ms));
}

function logActiveState() {
    let activeState = { fg: wasInFg, active: wasActive, open: true };
    let url = getBaseHostPort() + "/api/log-active-state";
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

// ====== MAIN ====== //

(async () => {
    let instanceLock = app.requestSingleInstanceLock();
    if (!instanceLock) {
        console.log("prompt-app could not get single-instance-lock, shutting down");
        app.quit();
        return;
    }
    GlobalAuthKey = readAuthKey();
    try {
        await runLocalServer();
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
