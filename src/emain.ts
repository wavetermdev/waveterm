import * as electron from "electron";
import * as path from "path";
import * as fs from "fs";
import fetch from "node-fetch";
import {debounce} from "throttle-debounce";
import {acquireSCElectronLock} from "./base";
import {handleJsonFetchResponse} from "./util";

let app = electron.app;
app.setName("ScriptHaus");

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
let RemotesWindow = null;

function getMods(input : any) {
    return {meta: input.meta, shift: input.shift, ctrl: input.ctrl, alt: input.alt};
}

function shNavHandler(event : any, url : any) {
    console.log("navigation", url);
    event.preventDefault();
    if (url == "file:///remotes.html") {
        createRemotesWindow();
    }
}

function createRemotesWindow() {
    if (RemotesWindow != null) {
        console.log("remotes exists");
        RemotesWindow.focus();
        return;
    }
    console.log("create remotes window");
    let win = new electron.BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, "../src/preload.js"),
        },
    });
    RemotesWindow = win;
    win.loadFile("../static/remotes.html");
    win.on("close", () => {
        RemotesWindow = null;
    });
    win.webContents.on("will-navigate", shNavHandler);
}

function createMainWindow(clientData) {
    let bounds = calcBounds(clientData);
    let win = new electron.BrowserWindow({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        webPreferences: {
            preload: path.join(__dirname, "../src/preload.js"),
        },
    });
    win.loadFile("../static/index.html");
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
        if (input.code == "KeyW" && input.meta) {
            e.preventDefault();
            win.webContents.send("w-cmd", mods);
            return;
        }
        //if (input.code == "KeyR" && input.meta && input.alt) {
        //    createRemotesWindow();
        //    e.preventDefault();
        //    return;
        //}
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

electron.ipcMain.on("context-screen", (event, {screenId}, {x, y}) => {
    console.log("context-screen", screenId);
    let menu = getContextMenu();
    menu.popup({x, y});
});

async function createMainWindowWrap() {
    let clientData = await getClientData();
    MainWindow = createMainWindow(clientData);
    if (clientData && clientData.winsize.fullscreen) {
        MainWindow.setFullScreen(true);
    }
}


// ====== MAIN ====== //

(async () => {
    await app.whenReady();
    await createMainWindowWrap();
    app.on('activate', () => {
        if (electron.BrowserWindow.getAllWindows().length === 0) {
            createMainWindowWrap().then();
        }
    })
})();

