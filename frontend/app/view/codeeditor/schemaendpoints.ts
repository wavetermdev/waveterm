// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getApi } from "@/app/store/global";
import { getWebServerEndpoint } from "@/util/endpoints";

type EndpointInfo = {
    uri: string;
    fileMatch: Array<string>;
    schema: object;
};

const allFilepaths: Map<string, Array<string>> = new Map();
allFilepaths.set(`${getWebServerEndpoint()}/schema/settings.json`, [`${getApi().getConfigDir()}/settings.json`]);
allFilepaths.set(`${getWebServerEndpoint()}/schema/connections.json`, [`${getApi().getConfigDir()}/connections.json`]);

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
