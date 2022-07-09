let {contextBridge, ipcRenderer} = require("electron");

console.log("RUNNING PRELOAD");

contextBridge.exposeInMainWorld("api", {
    relaunch: () => ipcRenderer.send("relaunch"),
});
