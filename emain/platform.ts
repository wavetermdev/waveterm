// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { app, ipcMain } from "electron";
import { existsSync, mkdirSync } from "fs";
import os from "os";
import path from "path";
import { WaveDevVarName, WaveDevViteVarName } from "../frontend/util/isdev";
import * as keyutil from "../frontend/util/keyutil";

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

const WaveConfigHomeVarName = "WAVETERM_CONFIG_HOME";
const WaveDataHomeVarName = "WAVETERM_DATA_HOME";
const WaveHomeVarName = "WAVETERM_HOME";

function getWaveDirName(): string {
    return isDev ? "waveterm-dev" : "waveterm";
}

function getWaveHomeDir(): string {
    let home = process.env[WaveHomeVarName];
    if (!home) {
        const homeDir = process.env.HOME;
        if (homeDir) {
            home = path.join(homeDir, `.${getWaveDirName()}`);
        }
    }
    if (!!home && existsSync(home)) {
        return home;
    }
    return null;
}

function ensurePathExists(path: string): string {
    if (!existsSync(path)) {
        mkdirSync(path, { recursive: true });
    }
    return path;
}

function getWaveConfigDir(): string {
    // If wave home dir exists, use it for backwards compatibility
    const waveHomeDir = getWaveHomeDir();
    if (waveHomeDir) {
        return path.join(waveHomeDir, "config");
    }

    const override = process.env[WaveConfigHomeVarName];
    let retVal: string;
    if (override) {
        retVal = override;
    } else if (unamePlatform === "win32") {
        retVal = path.join(process.env.LOCALAPPDATA, getWaveDirName(), "config");
    } else {
        const configHome = process.env.XDG_CONFIG_HOME;
        if (configHome) {
            retVal = path.join(configHome, getWaveDirName());
        } else {
            retVal = path.join(process.env.HOME, ".config", getWaveDirName());
        }
    }
    return ensurePathExists(retVal);
}

function getWaveDataDir(): string {
    // If wave home dir exists, use it for backwards compatibility
    const waveHomeDir = getWaveHomeDir();
    if (waveHomeDir) {
        return waveHomeDir;
    }

    const override = process.env[WaveDataHomeVarName];
    let retVal: string;
    if (override) {
        retVal = override;
    } else if (unamePlatform === "win32") {
        retVal = path.join(process.env.LOCALAPPDATA, getWaveDirName(), "data");
    } else {
        const configHome = process.env.XDG_DATA_HOME;
        if (configHome) {
            retVal = path.join(configHome, getWaveDirName());
        } else {
            retVal = path.join(process.env.HOME, ".local", "share", getWaveDirName());
        }
    }
    return ensurePathExists(retVal);
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
    return getWaveDataDir();
}

export {
    getElectronAppBasePath,
    getElectronAppUnpackedBasePath,
    getWaveConfigDir,
    getWaveDataDir,
    getWaveSrvCwd,
    getWaveSrvPath,
    isDev,
    isDevVite,
    unameArch,
    unamePlatform,
    WaveConfigHomeVarName,
    WaveDataHomeVarName,
};
