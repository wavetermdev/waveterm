// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { WebSocket as NodeWebSocketType } from "ws";

let NodeWebSocket: any = null;

if (typeof window === "undefined" || (typeof process !== "undefined" && process.type === "browser")) {
    try {
        NodeWebSocket = require("ws").WebSocket;
    } catch (e) {
        import("ws").then((ws) => (NodeWebSocket = ws.default)).catch((e) => console.log("ws import error:", e));
    }
}

type ComboWebSocket = NodeWebSocketType | WebSocket;

function newWebSocket(url: string, headers: { [key: string]: string }): ComboWebSocket {
    if (NodeWebSocket) {
        return new NodeWebSocket(url, { headers });
    } else {
        if (typeof WebSocket === "undefined") {
            throw new Error("WebSocket not available in this environment");
        }
        return new WebSocket(url);
    }
}

export { newWebSocket };
export type { ComboWebSocket as WebSocket };
