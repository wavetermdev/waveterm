// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import electron from "electron";
import { RpcResponseHelper, WshClient } from "../frontend/app/store/wshclient";
import { getWebContentsByBlockId, webGetSelector } from "./emain-web";

type WaveBrowserWindow = Electron.BrowserWindow & { waveWindowId: string; readyPromise: Promise<void> };

export class ElectronWshClientType extends WshClient {
    constructor() {
        super("electron");
    }

    async handle_webselector(rh: RpcResponseHelper, data: CommandWebSelectorData): Promise<string[]> {
        if (!data.tabid || !data.blockid || !data.windowid) {
            throw new Error("tabid and blockid are required");
        }
        const windows = electron.BrowserWindow.getAllWindows();
        const win = windows.find((w) => (w as WaveBrowserWindow).waveWindowId === data.windowid);
        if (win == null) {
            throw new Error(`no window found with id ${data.windowid}`);
        }
        const wc = await getWebContentsByBlockId(win, data.tabid, data.blockid);
        if (wc == null) {
            throw new Error(`no webcontents found with blockid ${data.blockid}`);
        }
        const rtn = await webGetSelector(wc, data.selector, data.opts);
        return rtn;
    }
}
