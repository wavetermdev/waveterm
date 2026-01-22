// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ClientService } from "@/app/store/services";
import { RpcApi } from "@/app/store/wshclientapi";
import { randomUUID } from "crypto";
import { BrowserWindow } from "electron";
import { globalEvents } from "emain/emain-events";
import path from "path";
import { getElectronAppBasePath, isDevVite, unamePlatform } from "./emain-platform";
import { calculateWindowBounds, MinWindowHeight, MinWindowWidth } from "./emain-window";
import { ElectronWshClient } from "./emain-wsh";

export type BuilderWindowType = BrowserWindow & {
    builderId: string;
    builderAppId?: string;
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
    const builderId = randomUUID();

    const fullConfig = await RpcApi.GetFullConfigCommand(ElectronWshClient);
    const clientData = await ClientService.GetClientData();
    const clientId = clientData?.oid;
    const windowId = randomUUID();

    if (appId) {
        const oref = `builder:${builderId}`;
        await RpcApi.SetRTInfoCommand(ElectronWshClient, {
            oref,
            data: { "builder:appid": appId },
        });
    }

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
    };

    const typedBuilderWindow = builderWindow as BuilderWindowType;
    typedBuilderWindow.builderId = builderId;
    typedBuilderWindow.builderAppId = appId;
    typedBuilderWindow.savedInitOpts = initOpts;

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
        RpcApi.DeleteBuilderCommand(ElectronWshClient, builderId, { noresponse: true });
        setTimeout(() => globalEvents.emit("windows-updated"), 50);
    });

    builderWindows.push(typedBuilderWindow);
    typedBuilderWindow.show();

    console.log("created builder window", builderId, appId);
    return typedBuilderWindow;
}
