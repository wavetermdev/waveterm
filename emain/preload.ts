// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

let { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
    isDev: () => ipcRenderer.sendSync("isDev"),
    isDevServer: () => ipcRenderer.sendSync("isDevServer"),
    getCursorPoint: () => ipcRenderer.sendSync("getCursorPoint"),
});
