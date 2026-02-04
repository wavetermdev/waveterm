// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ipcMain, webContents } from "electron";
import type { WebContents } from "electron";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { URL } from "node:url";
import WebSocket, { WebSocketServer } from "ws";

// ---- Public API (used by emain.ts / emain-wsh.ts) ---------------------------

export type WebCdpServerConfig = {
    enabled: boolean;
    port: number; // default 9222
    idleDetachMs?: number; // default 30000
};

export type WebCdpBlockOps = {
    createWebBlock?: (url: string) => Promise<string>; // returns blockId
    deleteBlock?: (blockId: string) => Promise<void>;
};

export type WebCdpTargetInfo = {
    host: string;
    port: number;
    targetid: string;
    blockid: string;
    wsPath: string;
    wsUrl: string;
    httpUrl: string;
    inspectorUrl: string;
    controlled: boolean;
};

// Configure (injected) block creation/deletion handlers.
let blockOps: WebCdpBlockOps = {};
export function setWebCdpBlockOps(ops: WebCdpBlockOps) {
    blockOps = ops ?? {};
}

// Start/stop shared server from emain.ts once config is known.
export async function configureWebCdpServer(cfg: WebCdpServerConfig) {
    serverCfg = {
        enabled: !!cfg?.enabled,
        port: cfg?.port ?? 9222,
        idleDetachMs: cfg?.idleDetachMs ?? 30_000,
    };
    if (!serverCfg.enabled) {
        await stopSharedServer();
        return;
    }
    await ensureSharedServer();
}

// For WSH/UI: list targets that are currently controlled.
export function getControlledWebCdpTargets(): WebCdpTargetInfo[] {
    const out: WebCdpTargetInfo[] = [];
    for (const t of targetsById.values()) {
        if (!t.controlled()) continue;
        out.push(makeTargetInfo(t));
    }
    return out;
}

// For WSH/UI: return connection info for a specific block (even if not controlled).
export function getWebCdpTargetForBlock(blockid: string): WebCdpTargetInfo | null {
    const t = targetsById.get(blockid);
    if (!t) return null;
    return makeTargetInfo(t);
}

// For WSH: explicitly register a target when the caller already has WebContents.
export function registerWebCdpTarget(blockid: string, wc: WebContents): WebCdpTargetInfo {
    const t = registerTarget(blockid, wc);
    return makeTargetInfo(t);
}

// For WSH: drop control for a target (disconnect clients + detach debugger).
export function stopWebCdpForBlock(blockid: string) {
    const t = targetsById.get(blockid);
    if (!t) return;
    for (const ws of t.clients) {
        try {
            ws.close();
        } catch (_) {}
    }
    t.clients.clear();
    detachDebugger(t);
}

// ---- Internal implementation ------------------------------------------------

type TargetInstance = {
    id: string; // Chrome target id; we use blockid
    blockid: string;
    wc: WebContents;
    clients: Set<WebSocket>;
    debuggerAttached: boolean;
    idleTimer: NodeJS.Timeout | null;
    destroyedUnsub: (() => void) | null;
    dbgMsgHandler: ((event: any, method: string, params: any) => void) | null;
    dbgDetachHandler: (() => void) | null;
    controlled: () => boolean;
};

const HOST = "127.0.0.1";
const WS_PAGE_PREFIX = "/devtools/page/";

let serverCfg: WebCdpServerConfig = { enabled: false, port: 9222, idleDetachMs: 30_000 };

let httpServer: http.Server | null = null;
let wsServer: WebSocketServer | null = null;
let actualPort: number | null = null;

// blockId == targetId for now
const targetsById = new Map<string, TargetInstance>();

let discoveryPoller: NodeJS.Timeout | null = null;

function safeJsonSend(ws: WebSocket, obj: any) {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
        ws.send(JSON.stringify(obj));
    } catch (_) {}
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

function makeWsPath(targetId: string) {
    return `${WS_PAGE_PREFIX}${targetId}`;
}

function makeWsUrl(targetId: string) {
    const port = actualPort ?? serverCfg.port;
    return `ws://${HOST}:${port}${makeWsPath(targetId)}`;
}

