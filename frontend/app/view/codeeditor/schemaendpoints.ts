// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getApi } from "@/app/store/global";
import { getWebServerEndpoint } from "@/util/endpoints";

type EndpointInfo = {
    uri: string;
    fileMatch: Array<string>;
    schema: object;
};

function prependWildcard(path: string): string {
    return path.startsWith("/") ? `*${path}` : `*/${path}`;
}

function convertToTildePath(absolutePath: string): string {
    const homeDir = getApi().getHomeDir();
    if (absolutePath.startsWith(homeDir)) {
        return "~" + absolutePath.slice(homeDir.length);
    }
    return absolutePath;
}

function makeConfigPathMatches(suffix: string): Array<string> {
    const configPath = `${getApi().getConfigDir()}${suffix}`;
    const tildePath = convertToTildePath(configPath);
    const paths = [configPath, prependWildcard(configPath)];
    if (tildePath !== configPath) {
        paths.push(tildePath);
        paths.push(prependWildcard(tildePath));
    }
    return paths;
}

const allFilepaths: Map<string, Array<string>> = new Map();
allFilepaths.set(`${getWebServerEndpoint()}/schema/settings.json`, makeConfigPathMatches("/settings.json"));
allFilepaths.set(`${getWebServerEndpoint()}/schema/connections.json`, makeConfigPathMatches("/connections.json"));
allFilepaths.set(`${getWebServerEndpoint()}/schema/aipresets.json`, makeConfigPathMatches("/presets/ai.json"));
allFilepaths.set(`${getWebServerEndpoint()}/schema/bgpresets.json`, makeConfigPathMatches("/presets/bg.json"));
allFilepaths.set(`${getWebServerEndpoint()}/schema/waveai.json`, makeConfigPathMatches("/waveai.json"));
allFilepaths.set(`${getWebServerEndpoint()}/schema/widgets.json`, makeConfigPathMatches("/widgets.json"));

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
