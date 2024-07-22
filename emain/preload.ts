// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

let { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
    getPlatform: () => ipcRenderer.sendSync("getPlatform"),
    getCursorPoint: () => ipcRenderer.sendSync("getCursorPoint"),
    openNewWindow: () => ipcRenderer.send("openNewWindow"),
    showContextMenu: (menu, position) => ipcRenderer.send("contextmenu-show", menu, position),
    onContextMenuClick: (callback) => ipcRenderer.on("contextmenu-click", (_event, id) => callback(id)),
    downloadFile: (filePath) => ipcRenderer.send("download", { filePath }),
    openExternal: (url) => {
        if (url && typeof url === "string") {
            ipcRenderer.send("open-external", url);
        } else {
            console.error("Invalid URL passed to openExternal:", url);
        }
    },
    getEnv: (varName) => ipcRenderer.sendSync("getEnv", varName),
    onFullScreenChange: (callback) =>
        ipcRenderer.on("fullscreen-change", (_event, isFullScreen) => callback(isFullScreen)),
});

// Custom event for "new-window"
ipcRenderer.on("webview-new-window", (e, webContentsId, details) => {
    const event = new CustomEvent("new-window", { detail: details });
    document.getElementById("webview").dispatchEvent(event);
});
