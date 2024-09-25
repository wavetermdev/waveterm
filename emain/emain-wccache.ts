// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

const MaxCacheSize = 10;

export type WaveTabView = Electron.WebContentsView & {
    waveWindowId: string; // set when showing in an active window
    waveTabId: string; // always set, WaveTabViews are unique per tab
    lastUsedTs: number; // ts milliseconds
};

const wcvCache = new Map<string, WaveTabView>();

export function getWaveTabView(waveTabId: string): WaveTabView | undefined {
    const rtn = wcvCache.get(waveTabId);
    if (rtn) {
        rtn.lastUsedTs = Date.now();
    }
    return rtn;
}

export function setWaveTabView(waveTabId: string, wcv: WaveTabView): void {
    wcvCache.set(waveTabId, wcv);
    checkAndEvictCache();
}

function checkAndEvictCache(): void {
    if (wcvCache.size <= MaxCacheSize) {
        return;
    }
    const sorted = Array.from(wcvCache.values()).sort((a, b) => {
        // Prioritize entries with null waveWindowId for eviction
        if (a.waveWindowId === null && b.waveWindowId !== null) return -1;
        if (a.waveWindowId !== null && b.waveWindowId === null) return 1;
        // Otherwise, sort by lastUsedTs
        return a.lastUsedTs - b.lastUsedTs;
    });
    for (let i = 0; i < sorted.length - MaxCacheSize; i++) {
        if (sorted[i].waveWindowId != null) {
            // don't evict WaveTabViews that are currently showing in a window
            continue;
        }
        wcvCache.delete(sorted[i].waveTabId);
    }
}
