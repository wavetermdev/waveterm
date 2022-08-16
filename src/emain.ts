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

function getMods(input : any) {
    return {meta: input.meta, shift: input.shift, ctrl: input.ctrl, alt: input.alt};
}

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



