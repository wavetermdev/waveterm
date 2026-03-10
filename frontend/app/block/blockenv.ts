// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockMetaKeyAtomFnType, WaveEnv } from "@/app/waveenv/waveenv";

export type BlockEnv = {
    settingsAtoms: {
        "app:focusfollowscursor": WaveEnv["settingsAtoms"]["app:focusfollowscursor"];
        "app:showoverlayblocknums": WaveEnv["settingsAtoms"]["app:showoverlayblocknums"];
        "window:magnifiedblockblurprimarypx": WaveEnv["settingsAtoms"]["window:magnifiedblockblurprimarypx"];
        "window:magnifiedblockopacity": WaveEnv["settingsAtoms"]["window:magnifiedblockopacity"];
    };
    atoms: {
        modalOpen: WaveEnv["atoms"]["modalOpen"];
        controlShiftDelayAtom: WaveEnv["atoms"]["controlShiftDelayAtom"];
    };
    rpc: {
        ActivityCommand: WaveEnv["rpc"]["ActivityCommand"];
        ConnEnsureCommand: WaveEnv["rpc"]["ConnEnsureCommand"];
    };
    useWaveObjectValue: WaveEnv["useWaveObjectValue"];
    isWaveObjectNullAtom: WaveEnv["isWaveObjectNullAtom"];
    getBlockMetaKeyAtom: BlockMetaKeyAtomFnType<"frame:text" | "frame:activebordercolor" | "frame:bordercolor" | "view" | "connection" | "icon:color" | "frame:title" | "frame:icon">;
};
