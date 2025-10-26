// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ClientService } from "@/app/store/services";
import { RpcApi } from "@/app/store/wshclientapi";
import { BrowserWindow } from "electron";
import { globalEvents } from "emain/emain-events";
import path from "path";
import { getElectronAppBasePath, isDevVite, unamePlatform } from "./emain-platform";
import { calculateWindowBounds, MinWindowHeight, MinWindowWidth } from "./emain-window";
import { ElectronWshClient } from "./emain-wsh";

export type BuilderWindowType = BrowserWindow & {
    builderId: string;
    savedInitOpts: BuilderInitOpts;
};

const builderWindows: BuilderWindowType[] = [];
export let focusedBuilderWindow: BuilderWindowType = null;

export function getBuilderWindowById(builderId: string): BuilderWindowType {
    return builderWindows.find((win) => win.builderId === builderId);
}

export function getBuilderWindowByWebContentsId(webContentsId: number): BuilderWindowType {
    return builderWindows.find((win) => win.webContents.id === webContentsId);
}

export function getAllBuilderWindows(): BuilderWindowType[] {
    return builderWindows;
}

export async function createBuilderWindow(appId: string): Promise<BuilderWindowType> {
    const builderId = `builder-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

    const fullConfig = await RpcApi.GetFullConfigCommand(ElectronWshClient);
    const clientData = await ClientService.GetClientData();
    const clientId = clientData?.oid;
    const windowId = `window-builder-${builderId}`;

    const winBounds = calculateWindowBounds(undefined, undefined, fullConfig.settings);

    const builderWindow = new BrowserWindow({
        x: winBounds.x,
        y: winBounds.y,
        width: winBounds.width,
        height: winBounds.height,
        minWidth: MinWindowWidth,
        minHeight: MinWindowHeight,
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

    const initOpts: BuilderInitOpts = {
        builderId,
        clientId,
        windowId,
        appId,
    };

    const typedBuilderWindow = builderWindow as BuilderWindowType;
    typedBuilderWindow.builderId = builderId;
    typedBuilderWindow.savedInitOpts = initOpts;

    console.log("sending builder-init", initOpts);
    typedBuilderWindow.webContents.send("builder-init", initOpts);

    typedBuilderWindow.on("focus", () => {
        focusedBuilderWindow = typedBuilderWindow;
        console.log("builder window focused", builderId);
        setTimeout(() => globalEvents.emit("windows-updated"), 50);
    });

    typedBuilderWindow.on("blur", () => {
        if (focusedBuilderWindow === typedBuilderWindow) {
            focusedBuilderWindow = null;
        }
        setTimeout(() => globalEvents.emit("windows-updated"), 50);
    });

    typedBuilderWindow.on("closed", () => {
        console.log("builder window closed", builderId);
        const index = builderWindows.indexOf(typedBuilderWindow);
        if (index !== -1) {
            builderWindows.splice(index, 1);
        }
        if (focusedBuilderWindow === typedBuilderWindow) {
            focusedBuilderWindow = null;
        }
        setTimeout(() => globalEvents.emit("windows-updated"), 50);
    });

    builderWindows.push(typedBuilderWindow);
    typedBuilderWindow.show();

    console.log("created builder window", builderId, appId);
    return typedBuilderWindow;
}
