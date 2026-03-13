// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { SettingsKeyAtomFnType, WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";

export type VTabBarEnv = WaveEnvSubset<{
    electron: {
        createTab: WaveEnv["electron"]["createTab"];
        closeTab: WaveEnv["electron"]["closeTab"];
        setActiveTab: WaveEnv["electron"]["setActiveTab"];
    };
    rpc: {
        UpdateWorkspaceTabIdsCommand: WaveEnv["rpc"]["UpdateWorkspaceTabIdsCommand"];
        UpdateTabNameCommand: WaveEnv["rpc"]["UpdateTabNameCommand"];
    };
    atoms: {
        staticTabId: WaveEnv["atoms"]["staticTabId"];
        fullConfigAtom: WaveEnv["atoms"]["fullConfigAtom"];
        reinitVersion: WaveEnv["atoms"]["reinitVersion"];
    };
    wos: WaveEnv["wos"];
    getSettingsKeyAtom: SettingsKeyAtomFnType<"tab:confirmclose">;
    mockSetWaveObj: WaveEnv["mockSetWaveObj"];
    isWindows: WaveEnv["isWindows"];
    isMacOS: WaveEnv["isMacOS"];
}>;
