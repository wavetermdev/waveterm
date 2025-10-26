// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ClientService } from "@/app/store/services";
import { RpcApi } from "@/app/store/wshclientapi";
import { BrowserWindow } from "electron";
import path from "path";
import { getElectronAppBasePath, isDevVite, unamePlatform } from "./emain-platform";
import { ElectronWshClient } from "./emain-wsh";

const tsunamiBuilderMap = new Map<string, BrowserWindow>();

export function getTsunamiBuilderById(builderId: string): BrowserWindow {
    return tsunamiBuilderMap.get(builderId);
}

export function getAllTsunamiBuilders(): BrowserWindow[] {
    return Array.from(tsunamiBuilderMap.values());
}

export async function createTsunamiBuilderWindow(appId: string): Promise<BrowserWindow> {
    const builderId = `builder-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

    const fullConfig = await RpcApi.GetFullConfigCommand(ElectronWshClient);
    const clientData = await ClientService.GetClientData();
    const clientId = clientData?.oid;
    const windowId = `window-builder-${builderId}`;

    const builderWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 800,
        minHeight: 600,
        titleBarStyle: unamePlatform === "darwin" ? "hiddenInset" : "default",
        icon:
            unamePlatform === "linux"
                ? path.join(getElectronAppBasePath(), "public/logos/wave-logo-dark.png")
                : undefined,
        show: false,
        backgroundColor: "#222222",
        webPreferences: {
            preload: path.join(getElectronAppBasePath(), "preload", "index.cjs"),
            webviewTag: true,
        },
    });

    if (isDevVite) {
        await builderWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/index.html`);
    } else {
        await builderWindow.loadFile(path.join(getElectronAppBasePath(), "frontend", "index.html"));
    }

    const initOpts: TsunamiBuilderInitOpts = {
        builderId,
        clientId,
        windowId,
        appId,
    };

    console.log("sending tsunami-builder-init", initOpts);
    builderWindow.webContents.send("tsunami-builder-init", initOpts);

    builderWindow.on("closed", () => {
        console.log("tsunami builder closed", builderId);
        tsunamiBuilderMap.delete(builderId);
    });

    tsunamiBuilderMap.set(builderId, builderWindow);
    builderWindow.show();

    console.log("created tsunami builder window", builderId, appId);
    return builderWindow;
}
