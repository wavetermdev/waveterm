// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { WebContents } from "electron";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { URL } from "node:url";
import WebSocket, { WebSocketServer } from "ws";

export type CdpProxyStartOpts = {
    host?: string; // default 127.0.0.1
    port?: number; // default 0 (ephemeral)
    idleTimeoutMs?: number; // default 10 minutes
};

export type WebCdpTargetInfo = {
    key: string;
    workspaceid: string;
    tabid: string;
    blockid: string;

    host: string;
    port: number;
    targetid: string;
    wsPath: string;
    wsUrl: string;
    httpUrl: string;
    inspectorUrl: string;
};

type CdpProxyInstance = {
    key: string;
    workspaceid: string;
    tabid: string;
    blockid: string;

    host: string;
    port: number;
    targetid: string;
    wsPath: string;

    server: http.Server;
    wss: WebSocketServer;

    wc: WebContents;
    debuggerAttached: boolean;
    clients: Set<WebSocket>;
    idleTimer: NodeJS.Timeout | null;
    idleTimeoutMs: number;
};

const proxyMap = new Map<string, CdpProxyInstance>();

function makeKey(workspaceid: string, tabid: string, blockid: string): string {
    return `${workspaceid}:${tabid}:${blockid}`;
}

function safeJsonSend(ws: WebSocket, obj: any) {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
        ws.send(JSON.stringify(obj));
    } catch (_) {}
}

function getWsHostForUrl(host: string): string {
    // For inspector URLs, 0.0.0.0 is not a valid connect target; use loopback.
    if (host === "0.0.0.0") return "127.0.0.1";
    return host;
}

function refreshIdleTimer(inst: CdpProxyInstance) {
    if (inst.idleTimeoutMs <= 0) return;
    if (inst.idleTimer) clearTimeout(inst.idleTimer);
    inst.idleTimer = setTimeout(() => {
        if (inst.clients.size === 0) {
            stopWebCdpProxy(inst.key).catch(() => {});
        }
    }, inst.idleTimeoutMs);
}

async function ensureDebuggerAttached(inst: CdpProxyInstance) {
    if (inst.debuggerAttached) return;
    try {
        // "1.3" is the commonly-used version string in Electron docs; Electron will negotiate.
        inst.wc.debugger.attach("1.3");
        inst.debuggerAttached = true;
    } catch (e: any) {
        const msg = e?.message || String(e);
        if (msg.includes("already attached")) {
            throw new Error(
                "CDP attach failed: another debugger is already attached (close DevTools for this webview)"
            );
        }
        throw new Error(`CDP attach failed: ${msg}`);
    }
}

function attachDebuggerEventForwarders(inst: CdpProxyInstance) {
    // Forward CDP events to all connected WS clients.
    const onMessage = (_event: any, method: string, params: any) => {
        for (const ws of inst.clients) {
            safeJsonSend(ws, { method, params });
        }
    };
    const onDetach = () => {
        inst.debuggerAttached = false;
    };
    inst.wc.debugger.on("message", onMessage);
    inst.wc.debugger.on("detach", onDetach);

    // Tear down if the target dies.
    inst.wc.once("destroyed", () => {
        stopWebCdpProxy(inst.key).catch(() => {});
    });
}

function makeJsonListEntry(inst: CdpProxyInstance): any {
    const hostForUrl = getWsHostForUrl(inst.host);
    const wsUrl = `ws://${hostForUrl}:${inst.port}${inst.wsPath}`;
    // Provide a devtoolsFrontendUrl that Chrome can open directly.
    const devtoolsFrontendUrl = `/devtools/inspector.html?ws=${hostForUrl}:${inst.port}${inst.wsPath}`;
    let url = "";
    try {
        url = inst.wc.getURL();
    } catch (_) {}
    let title = "";
    try {
        title = inst.wc.getTitle();
    } catch (_) {}
    return {
        description: "Wave WebView (web block)",
        devtoolsFrontendUrl,
        id: inst.targetid,
        title: title || "Wave WebView",
        type: "page",
        url,
        webSocketDebuggerUrl: wsUrl,
    };
}

function respondJson(res: http.ServerResponse, status: number, obj: any) {
    const body = JSON.stringify(obj);
    res.statusCode = status;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end(body);
}

function respondText(res: http.ServerResponse, status: number, text: string) {
    res.statusCode = status;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end(text);
}

async function createServer(inst: Omit<CdpProxyInstance, "server" | "wss" | "port"> & { port: number }) {
    const server = http.createServer((req, res) => {
        if (!req.url) {
            respondText(res, 400, "missing url");
            return;
        }
        const parsed = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
        if (req.method === "GET" && parsed.pathname === "/json/version") {
            respondJson(res, 200, {
                Browser: "Wave (Electron)",
                "Protocol-Version": "1.3",
            });
            return;
        }
        if (req.method === "GET" && (parsed.pathname === "/json" || parsed.pathname === "/json/list")) {
            const entry = makeJsonListEntry(inst as any);
            respondJson(res, 200, [entry]);
            return;
        }
        respondText(res, 404, "not found");
    });

    const wss = new WebSocketServer({ noServer: true });
    server.on("upgrade", (req, socket, head) => {
        try {
            const urlObj = new URL(req.url || "", `http://${req.headers.host || "127.0.0.1"}`);
            if (urlObj.pathname !== inst.wsPath) {
                socket.destroy();
                return;
            }
        } catch (_) {
            socket.destroy();
            return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit("connection", ws, req);
        });
    });

    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(inst.port, inst.host, () => resolve());
    });

    const address = server.address();
    let actualPort = inst.port;
    if (address && typeof address === "object") {
        actualPort = address.port;
    }

    return { server, wss, port: actualPort };
}

