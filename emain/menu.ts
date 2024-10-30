// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as electron from "electron";
import { fireAndForget } from "../frontend/util/util";
import { getFocusedWaveWindow } from "./emain-viewmgr";
import { unamePlatform } from "./platform";
import { updater } from "./updater";

type AppMenuCallbacks = {
    createNewWaveWindow: () => Promise<void>;
    relaunchBrowserWindows: () => Promise<void>;
    getLastFocusedWaveWindow: () => WaveBrowserWindow;
};

function getWindowWebContents(window: electron.BaseWindow): electron.WebContents {
    if (window == null) {
        return null;
    }
    if (window instanceof electron.BaseWindow) {
        const waveWin = window as WaveBrowserWindow;
        if (waveWin.activeTabView) {
            return waveWin.activeTabView.webContents;
        }
        return null;
    }
    return null;
}

function getAppMenu(callbacks: AppMenuCallbacks): Electron.Menu {
    const fileMenu: Electron.MenuItemConstructorOptions[] = [
        {
            label: "New Window",
            accelerator: "CommandOrControl+Shift+N",
            click: () => fireAndForget(callbacks.createNewWaveWindow),
        },
        {
            role: "close",
            accelerator: "", // clear the accelerator
            click: () => {
                getFocusedWaveWindow()?.close();
            },
        },
    ];
    const appMenu: Electron.MenuItemConstructorOptions[] = [
        {
            label: "About Wave Terminal",
            click: (_, window) => {
                getWindowWebContents(window)?.send("menu-item-about");
            },
        },
        {
            label: "Check for Updates",
            click: () => {
                fireAndForget(() => updater?.checkForUpdates(true));
            },
        },
        {
            type: "separator",
        },
    ];
    if (unamePlatform === "darwin") {
        appMenu.push(
            {
                role: "services",
            },
            {
                type: "separator",
            },
            {
                role: "hide",
            },
            {
                role: "hideOthers",
            },
            {
                type: "separator",
            }
        );
    }
    appMenu.push({
        role: "quit",
    });
    const editMenu: Electron.MenuItemConstructorOptions[] = [
        {
            role: "undo",
            accelerator: unamePlatform === "darwin" ? "Command+Z" : "",
        },
        {
            role: "redo",
            accelerator: unamePlatform === "darwin" ? "Command+Shift+Z" : "",
        },
        {
            type: "separator",
        },
        {
            role: "cut",
            accelerator: unamePlatform === "darwin" ? "Command+X" : "",
        },
        {
            role: "copy",
            accelerator: unamePlatform === "darwin" ? "Command+C" : "",
        },
        {
            role: "paste",
            accelerator: unamePlatform === "darwin" ? "Command+V" : "",
        },
        {
            role: "pasteAndMatchStyle",
            accelerator: unamePlatform === "darwin" ? "Command+Shift+V" : "",
        },
        {
            role: "delete",
        },
        {
            role: "selectAll",
            accelerator: unamePlatform === "darwin" ? "Command+A" : "",
        },
    ];

    const devToolsAccel = unamePlatform === "darwin" ? "Option+Command+I" : "Alt+Meta+I";
    const viewMenu: Electron.MenuItemConstructorOptions[] = [
        {
            label: "Toggle DevTools",
            accelerator: devToolsAccel,
            click: (_, window) => {
                let wc = getWindowWebContents(window);
                wc?.toggleDevTools();
            },
        },
    ];
    const windowMenu: Electron.MenuItemConstructorOptions[] = [
        { role: "minimize", accelerator: "" },
        { role: "zoom" },
        { type: "separator" },
        { role: "front" },
        { type: "separator" },
        { role: "window" },
    ];
    const menuTemplate: Electron.MenuItemConstructorOptions[] = [
        {
            role: "appMenu",
            submenu: appMenu,
        },
        {
            role: "fileMenu",
            submenu: fileMenu,
        },
        {
            role: "editMenu",
            submenu: editMenu,
        },
        {
            role: "viewMenu",
            submenu: viewMenu,
        },
        {
            role: "windowMenu",
            submenu: windowMenu,
        },
    ];
    return electron.Menu.buildFromTemplate(menuTemplate);
}

export { getAppMenu };
