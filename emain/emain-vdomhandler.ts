import { protocol } from "electron";
import { RpcApi } from "../frontend/app/store/wshclientapi";
import { base64ToArray } from "../frontend/util/util";
import { ElectronWshClient } from "./emain-wsh";

export function registerVDomProtocol() {
    protocol.registerSchemesAsPrivileged([
        {
            scheme: "vdom",
            privileges: {
                standard: true,
                supportFetchAPI: true,
            },
        },
    ]);
}

export function setupVdomUrlHandler() {
    protocol.handle("vdom", async (request) => {
        // Only handle GET requests for now
        if (request.method !== "GET") {
            return new Response(null, {
                status: 405,
                headers: {
                    "Content-Type": "text/plain",
                },
            });
        }

        const parts = request.url.split("/");
        const uuid = parts[2];
        // simple error checking for uuid
        if (!uuid || uuid.length !== 36) {
            return new Response(null, {
                status: 400,
                headers: {
                    "Content-Type": "text/plain",
                },
            });
        }
        const path = "/" + parts.slice(3).join("/");

        // Convert Headers object to plain object
        const headers: Record<string, string> = {};
        for (const [key, value] of request.headers.entries()) {
            headers[key] = value;
        }

        const data: VDomUrlRequestData = {
            method: "GET",
            url: path,
            headers: headers,
        };

        try {
            const respStream = RpcApi.VDomUrlRequestCommand(ElectronWshClient, data, {
                route: `proc:${uuid}`,
            });

            // Get iterator for the stream
            const iterator = respStream[Symbol.asyncIterator]();

            // Get first chunk to extract headers and status
            const firstChunk = await iterator.next();
            if (firstChunk.done) {
                throw new Error("No response received from backend");
            }

            const firstResp = firstChunk.value as VDomUrlRequestResponse;
            const statusCode = firstResp.statuscode ?? 200;
            const responseHeaders = firstResp.headers ?? {};

            const stream = new ReadableStream({
                async start(controller) {
                    try {
                        // Enqueue the body from the first chunk if it exists
                        if (firstResp.body) {
                            controller.enqueue(base64ToArray(firstResp.body));
                        }

                        // Process the rest of the stream
                        while (true) {
                            const chunk = await iterator.next();
                            if (chunk.done) break;

                            const resp = chunk.value as VDomUrlRequestResponse;
                            if (resp.body) {
                                controller.enqueue(base64ToArray(resp.body));
                            }
                        }
                        controller.close();
                    } catch (err) {
                        controller.error(err);
                    }
                },
            });

            return new Response(stream, {
                status: statusCode,
                headers: responseHeaders,
            });
        } catch (err) {
            console.error("VDOM URL handler error:", err);
            return new Response(null, {
                status: 500,
                headers: {
                    "Content-Type": "text/plain",
                },
            });
        }
    });
}
