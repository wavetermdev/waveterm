// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getWebServerEndpoint } from "@/util/endpoints";

type EndpointInfo = {
    uri: string;
    fileMatch: Array<string>;
    schema: object;
};

const allFilepaths: Map<string, Array<string>> = new Map();
allFilepaths.set(`${getWebServerEndpoint()}/schema/settings.json`, ["*/WAVECONFIGPATH/settings.json"]);
allFilepaths.set(`${getWebServerEndpoint()}/schema/connections.json`, ["*/WAVECONFIGPATH/connections.json"]);
allFilepaths.set(`${getWebServerEndpoint()}/schema/aipresets.json`, ["*/WAVECONFIGPATH/presets/ai.json"]);
allFilepaths.set(`${getWebServerEndpoint()}/schema/bgpresets.json`, ["*/WAVECONFIGPATH/presets/bg.json"]);
allFilepaths.set(`${getWebServerEndpoint()}/schema/waveai.json`, ["*/WAVECONFIGPATH/waveai.json"]);
allFilepaths.set(`${getWebServerEndpoint()}/schema/widgets.json`, ["*/WAVECONFIGPATH/widgets.json"]);

async function getSchemaEndpointInfo(endpoint: string): Promise<EndpointInfo> {
    let schema: Object;
    try {
        const data = await fetch(endpoint);
        schema = await data.json();
    } catch (e) {
        console.log("cannot find schema:", e);
        schema = {};
    }
    const fileMatch = allFilepaths.get(endpoint) ?? [];

    return {
        uri: endpoint,
        fileMatch,
        schema,
    };
}

const SchemaEndpoints = Array.from(allFilepaths.keys());

export { getSchemaEndpointInfo, SchemaEndpoints };
