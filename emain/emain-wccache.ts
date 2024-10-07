// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as electron from "electron";
import { getElectronAppBasePath, isDevVite } from "emain/platform";
import * as path from "path";

const MaxCacheSize = 10;
let HotSpareTab: WaveTabView = null;

export type WaveTabView = Electron.WebContentsView & {
    isActiveTab: boolean;
    waveWindowId: string; // set when showing in an active window
    waveTabId: string; // always set, WaveTabViews are unique per tab
    lastUsedTs: number; // ts milliseconds
    initPromise: Promise<void>;
    waveReadyPromise: Promise<void>;
    initResolve: () => void;
    waveReadyResolve: () => void;
};

const wcvCache = new Map<string, WaveTabView>();

function createBareTabView(): WaveTabView {
    console.log("createBareTabView");
    const tabView = new electron.WebContentsView({
        webPreferences: {
            preload: path.join(getElectronAppBasePath(), "preload", "index.cjs"),
            webviewTag: true,
        },
    }) as WaveTabView;
    tabView.initPromise = new Promise((resolve, _) => {
        tabView.initResolve = resolve;
    });
    tabView.waveReadyPromise = new Promise((resolve, _) => {
        tabView.waveReadyResolve = resolve;
    });
    if (isDevVite) {
        tabView.webContents.loadURL(`${process.env.ELECTRON_RENDERER_URL}/index.html}`);
    } else {
        tabView.webContents.loadFile(path.join(getElectronAppBasePath(), "frontend", "index.html"));
    }
    return tabView;
}

export function ensureHotSpareTab() {
    console.log("ensureHotSpareTab");
    if (HotSpareTab == null) {
        HotSpareTab = createBareTabView();
    }
}

export function getSpareTab(): WaveTabView {
    setTimeout(ensureHotSpareTab, 500);
    if (HotSpareTab != null) {
        const rtn = HotSpareTab;
        HotSpareTab = null;
        console.log("getSpareTab: returning hotspare");
        return rtn;
    } else {
        console.log("getSpareTab: creating new tab");
        return createBareTabView();
    }
}

export function getWaveTabView(waveWindowId: string, waveTabId: string): WaveTabView | undefined {
    const cacheKey = waveWindowId + "|" + waveTabId;
    const rtn = wcvCache.get(cacheKey);
    if (rtn) {
        rtn.lastUsedTs = Date.now();
    }
    return rtn;
}

export function setWaveTabView(waveWindowId: string, waveTabId: string, wcv: WaveTabView): void {
    const cacheKey = waveWindowId + "|" + waveTabId;
    wcvCache.set(cacheKey, wcv);
    checkAndEvictCache();
}

function checkAndEvictCache(): void {
    if (wcvCache.size <= MaxCacheSize) {
        return;
    }
    const sorted = Array.from(wcvCache.values()).sort((a, b) => {
        // Prioritize entries which are active
        if (a.isActiveTab && !b.isActiveTab) {
            return -1;
        }
        // Otherwise, sort by lastUsedTs
        return a.lastUsedTs - b.lastUsedTs;
    });
    for (let i = 0; i < sorted.length - MaxCacheSize; i++) {
        if (sorted[i].isActiveTab) {
            // don't evict WaveTabViews that are currently showing in a window
            continue;
        }
        const tabView = sorted[i];
        tabView.webContents.close();
        wcvCache.delete(sorted[i].waveTabId);
    }
}
