// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { app, ipcMain } from "electron";
import os from "os";
import path from "path";
import { WaveDevVarName, WaveDevViteVarName } from "../frontend/util/isdev";
import * as keyutil from "../frontend/util/keyutil";

const WaveHomeVarName = "WAVETERM_HOME";

const isDev = !app.isPackaged;
const isDevVite = isDev && process.env.ELECTRON_RENDERER_URL;
if (isDev) {
    process.env[WaveDevVarName] = "1";
}
if (isDevVite) {
    process.env[WaveDevViteVarName] = "1";
}

app.setName(isDev ? "Wave (Dev)" : "Wave");
const unamePlatform = process.platform;
const unameArch: string = process.arch;
keyutil.setKeyUtilPlatform(unamePlatform);

// must match golang
function getWaveHomeDir() {
    const override = process.env[WaveHomeVarName];
    if (override) {
        return override;
    }
    return path.join(os.homedir(), isDev ? ".waveterm-dev" : ".waveterm");
}

function getElectronAppBasePath(): string {
    return path.dirname(import.meta.dirname);
}

function getElectronAppUnpackedBasePath(): string {
    return getElectronAppBasePath().replace("app.asar", "app.asar.unpacked");
}

const wavesrvBinName = `wavesrv.${unameArch}`;

function getWaveSrvPath(): string {
    if (process.platform === "win32") {
        const winBinName = `${wavesrvBinName}.exe`;
        const appPath = path.join(getElectronAppUnpackedBasePath(), "bin", winBinName);
        return `${appPath}`;
    }
    return path.join(getElectronAppUnpackedBasePath(), "bin", wavesrvBinName);
}

function getWaveSrvCwd(): string {
    return getWaveHomeDir();
}

ipcMain.on("get-is-dev", (event) => {
    event.returnValue = isDev;
});
ipcMain.on("get-platform", (event, url) => {
    event.returnValue = unamePlatform;
});
ipcMain.on("get-user-name", (event) => {
    const userInfo = os.userInfo();
    event.returnValue = userInfo.username;
});
ipcMain.on("get-host-name", (event) => {
    event.returnValue = os.hostname();
});
ipcMain.on("get-webview-preload", (event) => {
    event.returnValue = path.join(getElectronAppBasePath(), "preload", "preload-webview.cjs");
});
ipcMain.on("get-config-dir", (event) => {
    event.returnValue = path.join(getWaveHomeDir(), "config");
});

export {
    getElectronAppBasePath,
    getElectronAppUnpackedBasePath,
    getWaveHomeDir,
    getWaveSrvCwd,
    getWaveSrvPath,
    isDev,
    isDevVite,
    unameArch,
    unamePlatform,
};
