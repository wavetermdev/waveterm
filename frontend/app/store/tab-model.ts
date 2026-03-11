// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useWaveEnv, WaveEnv } from "@/app/waveenv/waveenv";
import { atom, Atom, PrimitiveAtom } from "jotai";
import { createContext, useContext } from "react";
import { globalStore } from "./jotaiStore";
import * as WOS from "./wos";

const tabModelCache = new Map<string, TabModel>();
export const activeTabIdAtom = atom<string>(null) as PrimitiveAtom<string>;

export class TabModel {
    tabId: string;
    waveEnv: WaveEnv;
    tabAtom: Atom<Tab>;
    tabNumBlocksAtom: Atom<number>;
    isTermMultiInput = atom(false) as PrimitiveAtom<boolean>;
    metaCache: Map<string, Atom<any>> = new Map();

    constructor(tabId: string, waveEnv?: WaveEnv) {
        this.tabId = tabId;
        this.waveEnv = waveEnv;
        this.tabAtom = atom((get) => {
            if (this.waveEnv != null) {
                return get(this.waveEnv.wos.getWaveObjectAtom<Tab>(WOS.makeORef("tab", this.tabId)));
            }
            return WOS.getObjectValue(WOS.makeORef("tab", this.tabId), get);
        });
        this.tabNumBlocksAtom = atom((get) => {
            const tabData = get(this.tabAtom);
            return tabData?.blockids?.length ?? 0;
        });
    }

    getTabMetaAtom<T extends keyof MetaType>(metaKey: T): Atom<MetaType[T]> {
        let metaAtom = this.metaCache.get(metaKey);
        if (metaAtom == null) {
            metaAtom = atom((get) => {
                const tabData = get(this.tabAtom);
                return tabData?.meta?.[metaKey];
            });
            this.metaCache.set(metaKey, metaAtom);
        }
        return metaAtom;
    }
}

export function getTabModelByTabId(tabId: string, waveEnv?: WaveEnv): TabModel {
    let model = tabModelCache.get(tabId);
    if (model == null) {
        model = new TabModel(tabId, waveEnv);
        tabModelCache.set(tabId, model);
    }
    return model;
}

export function getActiveTabModel(waveEnv?: WaveEnv): TabModel | null {
    const activeTabId = globalStore.get(activeTabIdAtom);
    if (activeTabId == null) {
        return null;
    }
    return getTabModelByTabId(activeTabId, waveEnv);
}

export const TabModelContext = createContext<TabModel | undefined>(undefined);

export function useTabModel(): TabModel {
    const waveEnv = useWaveEnv();
    const ctxModel = useContext(TabModelContext);
    if (waveEnv?.mockTabModel != null) {
        return waveEnv.mockTabModel;
    }
    if (ctxModel == null) {
        throw new Error("useTabModel must be used within a TabModelProvider");
    }
    return ctxModel;
}

export function useTabModelMaybe(): TabModel {
    const waveEnv = useWaveEnv();
    const ctxModel = useContext(TabModelContext);
    if (waveEnv?.mockTabModel != null) {
        return waveEnv.mockTabModel;
    }
    return ctxModel;
}
