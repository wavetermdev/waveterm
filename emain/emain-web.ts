// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ipcMain, webContents, WebContents } from "electron";
import { WaveBrowserWindow } from "./emain-window";

export function getWebContentsByBlockId(ww: WaveBrowserWindow, tabId: string, blockId: string): Promise<WebContents> {
    const prtn = new Promise<WebContents>((resolve, reject) => {
        const randId = Math.floor(Math.random() * 1000000000).toString();
        const respCh = `getWebContentsByBlockId-${randId}`;
        ww?.activeTabView?.webContents.send("webcontentsid-from-blockid", blockId, respCh);
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
    innertext?: boolean;
    reload?: boolean;
    execjs?: string;
    highlight?: boolean;
};

export async function webGetSelector(wc: WebContents, selector: string, opts?: WebGetOpts): Promise<string[]> {
    if (!wc || !selector) {
        return null;
    }

    // Reload the page if requested, then wait for it to finish loading
    if (opts?.reload) {
        wc.reload();
        await new Promise<void>((resolve) => {
            const onFinish = () => {
                wc.removeListener("did-finish-load", onFinish);
                resolve();
            };
            wc.on("did-finish-load", onFinish);
            // Timeout fallback in case did-finish-load doesn't fire
            setTimeout(() => {
                wc.removeListener("did-finish-load", onFinish);
                resolve();
            }, 10000);
        });
    }

    // Custom JS execution mode — run arbitrary JS and return result as string array
    if (opts?.execjs) {
        const customExpr = `
        (async () => {
            try {
                const result = await (async () => { ${opts.execjs} })();
                if (Array.isArray(result)) {
                    return { value: result.map(String) };
                }
                return { value: [String(result)] };
            } catch (error) {
                return { error: error.message };
            }
        })()`;
        const results = await wc.executeJavaScript(customExpr);
        if (results.error) {
            throw new Error(results.error);
        }
        return results.value;
    }

    const escapedSelector = escapeSelector(selector);
    const queryMethod = opts?.all ? "querySelectorAll" : "querySelector";
    const prop = opts?.innertext ? "innerText" : opts?.inner ? "innerHTML" : "outerHTML";
    const doHighlight = opts?.highlight ?? false;
    const execExpr = `
    (() => {
        const toArr = x => (x instanceof NodeList) ? Array.from(x) : (x ? [x] : []);
        try {
            const result = document.${queryMethod}("${escapedSelector}");
            const els = toArr(result);
            const value = els.map(el => el.${prop});

            if (${doHighlight} && els.length > 0) {
                // Inject highlight styles once
                if (!document.getElementById('__wave_ai_highlight_style')) {
                    const style = document.createElement('style');
                    style.id = '__wave_ai_highlight_style';
                    style.textContent = \`
                        @keyframes __wave_ai_scan {
                            0% { box-shadow: 0 0 0 2px rgba(99, 102, 241, 0); border-color: rgba(99, 102, 241, 0); }
                            15% { box-shadow: 0 0 8px 2px rgba(99, 102, 241, 0.4); border-color: rgba(99, 102, 241, 0.8); }
                            100% { box-shadow: 0 0 0 2px rgba(99, 102, 241, 0); border-color: rgba(99, 102, 241, 0); }
                        }
                        .__wave_ai_reading {
                            outline: 2px solid rgba(99, 102, 241, 0.7) !important;
                            outline-offset: 2px !important;
                            animation: __wave_ai_scan 2s ease-out forwards !important;
                            position: relative !important;
                        }
                        .__wave_ai_reading::after {
                            content: 'AI Reading...' !important;
                            position: absolute !important;
                            top: -22px !important;
                            right: 0 !important;
                            background: rgba(99, 102, 241, 0.9) !important;
                            color: white !important;
                            font-size: 10px !important;
                            padding: 2px 8px !important;
                            border-radius: 4px !important;
                            font-family: system-ui, sans-serif !important;
                            z-index: 999999 !important;
                            pointer-events: none !important;
                            animation: __wave_ai_scan 2s ease-out forwards !important;
                        }
                    \`;
                    document.head.appendChild(style);
                }

                // Apply highlight to matched elements
                els.forEach(el => {
                    el.classList.add('__wave_ai_reading');
                    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                });

                // Remove highlight after animation
                setTimeout(() => {
                    els.forEach(el => el.classList.remove('__wave_ai_reading'));
                }, 2500);
            }

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
