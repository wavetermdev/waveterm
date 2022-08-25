import * as electron from "electron";
import {acquireSCElectronLock} from "./base";
import * as path from "path";
import * as fs from "fs";

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

function createWindow(size : {width : number, height : number}) {
    let win = new electron.BrowserWindow({
        width: size.width,
        height: size.height,
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
        if (input.code == "KeyR" && input.meta && input.alt) {
            createRemotesWindow();
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
    return win;
}

// primary display { width: 1680, height: 1050 }
app.whenReady().then(() => {
    let primaryDisplay = electron.screen.getPrimaryDisplay();
    let size = {width: 1800, height: 1200};
    if (primaryDisplay.size.width - 100 < size.width) {
        size.width = primaryDisplay.size.width - 100;
    }
    if (primaryDisplay.size.height - 100 < size.height) {
        size.height = primaryDisplay.size.height - 100;
    }
    MainWindow = createWindow(size);

    app.on('activate', () => {
        if (electron.BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    })
});

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

electron.ipcMain.on("context-screen", (event, {screenId}, {x, y}) => {
    console.log("context-screen", screenId);
    let menu = getContextMenu();
    menu.popup({x, y});
});



