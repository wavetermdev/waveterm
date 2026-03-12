// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { SettingsKeyAtomFnType, WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";

export type TabBarEnv = WaveEnvSubset<{
    electron: {
        createTab: WaveEnv["electron"]["createTab"];
        closeTab: WaveEnv["electron"]["closeTab"];
        setActiveTab: WaveEnv["electron"]["setActiveTab"];
        showWorkspaceAppMenu: WaveEnv["electron"]["showWorkspaceAppMenu"];
        installAppUpdate: WaveEnv["electron"]["installAppUpdate"];
    };
    rpc: {
        UpdateWorkspaceTabIdsCommand: WaveEnv["rpc"]["UpdateWorkspaceTabIdsCommand"];
    };
    atoms: {
        fullConfigAtom: WaveEnv["atoms"]["fullConfigAtom"];
        hasConfigErrors: WaveEnv["atoms"]["hasConfigErrors"];
        staticTabId: WaveEnv["atoms"]["staticTabId"];
        isFullScreen: WaveEnv["atoms"]["isFullScreen"];
        zoomFactorAtom: WaveEnv["atoms"]["zoomFactorAtom"];
        reinitVersion: WaveEnv["atoms"]["reinitVersion"];
        updaterStatusAtom: WaveEnv["atoms"]["updaterStatusAtom"];
    };
    wos: WaveEnv["wos"];
    getSettingsKeyAtom: SettingsKeyAtomFnType<"app:hideaibutton" | "tab:confirmclose" | "window:showmenubar">;
    mockSetWaveObj: WaveEnv["mockSetWaveObj"];
    isWindows: WaveEnv["isWindows"];
    isMacOS: WaveEnv["isMacOS"];
}>;
