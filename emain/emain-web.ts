// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ipcMain, webContents, WebContents } from "electron";
import { getWaveTabView } from "./emain-tabview";
import { WaveBrowserWindow } from "./emain-window";
import { isUsableWebContentsId, tabNotLoadedError } from "./web-agent-pure";

const WebContentsLookupTimeoutMs = 5000;
const WebContentsLookupPollMs = 200;

export function getWebContentsByBlockId(ww: WaveBrowserWindow, tabId: string, blockId: string): Promise<WebContents> {
    const tabView = getWaveTabView(tabId) ?? ww?.allLoadedTabViews?.get(tabId);
    if (tabView == null || tabView.webContents == null || tabView.webContents.isDestroyed()) {
        return Promise.reject(tabNotLoadedError(blockId));
    }
    return new Promise<WebContents>((resolve, reject) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let poll: ReturnType<typeof setInterval> | undefined;
        const randId = Math.floor(Math.random() * 1000000000).toString();
        const respCh = `getWebContentsByBlockId-${randId}`;
        const finish = (err: Error | null, wc?: WebContents) => {
            if (settled) {
                return;
            }
            settled = true;
            if (timer != null) {
                clearTimeout(timer);
            }
            if (poll != null) {
                clearInterval(poll);
            }
            ipcMain.removeAllListeners(respCh);
            if (err) {
                reject(err);
                return;
            }
            resolve(wc);
        };
        const trySend = () => {
            if (settled) {
                return;
            }
            if (tabView.webContents == null || tabView.webContents.isDestroyed()) {
                finish(tabNotLoadedError(blockId));
                return;
            }
            try {
                tabView.webContents.send("webcontentsid-from-blockid", blockId, respCh);
            } catch (err) {
                finish(err instanceof Error ? err : new Error(String(err)));
            }
        };
        timer = setTimeout(() => {
            finish(tabNotLoadedError(blockId));
        }, WebContentsLookupTimeoutMs);
        ipcMain.on(respCh, (_event, webContentsId) => {
            if (settled) {
                return;
            }
            if (!isUsableWebContentsId(webContentsId)) {
                return;
            }
            const wc = webContents.fromId(parseInt(String(webContentsId), 10));
            if (wc == null || wc.isDestroyed()) {
                return;
            }
            finish(null, wc);
        });
        trySend();
        poll = setInterval(trySend, WebContentsLookupPollMs);
    });
}

function escapeSelector(selector: string): string {
    return selector
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/'/g, "\\'")
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r")
        .replace(/\t/g, "\\t");
}

export type WebGetOpts = {
    all?: boolean;
    inner?: boolean;
};

export async function webGetSelector(wc: WebContents, selector: string, opts?: WebGetOpts): Promise<string[]> {
    if (!wc || !selector) {
        return null;
    }
    const escapedSelector = escapeSelector(selector);
    const queryMethod = opts?.all ? "querySelectorAll" : "querySelector";
    const prop = opts?.inner ? "innerHTML" : "outerHTML";
    const execExpr = `
    (() => {
        const toArr = x => (x instanceof NodeList) ? Array.from(x) : (x ? [x] : []);
        try {
            const result = document.${queryMethod}("${escapedSelector}");
            const value = toArr(result).map(el => el.${prop});
            return { value };
        } catch (error) {
            return { error: error.message };
        }
    })()`;
    const results = await wc.executeJavaScript(execExpr);
    if (results.error) {
        throw new Error(results.error);
    }
    return results.value;
}
