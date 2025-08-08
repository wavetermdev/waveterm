// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { WebSocket as NodeWebSocketType } from "ws";

let NodeWebSocket: typeof NodeWebSocketType = null;

if (typeof window === "undefined") {
    // Synchronous require in Node.js (Electron main process)
    // The async import was causing timing issues where newWebSocket was called
    // before the dynamic import resolved, falling back to browser WebSocket which doesn't exist in Node.js
    try {
        NodeWebSocket = require("ws");
    } catch (e) {
        console.log("Error importing 'ws':", e);
    }
}

type ComboWebSocket = NodeWebSocketType | WebSocket;

function newWebSocket(url: string, headers: { [key: string]: string }): ComboWebSocket {
    if (NodeWebSocket) {
        return new NodeWebSocket(url, { headers });
    } else {
        return new WebSocket(url);
    }
}

export { newWebSocket };
export type { ComboWebSocket as WebSocket };
