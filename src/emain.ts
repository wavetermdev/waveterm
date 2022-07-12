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

function createWindow() {
    let win = new electron.BrowserWindow({
        width: 1800,
        height: 1200,
        webPreferences: {
            preload: path.join(__dirname, "../src/preload.js"),
        },
    });
    win.loadFile("../static/index.html");
    win.webContents.on("before-input-event", (e, input) => {
        if (input.type != "keyDown") {
            return;
        }
        if (input.meta) {
            console.log("before-input", input.code, input.modifiers);
        }
        if (input.code == "KeyT" && input.meta) {
            win.webContents.send("cmd-t");
            e.preventDefault();
            return;
        }
        if (input.code == "BracketRight" && input.meta) {
            win.webContents.send("switch-screen", {relative: 1});
            e.preventDefault();
            return;
        }
        if (input.code == "BracketLeft" && input.meta) {
            win.webContents.send("switch-screen", {relative: -1});
            e.preventDefault();
            return;
        }
    });
    return win;
}

app.whenReady().then(() => {
    MainWindow = createWindow();

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


