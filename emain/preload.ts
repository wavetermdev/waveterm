// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

let { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
    isDev: () => ipcRenderer.sendSync("isDev"),
    isDevServer: () => ipcRenderer.sendSync("isDevServer"),
    getPlatform: () => ipcRenderer.sendSync("getPlatform"),
    getCursorPoint: () => ipcRenderer.sendSync("getCursorPoint"),
    openNewWindow: () => ipcRenderer.send("openNewWindow"),
    showContextMenu: (menu, position) => ipcRenderer.send("contextmenu-show", menu, position),
    onContextMenuClick: (callback) => ipcRenderer.on("contextmenu-click", callback),
});
