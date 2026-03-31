// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    ConnConfigKeyAtomFnType,
    MetaKeyAtomFnType,
    SettingsKeyAtomFnType,
    WaveEnv,
    WaveEnvSubset,
} from "@/app/waveenv/waveenv";

export type BlockEnv = WaveEnvSubset<{
    getSettingsKeyAtom: SettingsKeyAtomFnType<
        | "app:focusfollowscursor"
        | "app:showoverlayblocknums"
        | "term:showsplitbuttons"
        | "window:magnifiedblockblurprimarypx"
        | "window:magnifiedblockopacity"
    >;
    showContextMenu: WaveEnv["showContextMenu"];
    atoms: {
        modalOpen: WaveEnv["atoms"]["modalOpen"];
        controlShiftDelayAtom: WaveEnv["atoms"]["controlShiftDelayAtom"];
    };
    electron: {
        openExternal: WaveEnv["electron"]["openExternal"];
    };
    rpc: {
        ActivityCommand: WaveEnv["rpc"]["ActivityCommand"];
        ConnEnsureCommand: WaveEnv["rpc"]["ConnEnsureCommand"];
        ConnDisconnectCommand: WaveEnv["rpc"]["ConnDisconnectCommand"];
        ConnConnectCommand: WaveEnv["rpc"]["ConnConnectCommand"];
        SetConnectionsConfigCommand: WaveEnv["rpc"]["SetConnectionsConfigCommand"];
        DismissWshFailCommand: WaveEnv["rpc"]["DismissWshFailCommand"];
    };
    wos: WaveEnv["wos"];
    getConnStatusAtom: WaveEnv["getConnStatusAtom"];
    getLocalHostDisplayNameAtom: WaveEnv["getLocalHostDisplayNameAtom"];
    getConnConfigKeyAtom: ConnConfigKeyAtomFnType<"conn:wshenabled">;
    getBlockMetaKeyAtom: MetaKeyAtomFnType<
        | "frame:text"
        | "frame:activebordercolor"
        | "frame:bordercolor"
        | "view"
        | "connection"
        | "icon:color"
        | "frame:title"
        | "frame:icon"
    >;
    getTabMetaKeyAtom: MetaKeyAtomFnType<"bg:activebordercolor" | "bg:bordercolor" | "tab:background">;
    getConfigBackgroundAtom: WaveEnv["getConfigBackgroundAtom"];
}>;
