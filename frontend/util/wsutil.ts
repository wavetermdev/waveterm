// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { WebSocket as NodeWebSocketType } from "ws";

let NodeWebSocket: typeof NodeWebSocketType = null;

if (typeof window === "undefined") {
    // Necessary to avoid issues with Rollup: https://github.com/websockets/ws/issues/2057
    import("ws")
        .then((ws) => (NodeWebSocket = ws.default))
        .catch((e) => {
            console.log("Error importing 'ws':", e);
        });
}

type ComboWebSocket = NodeWebSocketType | WebSocket;

function newWebSocket(url: string, headers: { [key: string]: string }): ComboWebSocket {
    if (typeof window === "undefined" && NodeWebSocket) {
        return new NodeWebSocket(url, { headers });
    } else if (typeof WebSocket !== "undefined") {
        return new WebSocket(url);
    } else {
        throw new Error("WebSocket is not available in this environment");
    }
}

export { newWebSocket };
export type { ComboWebSocket as WebSocket };
