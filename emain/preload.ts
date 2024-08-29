// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
    getAuthKey: () => ipcRenderer.sendSync("get-auth-key"),
    getIsDev: () => ipcRenderer.sendSync("get-is-dev"),
    getPlatform: () => ipcRenderer.sendSync("get-platform"),
    getCursorPoint: () => ipcRenderer.sendSync("get-cursor-point"),
    getUserName: () => ipcRenderer.sendSync("get-user-name"),
    openNewWindow: () => ipcRenderer.send("open-new-window"),
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
    getEnv: (varName) => ipcRenderer.sendSync("get-env", varName),
    onFullScreenChange: (callback) =>
        ipcRenderer.on("fullscreen-change", (_event, isFullScreen) => callback(isFullScreen)),
    onUpdaterStatusChange: (callback) => ipcRenderer.on("app-update-status", (_event, status) => callback(status)),
    getUpdaterStatus: () => ipcRenderer.sendSync("get-app-update-status"),
    installAppUpdate: () => ipcRenderer.send("install-app-update"),
    onMenuItemAbout: (callback) => ipcRenderer.on("menu-item-about", callback),
    updateWindowControlsOverlay: (rect) => ipcRenderer.send("update-window-controls-overlay", rect),
    onReinjectKey: (callback) => ipcRenderer.on("reinject-key", (_event, waveEvent) => callback(waveEvent)),
    setWebviewFocus: (focused: number) => ipcRenderer.send("webview-focus", focused),
    registerGlobalWebviewKeys: (keys) => ipcRenderer.send("register-global-webview-keys", keys),
    onControlShiftStateUpdate: (callback) =>
        ipcRenderer.on("control-shift-state-update", (_event, state) => callback(state)),
});

// Custom event for "new-window"
ipcRenderer.on("webview-new-window", (e, webContentsId, details) => {
    const event = new CustomEvent("new-window", { detail: details });
    document.getElementById("webview").dispatchEvent(event);
});
