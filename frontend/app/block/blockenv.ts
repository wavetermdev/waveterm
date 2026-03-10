// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockMetaKeyAtomFnType, ConnConfigKeyAtomFnType, SettingsKeyAtomFnType, WaveEnv } from "@/app/waveenv/waveenv";

export type BlockEnv = {
    getSettingsKeyAtom: SettingsKeyAtomFnType<
        | "app:focusfollowscursor"
        | "app:showoverlayblocknums"
        | "window:magnifiedblockblurprimarypx"
        | "window:magnifiedblockopacity"
    >;
    atoms: {
        modalOpen: WaveEnv["atoms"]["modalOpen"];
        controlShiftDelayAtom: WaveEnv["atoms"]["controlShiftDelayAtom"];
    };
    api: {
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
    getConnConfigKeyAtom: ConnConfigKeyAtomFnType<"conn:wshenabled">;
    getBlockMetaKeyAtom: BlockMetaKeyAtomFnType<
        | "frame:text"
        | "frame:activebordercolor"
        | "frame:bordercolor"
        | "view"
        | "connection"
        | "icon:color"
        | "frame:title"
        | "frame:icon"
    >;
};
