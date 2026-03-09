// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getSettingsKeyAtom, makeDefaultConnStatus } from "@/app/store/global";
import { RpcApiType } from "@/app/store/wshclientapi";
import { WaveEnv } from "@/app/waveenv/waveenv";
import { PlatformMacOS, PlatformWindows } from "@/util/platformutil";
import { Atom, atom, PrimitiveAtom } from "jotai";
import { previewElectronApi } from "./preview-electron-api";

type RpcOverrides = {
    [K in keyof RpcApiType as K extends `${string}Command` ? K : never]?: (...args: any[]) => any;
};

export type MockEnv = {
    isDev?: boolean;
    platform?: NodeJS.Platform;
    config?: Partial<SettingsType>;
    rpc?: RpcOverrides;
    atoms?: Partial<GlobalAtomsType>;
    electron?: Partial<ElectronApi>;
    createBlock?: WaveEnv["createBlock"];
    showContextMenu?: WaveEnv["showContextMenu"];
    connStatus?: Record<string, ConnStatus>;
    mockWaveObjs?: Record<string, WaveObj>;
};

export type MockWaveEnv = WaveEnv & { mockEnv: MockEnv };

function mergeRecords<T>(base: Record<string, T>, overrides: Record<string, T>): Record<string, T> {
    if (base == null && overrides == null) {
        return undefined;
    }
    return { ...(base ?? {}), ...(overrides ?? {}) };
}

export function mergeMockEnv(base: MockEnv, overrides: MockEnv): MockEnv {
    return {
        isDev: overrides.isDev ?? base.isDev,
        platform: overrides.platform ?? base.platform,
        config: mergeRecords(base.config, overrides.config),
        rpc: mergeRecords(base.rpc as any, overrides.rpc as any) as RpcOverrides,
        atoms:
            overrides.atoms != null || base.atoms != null ? { ...base.atoms, ...overrides.atoms } : undefined,
        electron:
            overrides.electron != null || base.electron != null
                ? { ...(base.electron ?? {}), ...(overrides.electron ?? {}) }
                : undefined,
        createBlock: overrides.createBlock ?? base.createBlock,
        showContextMenu: overrides.showContextMenu ?? base.showContextMenu,
        connStatus: mergeRecords(base.connStatus, overrides.connStatus),
        mockWaveObjs: mergeRecords(base.mockWaveObjs, overrides.mockWaveObjs),
    };
}

function makeMockConfigAtoms(overrides?: Partial<SettingsType>): WaveEnv["configAtoms"] {
    const overrideAtoms = new Map<keyof SettingsType, ReturnType<typeof atom>>();
    if (overrides) {
        for (const key of Object.keys(overrides) as (keyof SettingsType)[]) {
            overrideAtoms.set(key, atom(overrides[key]));
        }
    }
    return new Proxy({} as WaveEnv["configAtoms"], {
        get<K extends keyof SettingsType>(_target: WaveEnv["configAtoms"], key: K) {
            if (overrideAtoms.has(key)) {
                return overrideAtoms.get(key);
            }
            return getSettingsKeyAtom(key);
        },
    });
}

function makeMockGlobalAtoms(atomOverrides?: Partial<GlobalAtomsType>): GlobalAtomsType {
    const defaults: GlobalAtomsType = {
        builderId: atom(""),
        builderAppId: atom("") as any,
        uiContext: atom({} as UIContext),
        workspace: atom(null as Workspace),
        fullConfigAtom: atom(null) as any,
        waveaiModeConfigAtom: atom({}) as any,
        settingsAtom: atom({} as SettingsType),
        hasCustomAIPresetsAtom: atom(false),
        staticTabId: atom(""),
        isFullScreen: atom(false) as any,
        zoomFactorAtom: atom(1.0) as any,
        controlShiftDelayAtom: atom(false) as any,
        prefersReducedMotionAtom: atom(false),
        documentHasFocus: atom(true) as any,
        updaterStatusAtom: atom("up-to-date" as UpdaterStatus) as any,
        modalOpen: atom(false) as any,
        allConnStatus: atom([] as ConnStatus[]),
        reinitVersion: atom(0) as any,
        waveAIRateLimitInfoAtom: atom(null) as any,
    };
    if (!atomOverrides) {
        return defaults;
    }
    return { ...defaults, ...atomOverrides };
}