export async function startWebCdpProxy(
    wc: WebContents,
    workspaceid: string,
    tabid: string,
    blockid: string,
    opts?: CdpProxyStartOpts
): Promise<WebCdpTargetInfo> {
    const key = makeKey(workspaceid, tabid, blockid);
    const existing = proxyMap.get(key);
    if (existing) {
        const hostForUrl = getWsHostForUrl(existing.host);
        const wsUrl = `ws://${hostForUrl}:${existing.port}${existing.wsPath}`;
        const httpUrl = `http://${hostForUrl}:${existing.port}`;
        return {
            key,
            workspaceid,
            tabid,
            blockid,
            host: existing.host,
            port: existing.port,
            targetid: existing.targetid,
            wsPath: existing.wsPath,
            wsUrl,
            httpUrl,
            inspectorUrl: `devtools://devtools/bundled/inspector.html?ws=${hostForUrl}:${existing.port}${existing.wsPath}`,
        };
    }

    const host = opts?.host ?? "127.0.0.1";
    const port = opts?.port ?? 0;
    const idleTimeoutMs = opts?.idleTimeoutMs ?? 10 * 60 * 1000;
    const targetid = randomUUID().replace(/-/g, "");
    const wsPath = `/devtools/page/${targetid}`;

    const instPre: any = {
        key,
        workspaceid,
        tabid,
        blockid,
        host,
        port,
        targetid,
        wsPath,
        wc,
        debuggerAttached: false,
        clients: new Set<WebSocket>(),
        idleTimer: null,
        idleTimeoutMs,
    };

    const { server, wss, port: actualPort } = await createServer(instPre);
    // Important: createServer() closes over instPre for /json/list responses.
    // If the caller requested port=0, the OS assigns an ephemeral port. Update instPre.port so /json/list reports
    // the actual port instead of ":0".
    instPre.port = actualPort;

    const inst: CdpProxyInstance = {
        ...instPre,
        server,
        wss,
        port: actualPort,
    };
    proxyMap.set(key, inst);
    refreshIdleTimer(inst);

    attachDebuggerEventForwarders(inst);

    wss.on("connection", async (ws) => {
        inst.clients.add(ws);
        refreshIdleTimer(inst);
        try {
            await ensureDebuggerAttached(inst);
        } catch (e: any) {
            safeJsonSend(ws, { error: e?.message || String(e) });
            try {
                ws.close();
            } catch (_) {}
            return;
        }

        ws.on("message", async (data) => {
            refreshIdleTimer(inst);
            let msg: any;
            try {
                msg = JSON.parse(data.toString());
            } catch (_) {
                safeJsonSend(ws, { id: null, error: { code: -32700, message: "Parse error" } });
                return;
            }
            const id = msg?.id;
            const method = msg?.method;
            const params = msg?.params;
            if (id == null || typeof method !== "string") {
                safeJsonSend(ws, { id: id ?? null, error: { code: -32600, message: "Invalid Request" } });
                return;
            }
            try {
                const result = await inst.wc.debugger.sendCommand(method, params);
                safeJsonSend(ws, { id, result });
            } catch (e: any) {
                safeJsonSend(ws, { id, error: { code: -32000, message: e?.message || String(e) } });
            }
        });

        ws.on("close", () => {
            inst.clients.delete(ws);
            refreshIdleTimer(inst);
        });
    });

    const hostForUrl = getWsHostForUrl(host);
    const wsUrl = `ws://${hostForUrl}:${actualPort}${wsPath}`;
    const httpUrl = `http://${hostForUrl}:${actualPort}`;
    return {
        key,
        workspaceid,
        tabid,
        blockid,
        host,
        port: actualPort,
        targetid,
        wsPath,
        wsUrl,
        httpUrl,
        inspectorUrl: `devtools://devtools/bundled/inspector.html?ws=${hostForUrl}:${actualPort}${wsPath}`,
    };
}

export async function stopWebCdpProxy(key: string): Promise<void> {
    const inst = proxyMap.get(key);
    if (!inst) return;
    proxyMap.delete(key);
    if (inst.idleTimer) {
        clearTimeout(inst.idleTimer);
        inst.idleTimer = null;
    }
    for (const ws of inst.clients) {
        try {
            ws.close();
        } catch (_) {}
    }
    inst.clients.clear();
    try {
        inst.wss.close();
    } catch (_) {}
    await new Promise<void>((resolve) => {
        try {
            inst.server.close(() => resolve());
        } catch (_) {
            resolve();
        }
    });
    try {
        if (inst.debuggerAttached) {
            inst.wc.debugger.detach();
            inst.debuggerAttached = false;
        }
    } catch (_) {}
}

export async function stopWebCdpProxyForTarget(workspaceid: string, tabid: string, blockid: string): Promise<void> {
    const key = makeKey(workspaceid, tabid, blockid);
    return stopWebCdpProxy(key);
}

export function getWebCdpProxyStatus(): WebCdpTargetInfo[] {
    const out: WebCdpTargetInfo[] = [];
    for (const inst of proxyMap.values()) {
        const hostForUrl = getWsHostForUrl(inst.host);
        const wsUrl = `ws://${hostForUrl}:${inst.port}${inst.wsPath}`;
        const httpUrl = `http://${hostForUrl}:${inst.port}`;
        out.push({
            key: inst.key,
            workspaceid: inst.workspaceid,
            tabid: inst.tabid,
            blockid: inst.blockid,
            host: inst.host,
            port: inst.port,
            targetid: inst.targetid,
            wsPath: inst.wsPath,
            wsUrl,
            httpUrl,
            inspectorUrl: `devtools://devtools/bundled/inspector.html?ws=${hostForUrl}:${inst.port}${inst.wsPath}`,
        });
    }
    return out;
}
