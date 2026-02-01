// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WindowService } from "@/app/store/services";
import { RpcResponseHelper, WshClient } from "@/app/store/wshclient";
import { RpcApi } from "@/app/store/wshclientapi";
import { Notification, net, safeStorage, shell } from "electron";
import { getResolvedUpdateChannel } from "emain/updater";
import { getWebCdpProxyStatus, startWebCdpProxy, stopWebCdpProxyForTarget } from "./emain-cdp";
import { unamePlatform } from "./emain-platform";
import { getWebContentsByBlockId, webGetSelector } from "./emain-web";
import { createBrowserWindow, getWaveWindowById, getWaveWindowByWorkspaceId } from "./emain-window";

export class ElectronWshClientType extends WshClient {
    constructor() {
        super("electron");
    }

    async handle_webselector(rh: RpcResponseHelper, data: CommandWebSelectorData): Promise<string[]> {
        if (!data.tabid || !data.blockid || !data.workspaceid) {
            throw new Error("tabid and blockid are required");
        }
        const ww = getWaveWindowByWorkspaceId(data.workspaceid);
        if (ww == null) {
            throw new Error(`no window found with workspace ${data.workspaceid}`);
        }
        const wc = await getWebContentsByBlockId(ww, data.tabid, data.blockid);
        if (wc == null) {
            throw new Error(`no webcontents found with blockid ${data.blockid}`);
        }
        const rtn = await webGetSelector(wc, data.selector, data.opts);
        return rtn;
    }

    async handle_webcdpstart(rh: RpcResponseHelper, data: CommandWebCdpStartData): Promise<CommandWebCdpStartRtnData> {
        if (!data.tabid || !data.blockid || !data.workspaceid) {
            throw new Error("workspaceid, tabid and blockid are required");
        }
        const fullConfig = await RpcApi.GetFullConfigCommand(ElectronWshClient);
        if (!fullConfig?.settings?.["debug:webcdp"]) {
            throw new Error("web cdp is disabled (enable debug:webcdp in settings.json)");
        }
        const ww = getWaveWindowByWorkspaceId(data.workspaceid);
        if (ww == null) {
            throw new Error(`no window found with workspace ${data.workspaceid}`);
        }
        const wc = await getWebContentsByBlockId(ww, data.tabid, data.blockid);
        if (wc == null) {
            throw new Error(`no webcontents found with blockid ${data.blockid}`);
        }
        console.log("webcdpstart", data.workspaceid, data.tabid, data.blockid, "port=", data.port);
        const info = await startWebCdpProxy(wc, data.workspaceid, data.tabid, data.blockid, {
            port: data.port,
            idleTimeoutMs: data.idletimeoutms,
        });
        return {
            host: info.host,
            port: info.port,
            wsurl: info.wsUrl,
            inspectorurl: info.inspectorUrl,
            targetid: info.targetid,
        };
    }

    async handle_webcdpstop(rh: RpcResponseHelper, data: CommandWebCdpStopData): Promise<void> {
        if (!data.tabid || !data.blockid || !data.workspaceid) {
            throw new Error("workspaceid, tabid and blockid are required");
        }
        console.log("webcdpstop", data.workspaceid, data.tabid, data.blockid);
        await stopWebCdpProxyForTarget(data.workspaceid, data.tabid, data.blockid);
    }

    async handle_webcdpstatus(rh: RpcResponseHelper): Promise<WebCdpStatusEntry[]> {
        const status = getWebCdpProxyStatus();
        return status.map((s) => ({
            key: s.key,
            workspaceid: s.workspaceid,
            tabid: s.tabid,
            blockid: s.blockid,
            host: s.host,
            port: s.port,
            wsurl: s.wsUrl,
            inspectorurl: s.inspectorUrl,
            targetid: s.targetid,
        }));
    }

    async handle_notify(rh: RpcResponseHelper, notificationOptions: WaveNotificationOptions) {
        new Notification({
            title: notificationOptions.title,
            body: notificationOptions.body,
            silent: notificationOptions.silent,
        }).show();
    }

    async handle_getupdatechannel(rh: RpcResponseHelper): Promise<string> {
        return getResolvedUpdateChannel();
    }

    async handle_focuswindow(rh: RpcResponseHelper, windowId: string) {
        console.log(`focuswindow ${windowId}`);
        const fullConfig = await RpcApi.GetFullConfigCommand(ElectronWshClient);
        let ww = getWaveWindowById(windowId);
        if (ww == null) {
            const window = await WindowService.GetWindow(windowId);
            if (window == null) {
                throw new Error(`window ${windowId} not found`);
            }
            ww = await createBrowserWindow(window, fullConfig, {
                unamePlatform,
                isPrimaryStartupWindow: false,
            });
        }
        ww.focus();
    }

    async handle_electronencrypt(
        rh: RpcResponseHelper,
        data: CommandElectronEncryptData
    ): Promise<CommandElectronEncryptRtnData> {
        if (!safeStorage.isEncryptionAvailable()) {
            throw new Error("encryption is not available");
        }
        const encrypted = safeStorage.encryptString(data.plaintext);
        const ciphertext = encrypted.toString("base64");

        let storagebackend = "";
        if (process.platform === "linux") {
            storagebackend = safeStorage.getSelectedStorageBackend();
        }

        return {
            ciphertext,
            storagebackend,
        };
    }

    async handle_electrondecrypt(
        rh: RpcResponseHelper,
        data: CommandElectronDecryptData
    ): Promise<CommandElectronDecryptRtnData> {
        if (!safeStorage.isEncryptionAvailable()) {
            throw new Error("encryption is not available");
        }
        const encrypted = Buffer.from(data.ciphertext, "base64");
        const plaintext = safeStorage.decryptString(encrypted);

        let storagebackend = "";
        if (process.platform === "linux") {
            storagebackend = safeStorage.getSelectedStorageBackend();
        }

        return {
            plaintext,
            storagebackend,
        };
    }

    async handle_networkonline(rh: RpcResponseHelper): Promise<boolean> {
        return net.isOnline();
    }

    async handle_electronsystembell(rh: RpcResponseHelper): Promise<void> {
        shell.beep();
    }

    // async handle_workspaceupdate(rh: RpcResponseHelper) {
    //     console.log("workspaceupdate");
    //     fireAndForget(async () => {
    //         console.log("workspace menu clicked");
    //         const updatedWorkspaceMenu = await getWorkspaceMenu();
    //         const workspaceMenu = Menu.getApplicationMenu().getMenuItemById("workspace-menu");
    //         workspaceMenu.submenu = Menu.buildFromTemplate(updatedWorkspaceMenu);
    //     });
    // }
}

export let ElectronWshClient: ElectronWshClientType;

export function initElectronWshClient() {
    ElectronWshClient = new ElectronWshClientType();
}
