// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcResponseHelper } from "@/app/store/wshclient";
import { RpcApi } from "@/app/store/wshclientapi";
import { WebContents } from "electron";
import { unamePlatform } from "./emain-platform";
import { getWebContentsByBlockId } from "./emain-web";
import { getWaveWindowByWorkspaceId } from "./emain-window";
import {
    AxRef,
    ERR_WEB_RUN_ABORTED,
    SCREENSHOT_MAX_DATA64_CHARS,
    TypeChunk,
    applyNavigateCdpEvent,
    assignNavigateLoaderId,
    assertWebAgentControlDecision,
    capSleepMs,
    checkScriptSize,
    clientRectCenter,
    contentQuadCenter,
    createAbortableSend,
    emptyNavigateWaitState,
    isNavigateAbortedError,
    pageNavigateStrategy,
    devToolsAttachedError,
    formatAxSnapshot,
    isClickPoint,
    missingBackendNodeError,
    originConnFromRpcSource,
    parseRef,
    resolveRunTimeoutMs,
    scriptContainsSecretCall,
    selectAllKeyModifiers,
    shouldCompleteNavigate,
    splitTypeChunks,
    staleRefError,
    stringifyPrintArg,
    tabNotLoadedError,
    truncateJsonValue,
    urlsMatchForNavigate,
} from "./web-agent-pure";

export type CdpSend = (method: string, params?: Record<string, unknown>) => Promise<any>;

type CdpSession = {
    wc: WebContents;
    send: CdpSend;
    isAborted?: () => boolean;
};

function audit(...parts: unknown[]): void {
    console.log("[agent-audit]", ...parts);
}

export async function assertWebAgentControl(rh: RpcResponseHelper): Promise<void> {
    const { ElectronWshClient } = await import("./emain-wsh");
    const fullConfig = await RpcApi.GetFullConfigCommand(ElectronWshClient);
    const allowBrowser = !!fullConfig.settings?.["agent:allowbrowsercontrol"];
    const allowRemoteLocal = !!fullConfig.settings?.["agent:allowremotelocalcontrol"];
    const source = rh.getSource();
    assertWebAgentControlDecision({
        allowBrowserControl: allowBrowser,
        allowRemoteLocalControl: allowRemoteLocal,
        originConn: originConnFromRpcSource(source),
        targetConn: "",
    });
}

export async function resolveGuestWebContents(data: {
    workspaceid?: string;
    tabid?: string;
    blockid?: string;
}): Promise<WebContents> {
    if (!data.tabid || !data.blockid || !data.workspaceid) {
        throw new Error("tabid and blockid are required");
    }
    const ww = getWaveWindowByWorkspaceId(data.workspaceid);
    if (ww == null) {
        throw new Error(`no window found with workspace ${data.workspaceid}`);
    }
    const wc = await getWebContentsByBlockId(ww, data.tabid, data.blockid);
    if (wc == null) {
        throw tabNotLoadedError(data.blockid);
    }
    return wc;
}

function looksLikeDebuggerAttached(err: unknown): boolean {
    const msg = String((err as any)?.message ?? err).toLowerCase();
    return msg.includes("already attached") || msg.includes("another debugger") || msg.includes("devtools");
}

export async function withGuestDebugger<T>(
    wc: WebContents,
    blockId: string,
    fn: (session: CdpSession) => Promise<T>
): Promise<T> {
    if (wc.isDestroyed()) {
        throw tabNotLoadedError(blockId);
    }
    if (wc.isDevToolsOpened() || wc.debugger.isAttached()) {
        throw devToolsAttachedError(blockId);
    }
    try {
        wc.debugger.attach("1.3");
    } catch (err) {
        if (looksLikeDebuggerAttached(err)) {
            throw devToolsAttachedError(blockId);
        }
        throw err;
    }
    const send: CdpSend = (method, params) => wc.debugger.sendCommand(method, params ?? {});
    try {
        await send("Page.enable");
        await send("Page.setLifecycleEventsEnabled", { enabled: true });
        await send("Runtime.enable");
        await send("Accessibility.enable");
        await send("DOM.enable");
        return await fn({ wc, send });
    } finally {
        if (wc.debugger.isAttached()) {
            try {
                wc.debugger.detach();
            } catch (err) {
                console.log("[agent-audit] debugger detach failed", String((err as any)?.message ?? err));
            }
        }
    }
}

