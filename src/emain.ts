import * as electron from "electron";
import * as path from "path";
import * as fs from "fs";
import fetch from "node-fetch";
import * as child_process from "node:child_process";
import {debounce} from "throttle-debounce";
import {acquireSCElectronLock} from "./base";
import {handleJsonFetchResponse} from "./util";
import * as winston from "winston";
import * as util from "util";
import {sprintf} from "sprintf-js";

const PromptAppPathVarName = "PROMPT_APP_PATH";
let isDev = (process.env.PROMPT_DEV != null);
let scHome = getPromptHomeDir();
ensureDir(scHome);
let DistDir = (isDev ? "dist-dev" : "dist");

// these are either "darwin/amd64" or "darwin/arm64"
// normalize darwin/x64 to darwin/amd64 for GOARCH compatibility
let unamePlatform = process.platform;
let unameArch = process.arch;
if (unameArch == "x64") {
    unameArch = "amd64"
}

let logger;
let loggerConfig = {
    level: "info",
    format: winston.format.combine(
        winston.format.timestamp({format: "YYYY-MM-DD HH:mm:ss"}),
        winston.format.printf(info => `${info.timestamp} ${info.message}`),
    ),
    transports: [
        new winston.transports.File({filename: path.join(scHome, "prompt-app.log"), level: "info"}),
    ],
};
if (isDev) {
    loggerConfig.transports.push(new winston.transports.Console());
}
logger = winston.createLogger(loggerConfig);
function log(...msg) {
    logger.info(util.format(...msg));
}
console.log = log;
console.log(sprintf("prompt-app starting, PROMPT_HOME=%s, apppath=%s arch=%s/%s", scHome, getAppBasePath(), unamePlatform, unameArch));

const DevLocalServerPath = "/Users/mike/prompt/local-server";
let localServerProc = null;
let localServerShouldRestart = false;

// must match golang
function getPromptHomeDir() {
    let scHome = process.env.PROMPT_HOME;
    if (scHome == null) {
        let homeDir = process.env.HOME;
        if (homeDir == null) {
            homeDir = "/";
        }
        scHome = path.join(homeDir, "prompt");
    }
    return scHome;
}

// for dev, this is just the github.com/scripthaus-dev/sh2 directory
// for prod, this is .../Prompt.app/Contents/Resources/app
function getAppBasePath() {
    return path.dirname(__dirname);
}

function getLocalServerPath() {
    if (isDev) {
        return DevLocalServerPath
    }
    return path.join(getAppBasePath(), "bin", "prompt-local-server");
}

function getLocalServerCmd() {
    let localServerPath = getLocalServerPath();
    let scHome = getPromptHomeDir();
    let logFile = path.join(scHome, "local-server.log");
    return `${localServerPath} > ${logFile} 2>&1`;
}

function getLocalServerCwd() {
    let scHome = getPromptHomeDir();
    return scHome;
}

function ensureDir(dir) {
    fs.mkdirSync(dir, {recursive: true, mode: 0o700});
}

let app = electron.app;
app.setName("Prompt");

let lock : File;
try {
    lock = acquireSCElectronLock();
}
catch (e) {
    app.exit(0);
}

