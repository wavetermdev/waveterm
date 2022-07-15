let {contextBridge, ipcRenderer} = require("electron");

contextBridge.exposeInMainWorld("api", {
    getId: () => ipcRenderer.sendSync("get-id"),
    onTCmd: (callback) => ipcRenderer.on("t-cmd", callback),
    onICmd: (callback) => ipcRenderer.on("i-cmd", callback),
    onBracketCmd: (callback) => ipcRenderer.on("bracket-cmd", callback),
    onDigitCmd: (callback) => ipcRenderer.on("digit-cmd", callback),
});
