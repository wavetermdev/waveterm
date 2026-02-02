// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getSettingsKeyAtom } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { globalStore } from "@/store/global";
import { atom } from "jotai";

export const webCdpActiveMapAtom = atom<Record<string, boolean>>({});

let pollerStarted = false;
let pollerHandle: number | null = null;

async function pollOnce() {
    const enabled = globalStore.get(getSettingsKeyAtom("debug:webcdp")) ?? false;
    if (!enabled) {
        globalStore.set(webCdpActiveMapAtom, {});
        return;
    }
    // TabRpcClient may not be initialized yet during early startup; try again next tick.
    if (!TabRpcClient) {
        return;
    }
    try {
        const status = await RpcApi.WebCdpStatusCommand(TabRpcClient, { route: "electron", timeout: 2000 });
        const next: Record<string, boolean> = {};
        for (const e of status ?? []) {
            if (e?.blockid) {
                next[e.blockid] = true;
            }
        }
        globalStore.set(webCdpActiveMapAtom, next);
    } catch (_e) {
        // Avoid flicker on transient errors; keep last known value.
    }
}

export function ensureWebCdpPollerStarted() {
    if (pollerStarted) return;
    pollerStarted = true;
    // do one immediate poll, then periodic
    pollOnce();
    pollerHandle = window.setInterval(pollOnce, 750);
}

export function stopWebCdpPollerForTests() {
    if (pollerHandle != null) {
        window.clearInterval(pollerHandle);
        pollerHandle = null;
    }
    pollerStarted = false;
    globalStore.set(webCdpActiveMapAtom, {});
}
