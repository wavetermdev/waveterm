let {contextBridge, ipcRenderer} = require("electron");

contextBridge.exposeInMainWorld("api", {
    getId: () => ipcRenderer.sendSync("get-id"),
    onCmdT: (callback) => ipcRenderer.on("cmd-t", callback),
    onSwitchScreen: (callback) => ipcRenderer.on("switch-screen", callback),
});