function listenDebugger(wc: WebContents, handler: (method: string, params: any) => void): () => void {
    const listener = (_event: unknown, method: string, params: unknown) => {
        handler(method, params);
    };
    wc.debugger.on("message", listener);
    return () => {
        wc.debugger.removeListener("message", listener);
    };
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function headerField(text: string, key: "url" | "title"): string {
    const prefix = `${key}: `;
    const line = text.split("\n").find((l) => l.startsWith(prefix));
    return line ? line.slice(prefix.length) : "";
}

async function getPageUrlTitle(send: CdpSend): Promise<{ url: string; title: string }> {
    try {
        const ev = await send("Runtime.evaluate", {
            expression: "({url: location.href, title: document.title})",
            returnByValue: true,
        });
        const v = ev?.result?.value;
        if (v && typeof v === "object") {
            return { url: String(v.url ?? ""), title: String(v.title ?? "") };
        }
    } catch {
        /* fall through */
    }
    try {
        const tree = await send("Page.getFrameTree");
        return { url: String(tree?.frameTree?.frame?.url ?? ""), title: "" };
    } catch {
        return { url: "", title: "" };
    }
}

async function getReadyState(send: CdpSend): Promise<string | null> {
    try {
        const ev = await send("Runtime.evaluate", {
            expression: "document.readyState",
            returnByValue: true,
        });
        return ev?.result?.value ?? null;
    } catch {
        return null;
    }
}

async function waitForNavigate(session: CdpSession, url: string, deadlineMs: number): Promise<void> {
    const throwIfAborted = () => {
        if (session.isAborted?.()) {
            throw new Error(ERR_WEB_RUN_ABORTED);
        }
        if (Date.now() >= deadlineMs) {
            throw new Error("navigate timed out");
        }
    };
    throwIfAborted();

    let mainFrameId: string | undefined;
    let beforeUrl = "";
    let beforeReady: string | null = null;
    try {
        const tree = await session.send("Page.getFrameTree");
        mainFrameId = tree?.frameTree?.frame?.id;
        beforeUrl = String(tree?.frameTree?.frame?.url ?? "");
    } catch {
        /* ignore */
    }
    try {
        const info = await getPageUrlTitle(session.send);
        if (info.url) {
            beforeUrl = info.url;
        }
    } catch {
        /* ignore */
    }
    try {
        beforeReady = await getReadyState(session.send);
    } catch {
        /* ignore */
    }

    const strategy = pageNavigateStrategy(url, beforeUrl, beforeReady);
    if (strategy === "skip") {
        return;
    }

    const state = emptyNavigateWaitState(url, beforeUrl);
    state.currentUrl = beforeUrl;
    state.readyState = beforeReady;
    const started = Date.now();
    const unlisten = listenDebugger(session.wc, (method, params) => {
        applyNavigateCdpEvent(state, method, params, mainFrameId);
    });
    let treatAsInFlight = strategy === "wait-inflight";
    const pollUntilDone = async () => {
        while (true) {
            throwIfAborted();
            state.elapsedMs = Date.now() - started;
            try {
                const info = await getPageUrlTitle(session.send);
                state.currentUrl = info.url;
            } catch {
                /* ignore */
            }
            try {
                state.readyState = await getReadyState(session.send);
            } catch {
                /* ignore */
            }
            if (shouldCompleteNavigate(state)) {
                await delay(50);
                return;
            }
            if (
                treatAsInFlight &&
                urlsMatchForNavigate(url, state.currentUrl) &&
                state.readyState === "complete"
            ) {
                await delay(50);
                return;
            }
            await delay(50);
        }
    };
    try {
        if (strategy === "wait-inflight") {
            await pollUntilDone();
            return;
        }

        const navigateOnce = async () => {
            const nav = await session.send("Page.navigate", { url });
            if (nav?.errorText && !isNavigateAbortedError(nav.errorText)) {
                throw new Error(`navigate failed: ${nav.errorText}`);
            }
            return nav;
        };

        let nav = await navigateOnce();
        if (nav?.errorText && isNavigateAbortedError(nav.errorText)) {
            const retryDeadline = Math.min(deadlineMs, Date.now() + 2000);
            while (Date.now() < retryDeadline) {
                throwIfAborted();
                try {
                    const info = await getPageUrlTitle(session.send);
                    state.currentUrl = info.url;
                    if (urlsMatchForNavigate(url, info.url)) {
                        break;
                    }
                } catch {
                    /* ignore */
                }
                await delay(50);
            }
            if (urlsMatchForNavigate(url, state.currentUrl)) {
                treatAsInFlight = true;
            } else {
                nav = await navigateOnce();
                if (nav?.errorText && !isNavigateAbortedError(nav.errorText)) {
                    throw new Error(`navigate failed: ${nav.errorText}`);
                }
                assignNavigateLoaderId(state, nav?.loaderId);
            }
        } else {
            assignNavigateLoaderId(state, nav?.loaderId);
        }
        await pollUntilDone();
    } finally {
        unlisten();
    }
}

async function captureAx(send: CdpSend) {
    await send("Accessibility.enable");
    const info = await getPageUrlTitle(send);
    const ax = await send("Accessibility.getFullAXTree");
    return formatAxSnapshot({
        nodes: ax?.nodes ?? [],
        url: info.url,
        title: info.title,
    });
}

async function capturePngData64(send: CdpSend): Promise<string> {
    const shot = await send("Page.captureScreenshot", { format: "png", fromSurface: false });
    const data = String(shot?.data ?? "");
    const comma = data.indexOf(",");
    const data64 = data.startsWith("data:") && comma >= 0 ? data.slice(comma + 1) : data;
    if (data64.length > SCREENSHOT_MAX_DATA64_CHARS) {
        throw new Error(
            `screenshot too large to return over RPC (${data64.length} chars, max ${SCREENSHOT_MAX_DATA64_CHARS}); shrink the viewport`
        );
    }
    return data64;
}

async function scrollBackendNodeIntoView(send: CdpSend, backendNodeId: number): Promise<void> {
    try {
        const resolved = await send("DOM.resolveNode", { backendNodeId });
        const objectId = resolved?.object?.objectId;
        if (!objectId) {
            return;
        }
        await send("Runtime.callFunctionOn", {
            objectId,
            functionDeclaration: "function() { this.scrollIntoView({ block: 'center', inline: 'nearest' }); }",
            returnByValue: true,
        });
    } catch {
        /* click path still tries box model / rect */
    }
}

async function centerFromResolveNode(send: CdpSend, backendNodeId: number): Promise<{ x: number; y: number }> {
    const resolved = await send("DOM.resolveNode", { backendNodeId });
    const objectId = resolved?.object?.objectId;
    if (!objectId) {
        throw new Error("could not resolve node");
    }
    const ev = await send("Runtime.callFunctionOn", {
        objectId,
        functionDeclaration: `function() {
            const r = this.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height };
        }`,
        returnByValue: true,
    });
    const v = ev?.result?.value;
    if (!v) {
        throw new Error("could not compute click point");
    }
    return clientRectCenter(v);
}

async function getBoxCenter(send: CdpSend, backendNodeId: number): Promise<{ x: number; y: number }> {
    await scrollBackendNodeIntoView(send, backendNodeId);
    try {
        return await centerFromResolveNode(send, backendNodeId);
    } catch {
        try {
            await send("DOM.getDocument");
        } catch {
            /* continue */
        }
        const rtn = await send("DOM.getBoxModel", { backendNodeId });
        return contentQuadCenter(rtn?.model?.content);
    }
}

async function dispatchClick(send: CdpSend, x: number, y: number): Promise<void> {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

async function clickFallbackJs(send: CdpSend, x: number, y: number): Promise<void> {
    const ev = await send("Runtime.evaluate", {
        expression: `(() => {
            const el = document.elementFromPoint(${JSON.stringify(x)}, ${JSON.stringify(y)});
            if (!el) {
                throw new Error("no element at point");
            }
            el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window, clientX: ${JSON.stringify(x)}, clientY: ${JSON.stringify(y)} }));
            if (typeof el.click === "function") {
                el.click();
            }
        })()`,
        awaitPromise: true,
        returnByValue: true,
    });
    if (ev?.exceptionDetails) {
        throw new Error(evaluateExceptionMessage(ev.exceptionDetails));
    }
}

function evaluateExceptionMessage(details: any): string {
    return details?.exception?.description || details?.text || details?.exception?.value || "Runtime.evaluate failed";
}

async function clickAt(send: CdpSend, x: number, y: number): Promise<void> {
    try {
        await dispatchClick(send, x, y);
    } catch {
        await clickFallbackJs(send, x, y);
    }
}

async function selectAll(send: CdpSend): Promise<void> {
    const modifiers = selectAllKeyModifiers(unamePlatform);
    const keyEvent = {
        modifiers,
        key: "a",
        code: "KeyA",
        windowsVirtualKeyCode: 65,
        nativeVirtualKeyCode: 65,
    };
    await send("Input.dispatchKeyEvent", { type: "keyDown", ...keyEvent });
    await send("Input.dispatchKeyEvent", { type: "keyUp", ...keyEvent });
}

async function dispatchSpecialKey(send: CdpSend, chunk: TypeChunk & { kind: "key" }): Promise<void> {
    const keyEvent = {
        key: chunk.key,
        code: chunk.code,
        windowsVirtualKeyCode: chunk.keyCode,
        nativeVirtualKeyCode: chunk.keyCode,
    };
    const charText = chunk.key === "Enter" ? "\r" : chunk.key === "Tab" ? "\t" : "";
    await send("Input.dispatchKeyEvent", { type: "keyDown", ...keyEvent });
    if (charText) {
        await send("Input.dispatchKeyEvent", { type: "char", text: charText, ...keyEvent });
    }
    await send("Input.dispatchKeyEvent", { type: "keyUp", ...keyEvent });
}

async function selectNodeText(send: CdpSend, backendNodeId: number): Promise<void> {
    let selected = false;
    try {
        const resolved = await send("DOM.resolveNode", { backendNodeId });
        const objectId = resolved?.object?.objectId;
        if (objectId) {
            const ev = await send("Runtime.callFunctionOn", {
                objectId,
                functionDeclaration: `function() {
                    this.focus();
                    if (typeof this.select === "function") {
                        this.select();
                        return "selected";
                    }
                    return "noselect";
                }`,
                returnByValue: true,
            });
            selected = ev?.result?.value === "selected";
        }
    } catch {
        selected = false;
    }
    if (!selected) {
        await selectAll(send);
    }
}

async function focusBackendNode(send: CdpSend, backendNodeId: number): Promise<void> {
    try {
        await send("DOM.focus", { backendNodeId });
    } catch {
        const { x, y } = await getBoxCenter(send, backendNodeId);
        await dispatchClick(send, x, y);
    }
}

async function prefetchSecrets(): Promise<Map<string, string>> {
    const { ElectronWshClient } = await import("./emain-wsh");
    const names = (await RpcApi.GetSecretsNamesCommand(ElectronWshClient)) ?? [];
    const map = new Map<string, string>();
    if (names.length === 0) {
        return map;
    }
    const values = (await RpcApi.GetSecretsCommand(ElectronWshClient, names)) ?? {};
    for (const [name, value] of Object.entries(values)) {
        if (typeof value === "string") {
            map.set(name, value);
        }
    }
    return map;
}

async function pageInfoFromSession(send: CdpSend): Promise<{ url: string; title: string; w: number; h: number }> {
    const info = await getPageUrlTitle(send);
    let w = 0;
    let h = 0;
    try {
        const metrics = await send("Page.getLayoutMetrics");
        const vp = metrics?.cssLayoutViewport ?? metrics?.layoutViewport ?? metrics?.visualViewport;
        w = Number(vp?.clientWidth ?? 0);
        h = Number(vp?.clientHeight ?? 0);
    } catch {
        /* ignore */
    }
    return { url: info.url, title: info.title, w, h };
}

export async function runWebSnapshot(rh: RpcResponseHelper, data: CommandWebSnapshotData): Promise<WebSnapshotResult> {
    await assertWebAgentControl(rh);
    audit("web snapshot", data.blockid);
    const wc = await resolveGuestWebContents(data);
    return withGuestDebugger(wc, data.blockid, async ({ send }) => {
        const snap = await captureAx(send);
        return {
            blockid: data.blockid,
            url: headerField(snap.text, "url"),
            title: headerField(snap.text, "title"),
            snapshot: snap.text,
            truncated: snap.truncated,
        };
    });
}

export async function runWebScreenshot(
    rh: RpcResponseHelper,
    data: CommandWebScreenshotData
): Promise<WebScreenshotResult> {
    await assertWebAgentControl(rh);
    audit("web screenshot", data.blockid);
    const wc = await resolveGuestWebContents(data);
    return withGuestDebugger(wc, data.blockid, async ({ send }) => {
        const data64 = await capturePngData64(send);
        return {
            blockid: data.blockid,
            data64,
        };
    });
}

export async function runWebRun(rh: RpcResponseHelper, data: CommandWebRunData): Promise<WebRunResult> {
    await assertWebAgentControl(rh);
    const script = data.script ?? "";
    checkScriptSize(script);
    audit("web run", data.blockid, Buffer.byteLength(script, "utf8"));
    const wc = await resolveGuestWebContents(data);
    const timeoutMs = resolveRunTimeoutMs(data.timeoutms);
    const secrets = scriptContainsSecretCall(script) ? await prefetchSecrets() : new Map<string, string>();
    return withGuestDebugger(wc, data.blockid, async (session) => {
        return executeWebRun(session, data.blockid, script, timeoutMs, secrets);
    });
}

async function executeWebRun(
    session: CdpSession,
    blockId: string,
    script: string,
    timeoutMs: number,
    secrets: Map<string, string>
): Promise<WebRunResult> {
    const gate = createAbortableSend(session.send);
    session.send = gate.send;
    session.isAborted = gate.isAborted;
    const deadline = Date.now() + timeoutMs;
    const remaining = () => Math.max(0, deadline - Date.now());
    let stdout = "";
    let truncated = false;
    const refs = new Map<number, AxRef>();
    let lastUrl = "";
    let lastTitle = "";

    const snapshot = async (): Promise<string> => {
        const snap = await captureAx(session.send);
        refs.clear();
        for (const ref of snap.refs) {
            refs.set(ref.n, ref);
        }
        if (snap.truncated) {
            truncated = true;
        }
        lastUrl = headerField(snap.text, "url");
        lastTitle = headerField(snap.text, "title");
        return snap.text;
    };

    const lookupRef = (raw: string): AxRef => {
        const n = parseRef(raw);
        const ref = refs.get(n);
        if (!ref) {
            throw staleRefError(n);
        }
        if (ref.backendDOMNodeId == null || ref.backendDOMNodeId === 0) {
            throw missingBackendNodeError(n);
        }
        return ref;
    };

    const navigate = async (url: string): Promise<{ url: string; title: string }> => {
        await waitForNavigate(session, String(url), Date.now() + remaining());
        refs.clear();
        const info = await getPageUrlTitle(session.send);
        lastUrl = info.url;
        lastTitle = info.title;
        return info;
    };

    const click = async (target: string | [number, number]): Promise<void> => {
        if (isClickPoint(target)) {
            await clickAt(session.send, target[0], target[1]);
            return;
        }
        if (typeof target !== "string") {
            throw new Error("click target must be a ref string or [x, y]");
        }
        const ref = lookupRef(target);
        const { x, y } = await getBoxCenter(session.send, ref.backendDOMNodeId);
        await clickAt(session.send, x, y);
    };

    const fill = async (refRaw: string, text: string): Promise<void> => {
        const ref = lookupRef(String(refRaw));
        const { x, y } = await getBoxCenter(session.send, ref.backendDOMNodeId);
        await clickAt(session.send, x, y);
        await focusBackendNode(session.send, ref.backendDOMNodeId);
        await selectNodeText(session.send, ref.backendDOMNodeId);
        await session.send("Input.insertText", { text: String(text ?? "") });
    };

    const typeText = async (text: string): Promise<void> => {
        for (const chunk of splitTypeChunks(String(text ?? ""))) {
            if (chunk.kind === "text") {
                await session.send("Input.insertText", { text: chunk.text });
            } else {
                await dispatchSpecialKey(session.send, chunk);
            }
        }
    };

    const js = async (expr: string): Promise<unknown> => {
        const ev = await session.send("Runtime.evaluate", {
            expression: String(expr),
            returnByValue: true,
            awaitPromise: true,
        });
        if (ev?.exceptionDetails) {
            throw new Error(evaluateExceptionMessage(ev.exceptionDetails));
        }
        const truncatedVal = truncateJsonValue(ev?.result?.value);
        if (truncatedVal.truncated) {
            truncated = true;
        }
        return truncatedVal.value;
    };

    const cdp = async (method: string, params?: object): Promise<unknown> => {
        audit("cdp", method);
        return session.send(String(method), (params as Record<string, unknown>) ?? {});
    };

    const screenshot = async (): Promise<string> => {
        return capturePngData64(session.send);
    };

    const secret = (name: string): string => {
        const key = String(name);
        audit("secret", key);
        const value = secrets.get(key);
        if (value === undefined) {
            throw new Error(`secret not found: ${key}`);
        }
        return value;
    };

    const sleep = async (ms: number): Promise<void> => {
        const wait = Math.min(capSleepMs(Number(ms)), remaining());
        const end = Date.now() + wait;
        while (Date.now() < end) {
            if (gate.isAborted()) {
                throw new Error(ERR_WEB_RUN_ABORTED);
            }
            await delay(Math.min(50, end - Date.now()));
        }
    };

    const print = (...args: unknown[]): void => {
        stdout += args.map(stringifyPrintArg).join(" ") + "\n";
    };

    const pageInfo = async (): Promise<{ url: string; title: string; w: number; h: number }> => {
        const info = await pageInfoFromSession(session.send);
        lastUrl = info.url;
        lastTitle = info.title;
        return info;
    };

    const helpers: Record<string, unknown> = {
        navigate,
        snapshot,
        click,
        fill,
        type: typeText,
        js,
        cdp,
        screenshot,
        secret,
        sleep,
        print,
        pageInfo,
    };
    const names = Object.keys(helpers);
    const values = Object.values(helpers);
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
        ...args: string[]
    ) => (...fnArgs: unknown[]) => Promise<unknown>;
    const fn = new AsyncFunction(...names, `"use strict";\n${script}`);

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
            reject(new Error(`web run timed out after ${timeoutMs}ms (block ${blockId})`));
        }, remaining() || 1);
    });

    const fnPromise = (async () => {
        try {
            return await fn(...values);
        } catch (err) {
            if (gate.isAborted()) {
                return undefined;
            }
            throw err;
        }
    })();

    let result: unknown;
    try {
        result = await Promise.race([fnPromise, timeoutPromise]);
    } catch (err) {
        const msg = String((err as any)?.message ?? err);
        if (msg.includes("timed out")) {
            gate.abort();
            await Promise.race([fnPromise, delay(300)]);
        }
        throw err;
    } finally {
        if (timeoutHandle != null) {
            clearTimeout(timeoutHandle);
        }
    }

    if (result !== undefined) {
        if (stdout && !stdout.endsWith("\n")) {
            stdout += "\n";
        }
        stdout += typeof result === "string" ? result : JSON.stringify(result);
        if (!stdout.endsWith("\n")) {
            stdout += "\n";
        }
    }

    if (!lastUrl && !lastTitle) {
        try {
            const info = await getPageUrlTitle(session.send);
            lastUrl = info.url;
            lastTitle = info.title;
        } catch {
            /* ignore */
        }
    }

    const rtn: WebRunResult = {
        blockid: blockId,
        url: lastUrl,
        title: lastTitle,
        stdout,
        truncated,
    };
    if (result !== undefined) {
        try {
            (rtn as any).result = JSON.parse(JSON.stringify(result));
        } catch {
            (rtn as any).result = String(result);
        }
    }
    return rtn;
}
