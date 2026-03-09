// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getTabBadgeAtom } from "@/app/store/badge";
import { atoms, createBlock, getSettingsKeyAtom, isDev, recordTEvent, refocusNode } from "@/app/store/global";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { ObjectService } from "@/app/store/services";
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
        tab: {
            getTabBadgeAtom,
            updateObjectMeta: (oref, meta) => ObjectService.UpdateObjectMeta(oref, meta),
            updateTabName: (tabId, name) => ObjectService.UpdateTabName(tabId, name),
            recordTEvent,
            refocusNode,
        },
        createBlock,
        showContextMenu: (menu: ContextMenuItem[], e: React.MouseEvent) => {
            ContextMenuModel.getInstance().showContextMenu(menu, e);
        },
    };
}