function makeHttpUrl() {
    const port = actualPort ?? serverCfg.port;
    return `http://${HOST}:${port}`;
}

function makeTargetInfo(t: TargetInstance): WebCdpTargetInfo {
    const wsPath = makeWsPath(t.id);
    const wsUrl = makeWsUrl(t.id);
    const httpUrl = makeHttpUrl();
    return {
        host: HOST,
        port: actualPort ?? serverCfg.port,
        targetid: t.id,
        blockid: t.blockid,
        wsPath,
        wsUrl,
        httpUrl,
        inspectorUrl: `devtools://devtools/bundled/inspector.html?ws=${HOST}:${actualPort ?? serverCfg.port}${wsPath}`,
        controlled: t.controlled(),
    };
}

function makeChromeJsonEntry(t: TargetInstance): any {
    let url = "";
    let title = "";
    try {
        url = t.wc.getURL();
    } catch (_) {}
    try {
        title = t.wc.getTitle();
    } catch (_) {}
    return {
        description: "Wave WebView (web widget)",
        id: t.id,
        title: title || "Wave WebView",
        type: "page",
        url,
        webSocketDebuggerUrl: makeWsUrl(t.id),
    };
}

async function ensureDebuggerAttached(t: TargetInstance) {
    if (t.debuggerAttached) return;
    try {
        t.wc.debugger.attach("1.3");
        t.debuggerAttached = true;
    } catch (e: any) {
        const msg = e?.message || String(e);
        if (msg.includes("already attached")) {
            throw new Error("CDP attach failed: target already has a debugger attached");
        }
        throw new Error(`CDP attach failed: ${msg}`);
    }

    // Attach forwarders once.
    if (!t.dbgMsgHandler) {
        t.dbgMsgHandler = (_event: any, method: string, params: any) => {
            for (const ws of t.clients) {
                safeJsonSend(ws, { method, params });
            }
        };
        t.wc.debugger.on("message", t.dbgMsgHandler);
    }
    if (!t.dbgDetachHandler) {
        t.dbgDetachHandler = () => {
            t.debuggerAttached = false;
        };
        t.wc.debugger.on("detach", t.dbgDetachHandler);
    }
}

function detachDebugger(t: TargetInstance) {
    if (t.idleTimer) {
        clearTimeout(t.idleTimer);
        t.idleTimer = null;
    }
    try {
        if (t.debuggerAttached) {
            t.wc.debugger.detach();
        }
    } catch (_) {}
    t.debuggerAttached = false;
    // Remove listeners to avoid leaks if this webcontents gets re-used.
    try {
        if (t.dbgMsgHandler) {
            t.wc.debugger.removeListener("message", t.dbgMsgHandler as any);
        }
        if (t.dbgDetachHandler) {
            t.wc.debugger.removeListener("detach", t.dbgDetachHandler as any);
        }
    } catch (_) {}
    t.dbgMsgHandler = null;
    t.dbgDetachHandler = null;
}

function scheduleIdleDetach(t: TargetInstance) {
    const idleMs = serverCfg.idleDetachMs ?? 30_000;
    if (idleMs <= 0) return;
    if (t.idleTimer) clearTimeout(t.idleTimer);
    t.idleTimer = setTimeout(() => {
        if (t.clients.size === 0) {
            detachDebugger(t);
        }
    }, idleMs);
}

function registerTarget(blockid: string, wc: WebContents) {
    const existing = targetsById.get(blockid);
    if (existing) {
        existing.wc = wc;
        return existing;
    }
    const t: TargetInstance = {
        id: blockid,
        blockid,
        wc,
        clients: new Set<WebSocket>(),
        debuggerAttached: false,
        idleTimer: null,
        destroyedUnsub: null,
        dbgMsgHandler: null,
        dbgDetachHandler: null,
        // A widget is considered "controlled" when there is an active CDP client connection.
        // (Debugger may remain attached briefly for idle-detach smoothing, but that does not imply control.)
        controlled: () => t.clients.size > 0,
    };

    const onDestroyed = () => {
        unregisterTarget(blockid);
    };
    wc.once("destroyed", onDestroyed);
    t.destroyedUnsub = () => {
        try {
            wc.removeListener("destroyed", onDestroyed as any);
        } catch (_) {}
    };

    targetsById.set(blockid, t);
    return t;
}

