// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ipcMain } from "electron";

const docsiteUrl = "https://docs.waveterm.dev/";

ipcMain.on("get-docsite-url", (event) => {
    event.returnValue = docsiteUrl;
});

export function initDocsite() {
    console.log("Using live docsite at", docsiteUrl);
}
