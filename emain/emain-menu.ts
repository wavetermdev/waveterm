// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { waveEventSubscribe } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import * as electron from "electron";
import { fireAndForget } from "../frontend/util/util";
import { createTsunamiBuilderWindow } from "./emain-builder";
import { isDev, unamePlatform } from "./emain-platform";
import { clearTabCache } from "./emain-tabview";
import {
    createNewWaveWindow,
    createWorkspace,
    focusedWaveWindow,
    getAllWaveWindows,
    getWaveWindowByWorkspaceId,
    relaunchBrowserWindows,
    WaveBrowserWindow,
} from "./emain-window";
import { ElectronWshClient } from "./emain-wsh";
import { updater } from "./updater";

type AppMenuCallbacks = {
    createNewWaveWindow: () => Promise<void>;
    relaunchBrowserWindows: () => Promise<void>;
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

async function getWorkspaceMenu(ww?: WaveBrowserWindow): Promise<Electron.MenuItemConstructorOptions[]> {
    const workspaceList = await RpcApi.WorkspaceListCommand(ElectronWshClient);
    const workspaceMenu: Electron.MenuItemConstructorOptions[] = [
        {
            label: "Create Workspace",
            click: (_, window) => fireAndForget(() => createWorkspace((window as WaveBrowserWindow) ?? ww)),
        },
    ];
    function getWorkspaceSwitchAccelerator(i: number): string {
        if (i < 9) {
            return unamePlatform == "darwin" ? `Command+Control+${i + 1}` : `Alt+Control+${i + 1}`;
        }
    }
    workspaceList?.length &&
        workspaceMenu.push(
            { type: "separator" },
            ...workspaceList.map<Electron.MenuItemConstructorOptions>((workspace, i) => {
                return {
                    label: `${workspace.workspacedata.name}`,
                    click: (_, window) => {
                        ((window as WaveBrowserWindow) ?? ww)?.switchWorkspace(workspace.workspacedata.oid);
                    },
                    accelerator: getWorkspaceSwitchAccelerator(i),
                };
            })
        );
    return workspaceMenu;
}

async function getAppMenu(
    numWaveWindows: number,
    callbacks: AppMenuCallbacks,
    workspaceId?: string
): Promise<Electron.Menu> {
    const ww = workspaceId && getWaveWindowByWorkspaceId(workspaceId);
    const fileMenu: Electron.MenuItemConstructorOptions[] = [
        {
            label: "New Window",
            accelerator: "CommandOrControl+Shift+N",
            click: () => fireAndForget(callbacks.createNewWaveWindow),
        },
        {
            role: "close",
            accelerator: "",
            click: () => {
                focusedWaveWindow?.close();
            },
        },
    ];
    if (isDev) {
        fileMenu.splice(1, 0, {
            label: "New Tsunami App",
            click: () => fireAndForget(() => createTsunamiBuilderWindow("<new>")),
        });
    }
    if (numWaveWindows == 0) {
        fileMenu.push({
            label: "New Window (hidden-1)",
            accelerator: unamePlatform === "darwin" ? "Command+N" : "Alt+N",
            acceleratorWorksWhenHidden: true,
            visible: false,
            click: () => fireAndForget(callbacks.createNewWaveWindow),
        });
        fileMenu.push({
            label: "New Window (hidden-2)",
            accelerator: unamePlatform === "darwin" ? "Command+T" : "Alt+T",
            acceleratorWorksWhenHidden: true,
            visible: false,
            click: () => fireAndForget(callbacks.createNewWaveWindow),
        });
    }
    const appMenu: Electron.MenuItemConstructorOptions[] = [
        {
            label: "About Wave Terminal",
            click: (_, window) => {
                getWindowWebContents(window ?? ww)?.send("menu-item-about");
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
                getWindowWebContents(window ?? ww)?.reloadIgnoringCache();
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
                let wc = getWindowWebContents(window ?? ww);
                wc?.toggleDevTools();
            },
        },
        {
            type: "separator",
        },
        {
            label: "Reset Zoom",
            accelerator: "CommandOrControl+0",
            click: (_, window) => {
                const wc = getWindowWebContents(window ?? ww);
                if (wc) {
                    wc.setZoomFactor(1);
                    wc.send("zoom-factor-change", 1);
                }
            },
        },
        {
            label: "Zoom In",
            accelerator: "CommandOrControl+=",
            click: (_, window) => {
                const wc = getWindowWebContents(window ?? ww);
                if (wc == null) {
                    return;
                }
                const newZoom = Math.min(5, wc.getZoomFactor() + 0.2);
                wc.setZoomFactor(newZoom);
                wc.send("zoom-factor-change", newZoom);
            },
        },
        {
            label: "Zoom In (hidden)",
            accelerator: "CommandOrControl+Shift+=",
            click: (_, window) => {
                const wc = getWindowWebContents(window ?? ww);
                if (wc == null) {
                    return;
                }
                const newZoom = Math.min(5, wc.getZoomFactor() + 0.2);
                wc.setZoomFactor(newZoom);
                wc.send("zoom-factor-change", newZoom);
            },
            visible: false,
            acceleratorWorksWhenHidden: true,
        },
        {
            label: "Zoom Out",
            accelerator: "CommandOrControl+-",
            click: (_, window) => {
                const wc = getWindowWebContents(window ?? ww);
                if (wc == null) {
                    return;
                }
                const newZoom = Math.max(0.2, wc.getZoomFactor() - 0.2);
                wc.setZoomFactor(newZoom);
                wc.send("zoom-factor-change", newZoom);
            },
        },
        {
            label: "Zoom Out (hidden)",
            accelerator: "CommandOrControl+Shift+-",
            click: (_, window) => {
                const wc = getWindowWebContents(window ?? ww);
                if (wc == null) {
                    return;
                }
                const newZoom = Math.max(0.2, wc.getZoomFactor() - 0.2);
                wc.setZoomFactor(newZoom);
                wc.send("zoom-factor-change", newZoom);
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
    let workspaceMenu: Electron.MenuItemConstructorOptions[] = null;
    try {
        workspaceMenu = await getWorkspaceMenu();
    } catch (e) {
        console.error("getWorkspaceMenu error:", e);
    }
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
    ];
    if (workspaceMenu != null) {
        menuTemplate.push({
            label: "Workspace",
            id: "workspace-menu",
            submenu: workspaceMenu,
        });
    }
    menuTemplate.push({
        role: "windowMenu",
        submenu: windowMenu,
    });
    return electron.Menu.buildFromTemplate(menuTemplate);
}

export function instantiateAppMenu(numWindows: number, workspaceId?: string): Promise<electron.Menu> {
    return getAppMenu(
        numWindows,
        {
            createNewWaveWindow,
            relaunchBrowserWindows,
        },
        workspaceId
    );
}

export function makeAppMenu() {
    fireAndForget(async () => {
        const wwCount = getAllWaveWindows().length;
        const menu = await instantiateAppMenu(wwCount);
        electron.Menu.setApplicationMenu(menu);
    });
}

waveEventSubscribe({
    eventType: "workspace:update",
    handler: makeAppMenu,
});

function convertMenuDefArrToMenu(workspaceId: string, menuDefArr: ElectronContextMenuItem[]): electron.Menu {
    const menuItems: electron.MenuItem[] = [];
    for (const menuDef of menuDefArr) {
        const menuItemTemplate: electron.MenuItemConstructorOptions = {
            role: menuDef.role as any,
            label: menuDef.label,
            type: menuDef.type,
            click: (_, window) => {
                const ww = (window as WaveBrowserWindow) ?? getWaveWindowByWorkspaceId(workspaceId);
                if (!ww) {
                    console.error("invalid window for context menu click handler:", ww, window, workspaceId);
                    return;
                }
                ww?.activeTabView?.webContents?.send("contextmenu-click", menuDef.id);
            },
            checked: menuDef.checked,
        };
        if (menuDef.submenu != null) {
            menuItemTemplate.submenu = convertMenuDefArrToMenu(workspaceId, menuDef.submenu);
        }
        const menuItem = new electron.MenuItem(menuItemTemplate);
        menuItems.push(menuItem);
    }
    return electron.Menu.buildFromTemplate(menuItems);
}

electron.ipcMain.on("contextmenu-show", (event, workspaceId: string, menuDefArr?: ElectronContextMenuItem[]) => {
    if (menuDefArr?.length === 0) {
        return;
    }
    const wwCount = getAllWaveWindows().length;
    fireAndForget(async () => {
        const menu = menuDefArr
            ? convertMenuDefArrToMenu(workspaceId, menuDefArr)
            : await instantiateAppMenu(wwCount, workspaceId);
        menu.popup();
    });
    event.returnValue = true;
});

const dockMenu = electron.Menu.buildFromTemplate([
    {
        label: "New Window",
        click() {
            fireAndForget(createNewWaveWindow);
        },
    },
]);

function makeDockTaskbar() {
    if (unamePlatform == "darwin") {
        electron.app.dock.setMenu(dockMenu);
    }
}

export { getAppMenu, makeDockTaskbar };
