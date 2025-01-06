// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Utility to abstract the fetch function so the Electron net module can be used when available.

let net: Electron.Net;

if (typeof window === "undefined") {
    try {
        import("electron").then(({ net: electronNet }) => (net = electronNet));
    } catch (e) {
        // do nothing
    }
}

export function fetch(input: string | GlobalRequest | URL, init?: RequestInit): Promise<Response> {
    if (net) {
        return net.fetch(input.toString(), init);
    } else {
        return globalThis.fetch(input, init);
    }
}
