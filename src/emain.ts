import * as electron from "electron";
import {acquireSCElectronLock} from "./base";
import * as path from "path";
import * as fs from "fs";

let app = electron.app;
app.setAppLogsPath(__dirname, "../logs");

let lock : File;
try {
    lock = acquireSCElectronLock();
}
catch (e) {
    app.exit(0);
}

console.log("ACQUIRED LOCK");

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
    return win;
}

app.whenReady().then(() => {
    MainWindow = createWindow();
    MainWindow.webContents.openDevTools();

    app.on('activate', () => {
        if (electron.BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    })
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
});

electron.ipcMain.on("relaunch", (event) => {
    console.log("RELAUNCH!");
    app.relaunch();
    app.exit(0);
    console.log("test", event);
});

