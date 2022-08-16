let {contextBridge, ipcRenderer} = require("electron");

contextBridge.exposeInMainWorld("api", {
    getId: () => ipcRenderer.sendSync("get-id"),
    onTCmd: (callback) => ipcRenderer.on("t-cmd", callback),
    onICmd: (callback) => ipcRenderer.on("i-cmd", callback),
    onMetaArrowUp: (callback) => ipcRenderer.on("meta-arrowup", callback),
    onMetaArrowDown: (callback) => ipcRenderer.on("meta-arrowdown", callback),
    onBracketCmd: (callback) => ipcRenderer.on("bracket-cmd", callback),
    onDigitCmd: (callback) => ipcRenderer.on("digit-cmd", callback),
    contextScreen: (screenOpts, position) => ipcRenderer.send("context-screen", screenOpts, position),
});
