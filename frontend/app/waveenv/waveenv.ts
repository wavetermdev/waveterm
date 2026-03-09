// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApiType } from "@/app/store/wshclientapi";
import { Atom } from "jotai";
import React from "react";

type ConfigAtoms = { [K in keyof SettingsType]: Atom<SettingsType[K]> };

// default implementation for production is in ./waveenvimpl.ts
export type WaveEnv = {
    electron: ElectronApi;
    rpc: RpcApiType;
    configAtoms: ConfigAtoms;
    isDev: () => boolean;
    atoms: GlobalAtomsType;
    tab: {
        getTabBadgeAtom: (tabId: string) => Atom<Badge[]>;
        updateObjectMeta: (oref: string, meta: MetaType) => Promise<void>;
        updateTabName: (tabId: string, name: string) => Promise<void>;
        recordTEvent: (event: string, props?: TEventProps) => void;
        refocusNode: (blockId: string) => void;
    };
    createBlock: (blockDef: BlockDef, magnified?: boolean, ephemeral?: boolean) => Promise<string>;
    showContextMenu: (menu: ContextMenuItem[], e: React.MouseEvent) => void;
};

export const WaveEnvContext = React.createContext<WaveEnv>(null);

type EnvContract<T> = {
    [K in keyof T]?: T[K] extends (...args: any[]) => any ? T[K] : T[K] extends object ? EnvContract<T[K]> : T[K];
};

export function useWaveEnv<T extends EnvContract<WaveEnv> = WaveEnv>(): T {
    return React.useContext(WaveEnvContext) as T;
}
