let {contextBridge, ipcRenderer} = require("electron");

contextBridge.exposeInMainWorld("api", {
    getId: () => ipcRenderer.sendSync("get-id"),
    onCmdT: (callback) => ipcRenderer.on("cmd-t"),
});
