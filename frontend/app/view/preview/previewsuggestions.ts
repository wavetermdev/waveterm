// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { TabRpcClient } from "@/app/store/wshrpcutil";
import { WaveEnv, WaveEnvSubset } from "@/app/waveenv/waveenv";
import { isBlank, makeConnRoute } from "@/util/util";

export type PreviewSuggestionsEnv = WaveEnvSubset<{
    rpc: {
        FetchSuggestionsCommand: WaveEnv["rpc"]["FetchSuggestionsCommand"];
        DisposeSuggestionsCommand: WaveEnv["rpc"]["DisposeSuggestionsCommand"];
    };
}>;

type FetchPreviewFileSuggestionsOpts = {
    cwd?: string;
    connection?: string;
};

export async function fetchPreviewFileSuggestions(
    env: PreviewSuggestionsEnv,
    query: string,
    reqContext: SuggestionRequestContext,
    opts?: FetchPreviewFileSuggestionsOpts
): Promise<FetchSuggestionsResponse> {
    let route = makeConnRoute(opts?.connection);
    if (isBlank(opts?.connection)) {
        route = null;
    }
    if (reqContext?.dispose) {
        env.rpc.DisposeSuggestionsCommand(TabRpcClient, reqContext.widgetid, { noresponse: true, route });
        return null;
    }
    return await env.rpc.FetchSuggestionsCommand(
        TabRpcClient,
        {
            suggestiontype: "file",
            "file:cwd": opts?.cwd ?? "~",
            query,
            widgetid: reqContext.widgetid,
            reqnum: reqContext.reqnum,
            "file:connection": opts?.connection,
        },
        { route }
    );
}
