// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WaveDevVarName, WaveDevViteVarName } from "@/util/isdev";
import { app, ipcMain } from "electron";
import os from "os";
import path from "path";
import * as keyutil from "../frontend/util/keyutil";

const isDev = !app.isPackaged;
const isDevVite = isDev && process.env.ELECTRON_RENDERER_URL;
if (isDev) {
    process.env[WaveDevVarName] = "1";
}
if (isDevVite) {
    process.env[WaveDevViteVarName] = "1";
}

app.setName(isDev ? "TheNextWave (Dev)" : "TheNextWave");
const unamePlatform = process.platform;
const unameArch: string = process.arch;
keyutil.setKeyUtilPlatform(unamePlatform);

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

// must match golang
function getWaveHomeDir() {
    return path.join(os.homedir(), isDev ? ".w2-dev" : ".w2");
}

function getElectronAppBasePath(): string {
    return path.dirname(__dirname);
}

function getGoAppBasePath(): string {
    return getElectronAppBasePath().replace("app.asar", "app.asar.unpacked");
}

const wavesrvBinName = `wavesrv.${unameArch}`;

function getWaveSrvPath(): string {
    if (process.platform === "win32") {
        const winBinName = `${wavesrvBinName}.exe`;
        const appPath = path.join(getGoAppBasePath(), "bin", winBinName);
        return `${appPath}`;
    }
    return path.join(getGoAppBasePath(), "bin", wavesrvBinName);
}

function getWaveSrvCwd(): string {
    return getWaveHomeDir();
}

export {
    getElectronAppBasePath,
    getGoAppBasePath,
    getWaveHomeDir,
    getWaveSrvCwd,
    getWaveSrvPath,
    isDev,
    isDevVite,
    unameArch,
    unamePlatform,
};
