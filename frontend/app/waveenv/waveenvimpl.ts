// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms, createBlock, getSettingsKeyAtom, isDev } from "@/app/store/global";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { RpcApi } from "@/app/store/wshclientapi";
import { WaveEnv } from "@/app/waveenv/waveenv";

const configAtoms = new Proxy({} as WaveEnv["configAtoms"], {
    get<K extends keyof SettingsType>(_target: WaveEnv["configAtoms"], key: K) {
        return getSettingsKeyAtom(key);
    },
});

export function makeWaveEnvImpl(): WaveEnv {
    return {
        electron: (window as any).api,
        rpc: RpcApi,
        configAtoms,
        isDev,
        atoms,
        createBlock,
        showContextMenu: (menu: ContextMenuItem[], e: React.MouseEvent) => {
            ContextMenuModel.getInstance().showContextMenu(menu, e);
        },
    };
}
