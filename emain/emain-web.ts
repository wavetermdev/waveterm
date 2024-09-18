// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BrowserWindow, ipcMain, webContents, WebContents } from "electron";

export function getWebContentsByBlockId(win: BrowserWindow, tabId: string, blockId: string): Promise<WebContents> {
    const prtn = new Promise<WebContents>((resolve, reject) => {
        const randId = Math.floor(Math.random() * 1000000000).toString();
        const respCh = `getWebContentsByBlockId-${randId}`;
        win.webContents.send("webcontentsid-from-blockid", blockId, respCh);
        ipcMain.once(respCh, (event, webContentsId) => {
            if (webContentsId == null) {
                resolve(null);
                return;
            }
            const wc = webContents.fromId(parseInt(webContentsId));
            resolve(wc);
        });
        setTimeout(() => {
            reject(new Error("timeout waiting for response"));
        }, 2000);
    });
    return prtn;
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
