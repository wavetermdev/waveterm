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
    try {
        const status = await RpcApi.WebCdpStatusCommand(TabRpcClient, null, { route: "electron", timeout: 2000 });
        const next: Record<string, boolean> = {};
        for (const e of status ?? []) {
            if (e?.blockid) {
                next[e.blockid] = true;
            }
        }
        globalStore.set(webCdpActiveMapAtom, next);
    } catch (_e) {
        // Fail closed: don't show the indicator if we can't confirm active status.
        globalStore.set(webCdpActiveMapAtom, {});
    }
}

export function ensureWebCdpPollerStarted() {
    if (pollerStarted) return;
    pollerStarted = true;
    // do one immediate poll, then periodic
    pollOnce();
    pollerHandle = window.setInterval(pollOnce, 2500);
}

export function stopWebCdpPollerForTests() {
    if (pollerHandle != null) {
        window.clearInterval(pollerHandle);
        pollerHandle = null;
    }
    pollerStarted = false;
    globalStore.set(webCdpActiveMapAtom, {});
}
