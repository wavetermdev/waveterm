// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { SettingsKeyAtomFnType, WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";

export type VTabBarEnv = WaveEnvSubset<{
    electron: {
        createTab: WaveEnv["electron"]["createTab"];
        closeTab: WaveEnv["electron"]["closeTab"];
        setActiveTab: WaveEnv["electron"]["setActiveTab"];
        deleteWorkspace: WaveEnv["electron"]["deleteWorkspace"];
        createWorkspace: WaveEnv["electron"]["createWorkspace"];
        switchWorkspace: WaveEnv["electron"]["switchWorkspace"];
        installAppUpdate: WaveEnv["electron"]["installAppUpdate"];
    };
    rpc: {
        UpdateWorkspaceTabIdsCommand: WaveEnv["rpc"]["UpdateWorkspaceTabIdsCommand"];
        UpdateTabNameCommand: WaveEnv["rpc"]["UpdateTabNameCommand"];
        ActivityCommand: WaveEnv["rpc"]["ActivityCommand"];
        SetConfigCommand: WaveEnv["rpc"]["SetConfigCommand"];
        SetMetaCommand: WaveEnv["rpc"]["SetMetaCommand"];
    };
    atoms: {
        staticTabId: WaveEnv["atoms"]["staticTabId"];
        fullConfigAtom: WaveEnv["atoms"]["fullConfigAtom"];
        reinitVersion: WaveEnv["atoms"]["reinitVersion"];
        documentHasFocus: WaveEnv["atoms"]["documentHasFocus"];
        workspace: WaveEnv["atoms"]["workspace"];
        updaterStatusAtom: WaveEnv["atoms"]["updaterStatusAtom"];
        isFullScreen: WaveEnv["atoms"]["isFullScreen"];
    };
    services: {
        workspace: WaveEnv["services"]["workspace"];
    };
    wos: WaveEnv["wos"];
    showContextMenu: WaveEnv["showContextMenu"];
    getSettingsKeyAtom: SettingsKeyAtomFnType<"tab:confirmclose" | "app:tabbar" | "app:hideaibutton">;
    mockSetWaveObj: WaveEnv["mockSetWaveObj"];
    isWindows: WaveEnv["isWindows"];
    isMacOS: WaveEnv["isMacOS"];
}>;
