// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { MetaKeyAtomFnType, SettingsKeyAtomFnType, WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";

export type WebViewEnv = WaveEnvSubset<{
    electron: {
        openExternal: WaveEnv["electron"]["openExternal"];
        getWebviewPreload: WaveEnv["electron"]["getWebviewPreload"];
        clearWebviewStorage: WaveEnv["electron"]["clearWebviewStorage"];
        getConfigDir: WaveEnv["electron"]["getConfigDir"];
        setWebviewFocus: WaveEnv["electron"]["setWebviewFocus"];
    };
    rpc: {
        FetchSuggestionsCommand: WaveEnv["rpc"]["FetchSuggestionsCommand"];
        SetMetaCommand: WaveEnv["rpc"]["SetMetaCommand"];
        SetConfigCommand: WaveEnv["rpc"]["SetConfigCommand"];
    };
    wos: WaveEnv["wos"];
    createBlock: WaveEnv["createBlock"];
    getSettingsKeyAtom: SettingsKeyAtomFnType<"web:defaulturl" | "web:defaultsearch">;
    getBlockMetaKeyAtom: MetaKeyAtomFnType<
        "web:hidenav" | "web:useragenttype" | "web:zoom" | "web:partition"
    >;
}>;
