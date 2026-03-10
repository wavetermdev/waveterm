// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { TabModel } from "@/app/store/tab-model";
import { RpcApiType } from "@/app/store/wshclientapi";
import { Atom, PrimitiveAtom } from "jotai";
import React from "react";

export type BlockMetaKeyAtomFnType<Keys extends keyof MetaType = keyof MetaType> = <T extends Keys>(
    blockId: string,
    key: T
) => Atom<MetaType[T]>;

export type ConnConfigKeyAtomFnType<Keys extends keyof ConnKeywords = keyof ConnKeywords> = <T extends Keys>(
    connName: string,
    key: T
) => Atom<ConnKeywords[T]>;

export type SettingsKeyAtomFnType<Keys extends keyof SettingsType = keyof SettingsType> = <T extends Keys>(
    key: T
) => Atom<SettingsType[T]>;

// default implementation for production is in ./waveenvimpl.ts
export type WaveEnv = {
    electron: ElectronApi;
    rpc: RpcApiType;
    platform: NodeJS.Platform;
    isDev: () => boolean;
    isWindows: () => boolean;
    isMacOS: () => boolean;
    atoms: GlobalAtomsType;
    createBlock: (blockDef: BlockDef, magnified?: boolean, ephemeral?: boolean) => Promise<string>;
    showContextMenu: (menu: ContextMenuItem[], e: React.MouseEvent) => void;
    getConnStatusAtom: (conn: string) => PrimitiveAtom<ConnStatus>;
    getLocalHostDisplayNameAtom: () => Atom<string>;
    wos: {
        getWaveObjectAtom: <T extends WaveObj>(oref: string) => Atom<T>;
        getWaveObjectLoadingAtom: (oref: string) => Atom<boolean>;
        isWaveObjectNullAtom: (oref: string) => Atom<boolean>;
        useWaveObjectValue: <T extends WaveObj>(oref: string) => [T, boolean];
    };
    getSettingsKeyAtom: SettingsKeyAtomFnType;
    getBlockMetaKeyAtom: BlockMetaKeyAtomFnType;
    getConnConfigKeyAtom: ConnConfigKeyAtomFnType;
    mockTabModel?: TabModel;
};

export const WaveEnvContext = React.createContext<WaveEnv>(null);

type EnvContract<T> = {
    [K in keyof T]?: T[K] extends (...args: any[]) => any ? T[K] : T[K] extends object ? EnvContract<T[K]> : T[K];
};

export function useWaveEnv<T extends EnvContract<WaveEnv> = WaveEnv>(): T {
    return React.useContext(WaveEnvContext) as T;
}
