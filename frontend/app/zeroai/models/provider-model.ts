// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { atom, type PrimitiveAtom } from "jotai";
import { zeroAiClient } from "../store/zeroai-client";
import type { SaveProviderRequest, TestProviderResult, ZeroAiProviderInfo } from "../types";

export const providersAtom: PrimitiveAtom<ZeroAiProviderInfo[]> = atom<ZeroAiProviderInfo[]>([]);
export const providerLoadingAtom: PrimitiveAtom<boolean> = atom<boolean>(false);
export const providerTestingAtom: PrimitiveAtom<string | null> = atom<string | null>(null as string | null);

export type ProviderAction =
    | { type: "setProviders"; providers: ZeroAiProviderInfo[] }
    | { type: "addProvider"; provider: ZeroAiProviderInfo }
    | { type: "updateProvider"; providerId: string; updates: Partial<ZeroAiProviderInfo> }
    | { type: "removeProvider"; providerId: string }
    | { type: "setLoading"; loading: boolean }
    | { type: "setTesting"; providerId: string | null };

export const providerActionsAtom = atom(null, (_get, _set, action: ProviderAction) => {
    switch (action.type) {
        case "setProviders":
            globalStore.set(providersAtom, action.providers);
            break;
        case "addProvider":
            globalStore.set(providersAtom, (prev) => [...prev, action.provider]);
            break;
        case "updateProvider":
            globalStore.set(providersAtom, (prev) =>
                prev.map((p) => (p.id === action.providerId ? { ...p, ...action.updates } : p))
            );
            break;
        case "removeProvider":
            globalStore.set(providersAtom, (prev) => prev.filter((p) => p.id !== action.providerId));
            break;
        case "setLoading":
            globalStore.set(providerLoadingAtom, action.loading);
            break;
        case "setTesting":
            globalStore.set(providerTestingAtom, action.providerId);
            break;
    }
});

export function dispatchProviderAction(action: ProviderAction): void {
    globalStore.set(providerActionsAtom, action);
}

export async function fetchProviders(): Promise<ZeroAiProviderInfo[]> {
    dispatchProviderAction({ type: "setLoading", loading: true });
    try {
        const providers = await zeroAiClient.listProviders();
        dispatchProviderAction({ type: "setProviders", providers });
        return providers;
    } finally {
        dispatchProviderAction({ type: "setLoading", loading: false });
    }
}

export async function saveProvider(request: SaveProviderRequest): Promise<void> {
    await zeroAiClient.saveProvider(request);
    await fetchProviders();
}

export async function deleteProvider(providerId: string): Promise<void> {
    await zeroAiClient.deleteProvider({ providerId });
    dispatchProviderAction({ type: "removeProvider", providerId });
}

export async function testProvider(providerId: string): Promise<TestProviderResult> {
    dispatchProviderAction({ type: "setTesting", providerId });
    try {
        return await zeroAiClient.testProvider(providerId);
    } finally {
        dispatchProviderAction({ type: "setTesting", providerId: null });
    }
}
