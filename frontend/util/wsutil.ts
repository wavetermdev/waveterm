// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// In browser builds `window` is defined and the global `WebSocket` constructor is
// available. When running inside the Electron *main* process (Node context),
// `window` is undefined and we must fall back to the `ws` npm package.

// Import only the *type* from `ws`; the actual module will be required lazily
// to avoid bundling issues when this file is transpiled for the renderer.
import type { WebSocket as NodeWebSocketType } from "ws";

// Lazily initialised reference to the Node-side WebSocket constructor.
let NodeWebSocket: typeof NodeWebSocketType | null = null;

type ComboWebSocket = NodeWebSocketType | WebSocket;

function newWebSocket(
    url: string,
    headers?: { [key: string]: string } | null
): ComboWebSocket {
    // Node / Electron main process path ─ use `ws` package.
    if (typeof window === "undefined") {
        if (!NodeWebSocket) {
            // `require` ensures the module is loaded synchronously to avoid the
            // timing issue that caused "WebSocket is not defined" errors when
            // the previous asynchronous dynamic import had not completed yet.
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            // @ts-ignore – CommonJS require is available in Node context.
            const wsMod = require("ws") as typeof NodeWebSocketType | {
                default: typeof NodeWebSocketType;
            };
            NodeWebSocket = (wsMod as any).default ?? (wsMod as any);
        }
        // At this point NodeWebSocket is guaranteed to be initialised.
        return new NodeWebSocket(url, { headers });
    }

    // Browser / renderer path ─ use the global WebSocket.
    return new WebSocket(url);
}

export { newWebSocket };
export type { ComboWebSocket as WebSocket };
