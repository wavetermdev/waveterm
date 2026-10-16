// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getWebServerEndpoint } from "@/util/endpoints";

// Electron attaches Wave's authentication header to requests to its local server.
export async function localApi<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`${getWebServerEndpoint()}/wave/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
        signal,
    });
    if (!response.ok) throw new Error((await response.text()).slice(0, 500));
    return response.json();
}
