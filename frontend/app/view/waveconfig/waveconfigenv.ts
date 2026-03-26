// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { MetaKeyAtomFnType, WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";

export type WaveConfigEnv = WaveEnvSubset<{
    electron: {
        getConfigDir: WaveEnv["electron"]["getConfigDir"];
        getPlatform: WaveEnv["electron"]["getPlatform"];
    };
    rpc: {
        FileInfoCommand: WaveEnv["rpc"]["FileInfoCommand"];
        FileReadCommand: WaveEnv["rpc"]["FileReadCommand"];
        FileWriteCommand: WaveEnv["rpc"]["FileWriteCommand"];
        SetMetaCommand: WaveEnv["rpc"]["SetMetaCommand"];
        GetSecretsLinuxStorageBackendCommand: WaveEnv["rpc"]["GetSecretsLinuxStorageBackendCommand"];
        GetSecretsNamesCommand: WaveEnv["rpc"]["GetSecretsNamesCommand"];
        GetSecretsCommand: WaveEnv["rpc"]["GetSecretsCommand"];
        SetSecretsCommand: WaveEnv["rpc"]["SetSecretsCommand"];
        RecordTEventCommand: WaveEnv["rpc"]["RecordTEventCommand"];
    };
    atoms: {
        fullConfigAtom: WaveEnv["atoms"]["fullConfigAtom"];
    };
    getBlockMetaKeyAtom: MetaKeyAtomFnType<"file">;
    isWindows: WaveEnv["isWindows"];
}>;
