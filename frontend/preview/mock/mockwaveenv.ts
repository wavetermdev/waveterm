// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getSettingsKeyAtom } from "@/app/store/global";
import { RpcApiType } from "@/app/store/wshclientapi";
import { WaveEnv } from "@/app/waveenv/waveenv";
import { atom } from "jotai";
import { previewElectronApi } from "./preview-electron-api";

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

type MockIds = {
    tabId?: string;
    windowId?: string;
    clientId?: string;
};

function makeMockGlobalAtoms(ids?: MockIds): GlobalAtomsType {
    return {
        builderId: atom(""),
        builderAppId: atom("") as any,
        uiContext: atom({ windowid: ids?.windowId ?? "", activetabid: ids?.tabId ?? "" } as UIContext),
        workspace: atom(null as Workspace),
        fullConfigAtom: atom(null) as any,
        waveaiModeConfigAtom: atom({}) as any,
        settingsAtom: atom({} as SettingsType),
        hasCustomAIPresetsAtom: atom(false),
        staticTabId: atom(ids?.tabId ?? ""),
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
}

const mockRpcApi = new RpcApiType();

mockRpcApi.setMockRpcClient({
    mockWshRpcCall(_client, command, data, _opts) {
        console.log("[mock rpc call]", command, data);
        return Promise.resolve(null);
    },
    async *mockWshRpcStream(_client, command, data, _opts) {
        console.log("[mock rpc stream]", command, data);
        yield null;
    },
});

export function makeMockWaveEnv(overrides?: Partial<SettingsType>, ids?: MockIds): WaveEnv {
    return {
        electron: previewElectronApi,
        rpc: mockRpcApi,
        configAtoms: makeMockConfigAtoms(overrides),
        isDev: () => true,
        atoms: makeMockGlobalAtoms(ids),
        createBlock: (blockDef: BlockDef, magnified?: boolean, ephemeral?: boolean) => {
            console.log("[mock createBlock]", blockDef, { magnified, ephemeral });
            return Promise.resolve(crypto.randomUUID());
        },
        showContextMenu: (menu, e) => {
            console.log("[mock showContextMenu]", menu, e);
        },
    };
}
