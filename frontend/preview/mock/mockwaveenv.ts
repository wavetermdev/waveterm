// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { makeDefaultConnStatus } from "@/app/store/global";
import { TabModel } from "@/app/store/tab-model";
import { RpcApiType } from "@/app/store/wshclientapi";
import { WaveEnv } from "@/app/waveenv/waveenv";
import { PlatformMacOS, PlatformWindows } from "@/util/platformutil";
import { Atom, atom, PrimitiveAtom } from "jotai";
import { DefaultFullConfig } from "./defaultconfig";
import { previewElectronApi } from "./preview-electron-api";

type RpcOverrides = {
    [K in keyof RpcApiType as K extends `${string}Command` ? K : never]?: (...args: any[]) => any;
};

export type MockEnv = {
    isDev?: boolean;
    tabId?: string;
    platform?: NodeJS.Platform;
    settings?: Partial<SettingsType>;
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
        tabId: overrides.tabId ?? base.tabId,
        platform: overrides.platform ?? base.platform,
        settings: mergeRecords(base.settings, overrides.settings),
        rpc: mergeRecords(base.rpc as any, overrides.rpc as any) as RpcOverrides,
        atoms: overrides.atoms != null || base.atoms != null ? { ...base.atoms, ...overrides.atoms } : undefined,
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

function makeMockSettingsKeyAtom(
    settingsAtom: Atom<SettingsType>,
    overrides?: Partial<SettingsType>
): WaveEnv["getSettingsKeyAtom"] {
    const keyAtomCache = new Map<keyof SettingsType, Atom<any>>();
    return <T extends keyof SettingsType>(key: T) => {
        if (!keyAtomCache.has(key)) {
            keyAtomCache.set(
                key,
                atom((get) => (overrides?.[key] !== undefined ? overrides[key] : get(settingsAtom)?.[key]))
            );
        }
        return keyAtomCache.get(key) as Atom<SettingsType[T]>;
    };
}

function makeMockGlobalAtoms(
    settingsOverrides?: Partial<SettingsType>,
    atomOverrides?: Partial<GlobalAtomsType>,
    tabId?: string
): GlobalAtomsType {
    let fullConfig = DefaultFullConfig;
    if (settingsOverrides) {
        fullConfig = {
            ...DefaultFullConfig,
            settings: { ...DefaultFullConfig.settings, ...settingsOverrides },
        };
    }
    const fullConfigAtom = atom(fullConfig) as PrimitiveAtom<FullConfigType>;
    const settingsAtom = atom((get) => get(fullConfigAtom)?.settings ?? {}) as Atom<SettingsType>;
    const defaults: GlobalAtomsType = {
        builderId: atom(""),
        builderAppId: atom("") as any,
        uiContext: atom({ windowid: "", activetabid: tabId ?? "" } as UIContext),
        workspace: atom(null as Workspace),
        fullConfigAtom,
        waveaiModeConfigAtom: atom({}) as any,
        settingsAtom,
        hasCustomAIPresetsAtom: atom(false),
        staticTabId: atom(tabId ?? ""),
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
    const waveObjectAtomCache = new Map<string, Atom<any>>();
    const blockMetaKeyAtomCache = new Map<string, Atom<any>>();
    const connConfigKeyAtomCache = new Map<string, Atom<any>>();
    const atoms = makeMockGlobalAtoms(overrides.settings, overrides.atoms, overrides.tabId);
    const localHostDisplayNameAtom = atom<string>((get) => {
        const configValue = get(atoms.settingsAtom)?.["conn:localhostdisplayname"];
        if (configValue != null) {
            return configValue;
        }
        return "user@localhost";
    });
    const env = {
        mockEnv: overrides,
        electron: {
            ...previewElectronApi,
            getPlatform: () => platform,
            ...overrides.electron,
        },
        rpc: makeMockRpc(overrides.rpc),
        atoms,
        getSettingsKeyAtom: makeMockSettingsKeyAtom(atoms.settingsAtom, overrides.settings),
        platform,
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
        getLocalHostDisplayNameAtom: () => {
            return localHostDisplayNameAtom;
        },
        getConnStatusAtom: (conn: string) => {
            if (!connStatusAtomCache.has(conn)) {
                const connStatus = overrides.connStatus?.[conn] ?? makeDefaultConnStatus(conn);
                connStatusAtomCache.set(conn, atom(connStatus));
            }
            return connStatusAtomCache.get(conn);
        },
        wos: {
            getWaveObjectAtom: <T extends WaveObj>(oref: string) => {
                const cacheKey = oref + ":value";
                if (!waveObjectAtomCache.has(cacheKey)) {
                    const obj = (overrides.mockWaveObjs?.[oref] ?? null) as T;
                    waveObjectAtomCache.set(cacheKey, atom(obj));
                }
                return waveObjectAtomCache.get(cacheKey) as PrimitiveAtom<T>;
            },
            getWaveObjectLoadingAtom: (oref: string) => {
                const cacheKey = oref + ":loading";
                if (!waveObjectAtomCache.has(cacheKey)) {
                    waveObjectAtomCache.set(cacheKey, atom(false));
                }
                return waveObjectAtomCache.get(cacheKey) as Atom<boolean>;
            },
            isWaveObjectNullAtom: (oref: string) => {
                const cacheKey = oref + ":isnull";
                if (!waveObjectAtomCache.has(cacheKey)) {
                    waveObjectAtomCache.set(
                        cacheKey,
                        atom((get) => get(env.wos.getWaveObjectAtom(oref)) == null)
                    );
                }
                return waveObjectAtomCache.get(cacheKey) as Atom<boolean>;
            },
            useWaveObjectValue: <T extends WaveObj>(oref: string): [T, boolean] => {
                const obj = (overrides.mockWaveObjs?.[oref] ?? null) as T;
                return [obj, false];
            },
        },
        getBlockMetaKeyAtom: <T extends keyof MetaType>(blockId: string, key: T) => {
            const cacheKey = blockId + "#meta-" + key;
            if (!blockMetaKeyAtomCache.has(cacheKey)) {
                const metaAtom = atom<MetaType[T]>((get) => {
                    const blockORef = "block:" + blockId;
                    const blockAtom = env.wos.getWaveObjectAtom<Block>(blockORef);
                    const blockData = get(blockAtom);
                    return blockData?.meta?.[key] as MetaType[T];
                });
                blockMetaKeyAtomCache.set(cacheKey, metaAtom);
            }
            return blockMetaKeyAtomCache.get(cacheKey) as Atom<MetaType[T]>;
        },
        getConnConfigKeyAtom: <T extends keyof ConnKeywords>(connName: string, key: T) => {
            const cacheKey = connName + "#conn-" + key;
            if (!connConfigKeyAtomCache.has(cacheKey)) {
                const keyAtom = atom<ConnKeywords[T]>((get) => {
                    const fullConfig = get(atoms.fullConfigAtom);
                    return fullConfig.connections?.[connName]?.[key];
                });
                connConfigKeyAtomCache.set(cacheKey, keyAtom);
            }
            return connConfigKeyAtomCache.get(cacheKey) as Atom<ConnKeywords[T]>;
        },
        mockTabModel: null as TabModel,
    } as MockWaveEnv;
    if (overrides.tabId != null) {
        env.mockTabModel = new TabModel(overrides.tabId, env);
    }
    return env;
}
