// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as electron from "electron";
import { fireAndForget } from "../frontend/util/util";
import { clearTabCache, getFocusedWaveWindow } from "./emain-viewmgr";
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

    const devToolsAccel = unamePlatform === "darwin" ? "Option+Command+I" : "Alt+Shift+I";
    const viewMenu: Electron.MenuItemConstructorOptions[] = [
        {
            label: "Reload Tab",
            accelerator: "Shift+CommandOrControl+R",
            click: (_, window) => {
                getWindowWebContents(window)?.reloadIgnoringCache();
            },
        },
        {
            label: "Relaunch All Windows",
            click: () => {
                callbacks.relaunchBrowserWindows();
            },
        },
        {
            label: "Clear Tab Cache",
            click: () => {
                clearTabCache();
            },
        },
        {
            label: "Toggle DevTools",
            accelerator: devToolsAccel,
            click: (_, window) => {
                let wc = getWindowWebContents(window);
                wc?.toggleDevTools();
            },
        },
        {
            type: "separator",
        },
        {
            label: "Actual Size",
            accelerator: "CommandOrControl+0",
            click: (_, window) => {
                getWindowWebContents(window)?.setZoomFactor(1);
            },
        },
        {
            label: "Zoom In",
            accelerator: "CommandOrControl+=",
            click: (_, window) => {
                const wc = getWindowWebContents(window);
                if (wc == null) {
                    return;
                }
                if (wc.getZoomFactor() >= 5) {
                    return;
                }
                wc.setZoomFactor(wc.getZoomFactor() + 0.2);
            },
        },
        {
            label: "Zoom In (hidden)",
            accelerator: "CommandOrControl+Shift+=",
            click: (_, window) => {
                const wc = getWindowWebContents(window);
                if (wc == null) {
                    return;
                }
                if (wc.getZoomFactor() >= 5) {
                    return;
                }
                wc.setZoomFactor(wc.getZoomFactor() + 0.2);
            },
            visible: false,
            acceleratorWorksWhenHidden: true,
        },
        {
            label: "Zoom Out",
            accelerator: "CommandOrControl+-",
            click: (_, window) => {
                const wc = getWindowWebContents(window);
                if (wc == null) {
                    return;
                }
                if (wc.getZoomFactor() <= 0.2) {
                    return;
                }
                wc.setZoomFactor(wc.getZoomFactor() - 0.2);
            },
        },
        {
            label: "Zoom Out (hidden)",
            accelerator: "CommandOrControl+Shift+-",
            click: (_, window) => {
                const wc = getWindowWebContents(window);
                if (wc == null) {
                    return;
                }
                if (wc.getZoomFactor() <= 0.2) {
                    return;
                }
                wc.setZoomFactor(wc.getZoomFactor() - 0.2);
            },
            visible: false,
            acceleratorWorksWhenHidden: true,
        },
        {
            type: "separator",
        },
        {
            role: "togglefullscreen",
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