function unregisterTarget(blockid: string) {
    const t = targetsById.get(blockid);
    if (!t) return;
    targetsById.delete(blockid);
    for (const ws of t.clients) {
        try {
            ws.close();
        } catch (_) {}
    }
    t.clients.clear();
    detachDebugger(t);
    try {
        t.destroyedUnsub?.();
    } catch (_) {}
}

function startDiscoveryPoller() {
    if (discoveryPoller) return;
    discoveryPoller = setInterval(() => {
        refreshTargetsFromRenderers().catch(() => {});
    }, 750);
    refreshTargetsFromRenderers().catch(() => {});
}

function stopDiscoveryPoller() {
    if (!discoveryPoller) return;
    clearInterval(discoveryPoller);
    discoveryPoller = null;
}

async function refreshTargetsFromRenderers() {
    // Ask any Wave tab renderer to report currently-mounted webviews.
    // This only discovers web widgets that are currently loaded (i.e. have a live <webview> WebContents).
    const all = webContents.getAllWebContents();
    const seen = new Map<string, number>(); // blockId -> webContentsId

    await Promise.all(
        all.map(async (wc) => {
            // Skip <webview> contents themselves; ask their host renderers.
            try {
                if ((wc as any).getType?.() === "webview") return;
            } catch (_) {}

            const reqId = randomUUID().replace(/-/g, "");
            const respCh = `webviews-list-resp-${reqId}`;
            const p = new Promise<void>((resolve) => {
                const timeout = setTimeout(() => {
                    ipcMain.removeAllListeners(respCh);
                    resolve();
                }, 200);
                ipcMain.once(respCh, (_evt, payload) => {
                    clearTimeout(timeout);
                    try {
                        for (const item of payload ?? []) {
                            const bid = item?.blockId;
                            const wcId = item?.webContentsId;
                            if (!bid || !wcId) continue;
                            const n = parseInt(String(wcId), 10);
                            if (!Number.isFinite(n)) continue;
                            seen.set(bid, n);
                        }
                    } catch (_) {}
                    resolve();
                });
            });
            try {
                wc.send("webviews-list", respCh);
            } catch (_) {
                ipcMain.removeAllListeners(respCh);
                return;
            }
            await p;
        })
    );

    // Register/update targets
    for (const [blockId, wcId] of seen.entries()) {
        const wv = webContents.fromId(wcId);
        if (!wv) continue;
        registerTarget(blockId, wv);
    }

    // Remove targets that no longer exist (webcontents destroyed or unmounted)
    for (const [blockId, t] of Array.from(targetsById.entries())) {
        if (seen.has(blockId)) continue;
        // If currently controlled, keep it until it disconnects/destroys; it should still be visible.
        if (t.clients.size > 0) continue;
        // If not controlled and not seen, drop it.
        unregisterTarget(blockId);
    }
}

