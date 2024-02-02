let { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
    getId: () => ipcRenderer.sendSync("get-id"),
    getPlatform: () => ipcRenderer.sendSync("get-platform"),
    getIsDev: () => ipcRenderer.sendSync("get-isdev"),
    getAuthKey: () => ipcRenderer.sendSync("get-authkey"),
    getWaveSrvStatus: () => ipcRenderer.sendSync("wavesrv-status"),
    getLastLogs: (numberOfLines, callback) => {
        ipcRenderer.send("get-last-logs", numberOfLines);
        ipcRenderer.once("last-logs", (event, data) => callback(data));
    },
    restartWaveSrv: () => ipcRenderer.sendSync("restart-server"),
    reloadWindow: () => ipcRenderer.sendSync("reload-window"),
    openExternalLink: (url) => ipcRenderer.send("open-external-link", url),
    onTCmd: (callback) => ipcRenderer.on("t-cmd", callback),
    onICmd: (callback) => ipcRenderer.on("i-cmd", callback),
    onLCmd: (callback) => ipcRenderer.on("l-cmd", callback),
    onHCmd: (callback) => ipcRenderer.on("h-cmd", callback),
    onWCmd: (callback) => ipcRenderer.on("w-cmd", callback),
    onPCmd: (callback) => ipcRenderer.on("p-cmd", callback),
    onRCmd: (callback) => ipcRenderer.on("r-cmd", callback),
    onMetaArrowUp: (callback) => ipcRenderer.on("meta-arrowup", callback),
    onMetaArrowDown: (callback) => ipcRenderer.on("meta-arrowdown", callback),
    onMetaPageUp: (callback) => ipcRenderer.on("meta-pageup", callback),
    onMetaPageDown: (callback) => ipcRenderer.on("meta-pagedown", callback),
    onBracketCmd: (callback) => ipcRenderer.on("bracket-cmd", callback),
    onDigitCmd: (callback) => ipcRenderer.on("digit-cmd", callback),
    onMenuItemAbout: (callback) => ipcRenderer.on("menu-item-about", callback),
    contextScreen: (screenOpts, position) => ipcRenderer.send("context-screen", screenOpts, position),
    contextEditMenu: (position, opts) => ipcRenderer.send("context-editmenu", position, opts),
    onWaveSrvStatusChange: (callback) => ipcRenderer.on("wavesrv-status-change", callback),
});
