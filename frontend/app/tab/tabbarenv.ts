// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { SettingsKeyAtomFnType, WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";

export type TabBarEnv = WaveEnvSubset<{
    electron: {
        createTab: WaveEnv["electron"]["createTab"];
        closeTab: WaveEnv["electron"]["closeTab"];
        setActiveTab: WaveEnv["electron"]["setActiveTab"];
        showWorkspaceAppMenu: WaveEnv["electron"]["showWorkspaceAppMenu"];
    };
    atoms: {
        fullConfigAtom: WaveEnv["atoms"]["fullConfigAtom"];
        staticTabId: WaveEnv["atoms"]["staticTabId"];
        isFullScreen: WaveEnv["atoms"]["isFullScreen"];
        zoomFactorAtom: WaveEnv["atoms"]["zoomFactorAtom"];
        settingsAtom: WaveEnv["atoms"]["settingsAtom"];
        reinitVersion: WaveEnv["atoms"]["reinitVersion"];
    };
    getSettingsKeyAtom: SettingsKeyAtomFnType<"app:hideaibutton" | "tab:confirmclose">;
    isWindows: WaveEnv["isWindows"];
    isMacOS: WaveEnv["isMacOS"];
}>;
