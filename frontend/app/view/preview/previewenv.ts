// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { SettingsKeyAtomFnType, WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";

export type PreviewEnv = WaveEnvSubset<{
    electron: {
        onQuicklook: WaveEnv["electron"]["onQuicklook"];
    };
    rpc: {
        ConnEnsureCommand: WaveEnv["rpc"]["ConnEnsureCommand"];
        FileInfoCommand: WaveEnv["rpc"]["FileInfoCommand"];
        FileReadCommand: WaveEnv["rpc"]["FileReadCommand"];
        FileListStreamCommand: WaveEnv["rpc"]["FileListStreamCommand"];
        FileWriteCommand: WaveEnv["rpc"]["FileWriteCommand"];
        FileMoveCommand: WaveEnv["rpc"]["FileMoveCommand"];
        FileDeleteCommand: WaveEnv["rpc"]["FileDeleteCommand"];
        SetConfigCommand: WaveEnv["rpc"]["SetConfigCommand"];
        SetMetaCommand: WaveEnv["rpc"]["SetMetaCommand"];
        FetchSuggestionsCommand: WaveEnv["rpc"]["FetchSuggestionsCommand"];
        DisposeSuggestionsCommand: WaveEnv["rpc"]["DisposeSuggestionsCommand"];
        FileCopyCommand: WaveEnv["rpc"]["FileCopyCommand"];
        FileCreateCommand: WaveEnv["rpc"]["FileCreateCommand"];
        FileMkdirCommand: WaveEnv["rpc"]["FileMkdirCommand"];
    };
    atoms: {
        fullConfigAtom: WaveEnv["atoms"]["fullConfigAtom"];
    };
    services: {
        object: WaveEnv["services"]["object"];
    };
    wos: WaveEnv["wos"];
    getSettingsKeyAtom: SettingsKeyAtomFnType<"preview:showhiddenfiles" | "editor:fontsize" | "preview:defaultsort">;
    getConnStatusAtom: WaveEnv["getConnStatusAtom"];
}>;