let menuTemplate = [
    {
        role: "appMenu",
    },
    {
        role: "fileMenu",
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
    {
        role: "help",
    },
];

let menu = electron.Menu.buildFromTemplate(menuTemplate);
electron.Menu.setApplicationMenu(menu);

let MainWindow = null;

function getMods(input : any) {
    return {meta: input.meta, shift: input.shift, ctrl: input.ctrl, alt: input.alt};
}

function shNavHandler(event : any, url : any) {
    console.log("navigation", url);
    event.preventDefault();
}

function createMainWindow(clientData) {
    let bounds = calcBounds(clientData);
    let win = new electron.BrowserWindow({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        webPreferences: {
            preload: path.join(getAppBasePath(), DistDir, "preload.js"),
        },
    });
    let indexHtml = (isDev ? "index-dev.html" : "index.html");
    win.loadFile(path.join(getAppBasePath(), "static", indexHtml));
    win.webContents.on("before-input-event", (e, input) => {
        if (input.type != "keyDown") {
            return;
        }
        let mods = getMods(input);
        if (input.meta) {
            console.log("before-input", input.code, input.modifiers);
        }
        if (input.code == "KeyT" && input.meta) {
            win.webContents.send("t-cmd", mods);
            e.preventDefault();
            return;
        }
        if (input.code == "KeyI" && input.meta) {
            if (!input.alt) {
                win.webContents.send("i-cmd", mods);
                e.preventDefault();
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
            win.webContents.send("digit-cmd", {digit: digitNum}, mods);
        }
        if ((input.code == "BracketRight" || input.code == "BracketLeft") && input.meta) {
            let rel = (input.code == "BracketRight" ? 1 : -1);
            win.webContents.send("bracket-cmd", {relative: rel}, mods);
            e.preventDefault();
            return;
        }
    });
    win.webContents.on("will-navigate", shNavHandler);
    win.on("resized", debounce(400, mainResizeHandler));
    win.on("moved", debounce(400, mainResizeHandler));
    win.on("close", () => {
        MainWindow = null;
    });
    win.webContents.on("new-window", (e, url) => {
        e.preventDefault();
        if (url.startsWith("https://docs.getprompt.dev/")) {
            electron.shell.openExternal(url);
        }
        if (url.startsWith("https://discord.gg/")) {
            electron.shell.openExternal(url);
        }
    });
    return win;
}

function mainResizeHandler(e) {
    let win = e.sender;
    if (win == null || win.isDestroyed() || win.fullScreen) {
        return;
    }
    let bounds = win.getBounds();
    console.log("resize/move", win.getBounds());
    let winSize = {width: bounds.width, height: bounds.height, top: bounds.y, left: bounds.x};
    let url = "http://localhost:8080/api/set-winsize";
    fetch(url, {method: "post", body: JSON.stringify(winSize)}).then((resp) => handleJsonFetchResponse(url, resp)).catch((err) => {
        console.log("error setting winsize", err)
    });
}

function calcBounds(clientData) {
    let primaryDisplay = electron.screen.getPrimaryDisplay();
    let pdBounds = primaryDisplay.bounds;
    let size = {x: 50, y: 50, width: pdBounds.width-150, height: pdBounds.height-150};
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

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
});

electron.ipcMain.on("get-id", (event) => {
    event.returnValue = event.processId;
    return;
});

electron.ipcMain.on("local-server-status", (event) => {
    event.returnValue = (localServerProc != null);
    return;
});

electron.ipcMain.on("restart-server", (event) => {
    if (localServerProc != null) {
        localServerProc.kill();
        localServerShouldRestart = true;
        return;
    }
    else {
        runLocalServer();
    }
    event.returnValue = true;
    return;
});

function getContextMenu() : any {
    let menu = new electron.Menu();
    let menuItem = new electron.MenuItem({label: "Testing", click: () => console.log("click testing!")});
    menu.append(menuItem);
    return menu;
}

function getClientData() {
    let url = "http://localhost:8080/api/get-client-data";
    return fetch(url).then((resp) => handleJsonFetchResponse(url, resp)).then((data) => {
        if (data == null) {
            return null;
        }
        return data.data;
    }).catch((err) => {
        console.log("error getting client-data", err);
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
    })
    proc.stdout.on("data", output => {
        return;
    });
    proc.stderr.on("data", output => {
        return;
    });
    return rtnPromise;
}

electron.ipcMain.on("context-screen", (event, {screenId}, {x, y}) => {
    console.log("context-screen", screenId);
    let menu = getContextMenu();
    menu.popup({x, y});
});

async function createMainWindowWrap() {
    let clientData = null;
    try {
        clientData = await getClientData();
    }
    catch (e) {
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


// ====== MAIN ====== //

(async () => {
    try {
        await runLocalServer();
    }
    catch (e) {
        console.log(e.toString());
    }
    await sleep(1000);  // TODO remove this sleep, poll getClientData() in createMainWindow
    await app.whenReady();
    await createMainWindowWrap();
    app.on('activate', () => {
        if (electron.BrowserWindow.getAllWindows().length === 0) {
            createMainWindowWrap().then();
        }
    })
})();

