let {contextBridge, ipcRenderer} = require("electron");

contextBridge.exposeInMainWorld("api", {
    getId: () => ipcRenderer.sendSync("get-id"),
    getIsDev: () => ipcRenderer.sendSync("get-isdev"),
    getAuthKey: () => ipcRenderer.sendSync("get-authkey"),
    getLocalServerStatus: () => ipcRenderer.sendSync("local-server-status"),
    restartLocalServer: () => ipcRenderer.sendSync("restart-server"),
    onTCmd: (callback) => ipcRenderer.on("t-cmd", callback),
    onICmd: (callback) => ipcRenderer.on("i-cmd", callback),
    onLCmd: (callback) => ipcRenderer.on("l-cmd", callback),
    onHCmd: (callback) => ipcRenderer.on("h-cmd", callback),
    onWCmd: (callback) => ipcRenderer.on("w-cmd", callback),
    onMetaArrowUp: (callback) => ipcRenderer.on("meta-arrowup", callback),
    onMetaArrowDown: (callback) => ipcRenderer.on("meta-arrowdown", callback),
    onMetaPageUp: (callback) => ipcRenderer.on("meta-pageup", callback),
    onMetaPageDown: (callback) => ipcRenderer.on("meta-pagedown", callback),
    onBracketCmd: (callback) => ipcRenderer.on("bracket-cmd", callback),
    onDigitCmd: (callback) => ipcRenderer.on("digit-cmd", callback),
    contextScreen: (screenOpts, position) => ipcRenderer.send("context-screen", screenOpts, position),
    contextEditMenu: (position) => ipcRenderer.send("context-editmenu", position),
    onLocalServerStatusChange: (callback) => ipcRenderer.on("local-server-status-change", callback),
});
