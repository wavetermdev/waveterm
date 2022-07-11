let {contextBridge, ipcRenderer} = require("electron");

console.log("RUNNING PRELOAD");

contextBridge.exposeInMainWorld("api", {
    getId: () => ipcRenderer.sendSync("get-id"),
    onCmdT: (callback) => ipcRenderer.on("cmd-t"),
});
