// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ContextMenuModel } from "@/app/store/contextmenu";
import {
    atoms,
    createBlock,
    getBlockMetaKeyAtom,
    getConnStatusAtom,
    getSettingsKeyAtom,
    isDev,
    WOS,
} from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { WaveEnv } from "@/app/waveenv/waveenv";

const settingsAtoms = new Proxy({} as WaveEnv["settingsAtoms"], {
    get<K extends keyof SettingsType>(_target: WaveEnv["settingsAtoms"], key: K) {
        return getSettingsKeyAtom(key);
    },
});

export function makeWaveEnvImpl(): WaveEnv {
    return {
        electron: (window as any).api,
        rpc: RpcApi,
        settingsAtoms,
        isDev,
        atoms,
        createBlock,
        showContextMenu: (menu: ContextMenuItem[], e: React.MouseEvent) => {
            ContextMenuModel.getInstance().showContextMenu(menu, e);
        },
        getConnStatusAtom,
        getWaveObjectAtom: WOS.getWaveObjectAtom,
        useWaveObjectValue: WOS.useWaveObjectValue,
        getBlockMetaKeyAtom,
    };
}
