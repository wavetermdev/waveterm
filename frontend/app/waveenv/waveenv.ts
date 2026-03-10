// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApiType } from "@/app/store/wshclientapi";
import { Atom, PrimitiveAtom } from "jotai";
import React from "react";

type ConfigAtoms = { [K in keyof SettingsType]: Atom<SettingsType[K]> };

export type BlockMetaKeyAtomFnType<Keys extends keyof MetaType = keyof MetaType> = <T extends Keys>(
    blockId: string,
    key: T
) => Atom<MetaType[T]>;

// default implementation for production is in ./waveenvimpl.ts
export type WaveEnv = {
    electron: ElectronApi;
    rpc: RpcApiType;
    configAtoms: ConfigAtoms;
    isDev: () => boolean;
    atoms: GlobalAtomsType;
    createBlock: (blockDef: BlockDef, magnified?: boolean, ephemeral?: boolean) => Promise<string>;
    showContextMenu: (menu: ContextMenuItem[], e: React.MouseEvent) => void;
    getConnStatusAtom: (conn: string) => PrimitiveAtom<ConnStatus>;
    getWaveObjectAtom: <T extends WaveObj>(oref: string) => Atom<T>;
    useWaveObjectValue: <T extends WaveObj>(oref: string) => [T, boolean];
    getBlockMetaKeyAtom: BlockMetaKeyAtomFnType;
};

export const WaveEnvContext = React.createContext<WaveEnv>(null);

type EnvContract<T> = {
    [K in keyof T]?: T[K] extends (...args: any[]) => any ? T[K] : T[K] extends object ? EnvContract<T[K]> : T[K];
};

export function useWaveEnv<T extends EnvContract<WaveEnv> = WaveEnv>(): T {
    return React.useContext(WaveEnvContext) as T;
}
