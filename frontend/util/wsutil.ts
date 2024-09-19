import type { WebSocket as NodeWebSocketType } from "ws";

let NodeWebSocket: typeof NodeWebSocketType = null;

if (typeof window === "undefined") {
    try {
        // Necessary to avoid issues with Rollup: https://github.com/websockets/ws/issues/2057
        process.env.WS_NO_BUFFER_UTIL = "1";
        import("ws").then((ws) => (NodeWebSocket = ws.default));
    } catch (error) {
        console.log("Error importing 'ws':", error);
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
