// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ContextMenuModel } from "@/app/store/contextmenu";
import {
    atoms,
    createBlock,
    getBlockMetaKeyAtom,
    getConnConfigKeyAtom,
    getConnStatusAtom,
    getLocalHostDisplayNameAtom,
    getSettingsKeyAtom,
    isDev,
    WOS,
} from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { WaveEnv } from "@/app/waveenv/waveenv";

export function makeWaveEnvImpl(): WaveEnv {
    return {
        electron: (window as any).api,
        rpc: RpcApi,
        getSettingsKeyAtom,
        isDev,
        atoms,
        createBlock,
        showContextMenu: (menu: ContextMenuItem[], e: React.MouseEvent) => {
            ContextMenuModel.getInstance().showContextMenu(menu, e);
        },
        getConnStatusAtom,
        getLocalHostDisplayNameAtom,
        wos: {
            getWaveObjectAtom: WOS.getWaveObjectAtom,
            getWaveObjectLoadingAtom: WOS.getWaveObjectLoadingAtom,
            isWaveObjectNullAtom: WOS.isWaveObjectNullAtom,
            useWaveObjectValue: WOS.useWaveObjectValue,
        },
        getBlockMetaKeyAtom,
        getConnConfigKeyAtom,
    };
}