export function makeMockRpc(overrides?: RpcOverrides): RpcApiType {
    const dispatchMap = new Map<string, (...args: any[]) => any>();
    if (overrides) {
        for (const key of Object.keys(overrides) as (keyof RpcOverrides)[]) {
            const cmdName = key.slice(0, -"Command".length).toLowerCase();
            dispatchMap.set(cmdName, overrides[key] as (...args: any[]) => any);
        }
    }
    const rpc = new RpcApiType();
    rpc.setMockRpcClient({
        mockWshRpcCall(_client, command, data, _opts) {
            const fn = dispatchMap.get(command);
            if (fn) {
                return fn(_client, data, _opts);
            }
            console.log("[mock rpc call]", command, data);
            return Promise.resolve(null);
        },
        async *mockWshRpcStream(_client, command, data, _opts) {
            const fn = dispatchMap.get(command);
            if (fn) {
                yield* fn(_client, data, _opts);
                return;
            }
            console.log("[mock rpc stream]", command, data);
            yield null;
        },
    });
    return rpc;
}

export function applyMockEnvOverrides(env: WaveEnv, newOverrides: MockEnv): MockWaveEnv {
    const existing = (env as MockWaveEnv).mockEnv;
    const merged = existing != null ? mergeMockEnv(existing, newOverrides) : newOverrides;
    return makeMockWaveEnv(merged);
}

export function makeMockWaveEnv(mockEnv?: MockEnv): MockWaveEnv {
    const overrides: MockEnv = mockEnv ?? {};
    const platform = overrides.platform ?? PlatformMacOS;
    const connStatusAtomCache = new Map<string, PrimitiveAtom<ConnStatus>>();
    const waveObjectAtomCache = new Map<string, PrimitiveAtom<WaveObj>>();
    const blockMetaKeyAtomCache = new Map<string, Atom<any>>();
    const env = {
        mockEnv: overrides,
        electron: {
            ...previewElectronApi,
            getPlatform: () => platform,
            ...overrides.electron,
        },
        rpc: makeMockRpc(overrides.rpc),
        platform,
        configAtoms: makeMockConfigAtoms(overrides.config),
        atoms: makeMockGlobalAtoms(overrides.atoms),
        isDev: () => overrides.isDev ?? true,
        isWindows: () => platform === PlatformWindows,
        isMacOS: () => platform === PlatformMacOS,
        createBlock:
            overrides.createBlock ??
            ((blockDef: BlockDef, magnified?: boolean, ephemeral?: boolean) => {
                console.log("[mock createBlock]", blockDef, { magnified, ephemeral });
                return Promise.resolve(crypto.randomUUID());
            }),
        showContextMenu:
            overrides.showContextMenu ??
            ((menu, e) => {
                console.log("[mock showContextMenu]", menu, e);
            }),
        getConnStatusAtom: (conn: string) => {
            if (!connStatusAtomCache.has(conn)) {
                const connStatus = overrides.connStatus?.[conn] ?? makeDefaultConnStatus(conn);
                connStatusAtomCache.set(conn, atom(connStatus));
            }
            return connStatusAtomCache.get(conn);
        },
        getWaveObjectAtom: <T extends WaveObj>(oref: string) => {
            if (!waveObjectAtomCache.has(oref)) {
                const obj = (overrides.mockWaveObjs?.[oref] ?? null) as T;
                waveObjectAtomCache.set(oref, atom(obj));
            }
            return waveObjectAtomCache.get(oref) as PrimitiveAtom<T>;
        },
        getBlockMetaKeyAtom: <T extends keyof MetaType>(blockId: string, key: T) => {
            const cacheKey = blockId + "#meta-" + key;
            if (!blockMetaKeyAtomCache.has(cacheKey)) {
                const metaAtom = atom<MetaType[T]>((get) => {
                    const blockORef = "block:" + blockId;
                    const blockAtom = env.getWaveObjectAtom<Block>(blockORef);
                    const blockData = get(blockAtom);
                    return blockData?.meta?.[key] as MetaType[T];
                });
                blockMetaKeyAtomCache.set(cacheKey, metaAtom);
            }
            return blockMetaKeyAtomCache.get(cacheKey) as Atom<MetaType[T]>;
        },
    };
    return env;
}