async function ensureSharedServer() {
    if (httpServer && wsServer && actualPort != null) {
        startDiscoveryPoller();
        return;
    }

    const server = http.createServer(async (req, res) => {
        if (!req.url) {
            respondText(res, 400, "missing url");
            return;
        }
        const parsed = new URL(req.url, `http://${req.headers.host || HOST}`);

        if (req.method === "GET" && (parsed.pathname === "/json" || parsed.pathname === "/json/list")) {
            const targets = Array.from(targetsById.values());
            targets.sort((a, b) => a.blockid.localeCompare(b.blockid));
            const entries = targets.map(makeChromeJsonEntry);
            respondJson(res, 200, entries);
            return;
        }
        if (req.method === "GET" && parsed.pathname === "/json/version") {
            respondJson(res, 200, {
                Browser: "Wave (Electron)",
                "Protocol-Version": "1.3",
            });
            return;
        }

        // Chrome-ish: PUT /json/new?<encodedUrl>
        if (req.method === "PUT" && parsed.pathname === "/json/new") {
            const encodedUrl = parsed.search ? parsed.search.slice(1) : "";
            let url = "about:blank";
            try {
                if (encodedUrl) url = decodeURIComponent(encodedUrl);
            } catch (_) {
                url = encodedUrl || "about:blank";
            }
            if (!blockOps.createWebBlock) {
                respondText(res, 500, "createWebBlock not configured");
                return;
            }
            try {
                const blockId = await blockOps.createWebBlock(url);
                // Wait briefly for renderer to mount and report webcontents id.
                const deadline = Date.now() + 4000;
                while (Date.now() < deadline) {
                    await refreshTargetsFromRenderers();
                    const t = targetsById.get(blockId);
                    if (t) {
                        respondJson(res, 200, makeChromeJsonEntry(t));
                        return;
                    }
                    await new Promise((r) => setTimeout(r, 150));
                }
                respondText(res, 504, "created block but webview not ready");
                return;
            } catch (e: any) {
                respondText(res, 500, e?.message || String(e));
                return;
            }
        }

        // Chrome-ish: GET /json/close/<id>
        if (req.method === "GET" && parsed.pathname.startsWith("/json/close/")) {
            const id = parsed.pathname.slice("/json/close/".length);
            if (!id) {
                respondText(res, 400, "missing id");
                return;
            }
            if (!blockOps.deleteBlock) {
                respondText(res, 500, "deleteBlock not configured");
                return;
            }
            try {
                await blockOps.deleteBlock(id);
            } catch (e: any) {
                respondText(res, 500, e?.message || String(e));
                return;
            }
            // Best-effort cleanup locally.
            unregisterTarget(id);
            respondText(res, 200, "Target is closing");
            return;
        }

        respondText(res, 404, "not found");
    });

    const wss = new WebSocketServer({ noServer: true });
    server.on("upgrade", (req, socket, head) => {
        let pathname = "";
        try {
            const urlObj = new URL(req.url || "", `http://${req.headers.host || HOST}`);
            pathname = urlObj.pathname;
        } catch (_) {
            socket.destroy();
            return;
        }
        if (!pathname.startsWith(WS_PAGE_PREFIX)) {
            socket.destroy();
            return;
        }
        const targetId = pathname.slice(WS_PAGE_PREFIX.length);
        const target = targetsById.get(targetId);
        if (!target) {
            socket.destroy();
            return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit("connection", ws, targetId);
        });
    });

    wss.on("connection", async (ws: WebSocket, targetId: any) => {
        const t = targetsById.get(String(targetId));
        if (!t) {
            try {
                ws.close();
            } catch (_) {}
            return;
        }
        t.clients.add(ws);
        if (t.idleTimer) {
            clearTimeout(t.idleTimer);
            t.idleTimer = null;
        }
        try {
            await ensureDebuggerAttached(t);
        } catch (e: any) {
            safeJsonSend(ws, { error: e?.message || String(e) });
            try {
                ws.close();
            } catch (_) {}
            return;
        }

        ws.on("message", async (data) => {
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
                const result = await t.wc.debugger.sendCommand(method, params);
                safeJsonSend(ws, { id, result });
            } catch (e: any) {
                safeJsonSend(ws, { id, error: { code: -32000, message: e?.message || String(e) } });
            }
        });

        ws.on("close", () => {
            t.clients.delete(ws);
            if (t.clients.size === 0) {
                scheduleIdleDetach(t);
            }
        });
    });

    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(serverCfg.port, HOST, () => resolve());
    });

    httpServer = server;
    wsServer = wss;
    const addr = server.address();
    if (addr && typeof addr === "object") {
        actualPort = addr.port;
    } else {
        actualPort = serverCfg.port;
    }

    console.log("webcdp server listening", `${HOST}:${actualPort}`);
    startDiscoveryPoller();
}

async function stopSharedServer() {
    stopDiscoveryPoller();

    for (const id of Array.from(targetsById.keys())) {
        unregisterTarget(id);
    }

    try {
        wsServer?.close();
    } catch (_) {}
    wsServer = null;

    const srv = httpServer;
    httpServer = null;
    actualPort = null;
    if (srv) {
        await new Promise<void>((resolve) => {
            try {
                srv.close(() => resolve());
            } catch (_) {
                resolve();
            }
        });
    }
}
