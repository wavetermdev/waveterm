// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ContextMenuModel } from "@/app/store/contextmenu";
import {
    atoms,
    createBlock,
    getBlockMetaKeyAtom,
    getConfigBackgroundAtom,
    getConnConfigKeyAtom,
    getConnStatusAtom,
    getLocalHostDisplayNameAtom,
    getSettingsKeyAtom,
    getTabMetaKeyAtom,
    isDev,
    WOS,
} from "@/app/store/global";
import { AllServiceImpls } from "@/app/store/services";
import { RpcApi } from "@/app/store/wshclientapi";
import { WaveEnv } from "@/app/waveenv/waveenv";
import { isMacOS, isWindows, PLATFORM } from "@/util/platformutil";

export function makeWaveEnvImpl(): WaveEnv {
    return {
        isMock: false,
        electron: (window as any).api,
        rpc: RpcApi,
        getSettingsKeyAtom,
        platform: PLATFORM,
        isDev,
        isWindows,
        isMacOS,
        atoms,
        createBlock,
        services: AllServiceImpls,
        callBackendService: WOS.callBackendService,
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
        getTabMetaKeyAtom,
        getConfigBackgroundAtom,
        getConnConfigKeyAtom,

        mockSetWaveObj: <T extends WaveObj>(_oref: string, _obj: T) => {
            throw new Error("mockSetWaveObj is only available in the preview server");
        },
        mockModels: new Map<any, any>(),
    };
}
