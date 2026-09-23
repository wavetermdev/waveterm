// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/** Max `wsh web run` script size (UTF-8 bytes). Over → error, do not run. */
export const WEB_RUN_MAX_SCRIPT_BYTES = 256 * 1024;

/** Cap per `sleep(ms)` call inside a web run. */
export const SLEEP_CAP_MS = 30_000;

/** Default / max run budget (milliseconds). */
export const WEB_RUN_DEFAULT_TIMEOUT_MS = 60_000;
export const WEB_RUN_MAX_TIMEOUT_MS = 300_000;

/** AX snapshot text limits: whichever bound is hit first. */
export const SNAPSHOT_MAX_BYTES = 64 * 1024;
export const SNAPSHOT_MAX_LINES = 800;

/** `js()` JSON stringify cap. */
export const JS_RESULT_MAX_BYTES = 1024 * 1024;

/** PNG base64 over RPC must stay under the 5 MiB websocket send cap (JSON wrapper included). */
export const SCREENSHOT_MAX_DATA64_CHARS = 3 * 1024 * 1024;

export const ERR_WEB_RUN_ABORTED = "web run aborted";

export const ERR_BROWSER_CONTROL_DISABLED =
    "browser control is disabled (set agent:allowbrowsercontrol to enable)";
export const ERR_REMOTE_TO_LOCAL_DISABLED =
    "remote-to-local control is disabled (set agent:allowremotelocalcontrol to enable)";

const INTERACTIVE_ROLES = new Set([
    "button",
    "link",
    "textbox",
    "searchbox",
    "checkbox",
    "radio",
    "combobox",
    "menuitem",
    "slider",
    "tab",
    "switch",
    "option",
]);

/** Matches `conncontroller.IsLocalConnName`. */
export function isLocalConnName(connName: string): boolean {
    return connName === "" || connName === "local" || connName.startsWith("local:");
}

/** Matches `conncontroller.IsWslConnName`. */
export function isWslConnName(connName: string): boolean {
    return connName.startsWith("wsl://");
}

/** Matches `wshserver.isRemoteOrigin`. */
export function isRemoteOrigin(connName: string): boolean {
    return !isLocalConnName(connName) && !isWslConnName(connName) && connName !== "";
}

/**
 * Matches `wshserver.shouldAllowRemoteLocalControl`.
 * Returns true unless the request originates from a remote (SSH) connection,
 * targets the local connection, and the allow setting is false.
 */
export function shouldAllowRemoteLocalControl(
    originConn: string,
    targetConn: string,
    allowSetting: boolean
): boolean {
    if (!isRemoteOrigin(originConn)) {
        return true;
    }
    if (!isLocalConnName(targetConn)) {
        return true;
    }
    return allowSetting;
}

/**
 * Parse RPC source. Remote wsh is routed as `conn:<name>`; anything else
 * (electron, tab, controller, empty) is treated as local origin.
 */
export function originConnFromRpcSource(source: string | null | undefined): string {
    if (source != null && source.startsWith("conn:")) {
        return source.slice("conn:".length);
    }
    return "";
}

export type WebAgentControlOpts = {
    allowBrowserControl: boolean;
    allowRemoteLocalControl: boolean;
    originConn: string;
    /** Webview target is always local; default `""`. */
    targetConn?: string;
};

export function assertWebAgentControlDecision(opts: WebAgentControlOpts): void {
    if (!opts.allowBrowserControl) {
        throw new Error(ERR_BROWSER_CONTROL_DISABLED);
    }
    const targetConn = opts.targetConn ?? "";
    if (!shouldAllowRemoteLocalControl(opts.originConn, targetConn, opts.allowRemoteLocalControl)) {
        throw new Error(ERR_REMOTE_TO_LOCAL_DISABLED);
    }
}

export function tabNotLoadedError(blockId: string): Error {
    return new Error(
        `web block ${blockId}: tab is not loaded in the window (switch to that tab once so the webview stays attached)`
    );
}

export function devToolsAttachedError(blockId: string): Error {
    return new Error(
        `web block ${blockId}: DevTools (or another debugger) is attached; close DevTools and retry`
    );
}

export function staleRefError(n: number): Error {
    return new Error(`unknown or stale ref @${n} (call snapshot() in this web run first)`);
}

export function missingBackendNodeError(n: number): Error {
    return new Error(
        `ref @${n} has no backend DOM node (not clickable; pick a different ref or use js())`
    );
}

export function resolveRunTimeoutMs(timeoutms?: number | null): number {
    if (timeoutms == null || timeoutms === 0 || !Number.isFinite(timeoutms)) {
        return WEB_RUN_DEFAULT_TIMEOUT_MS;
    }
    if (timeoutms < 0) {
        return WEB_RUN_DEFAULT_TIMEOUT_MS;
    }
    return Math.min(timeoutms, WEB_RUN_MAX_TIMEOUT_MS);
}

/** `"@1"`, `"1"`, `"@21"` → 1-based index. Invalid → error. */
export function parseRef(ref: string): number {
    const s = String(ref).trim();
    const m = /^@?(\d+)$/.exec(s);
    if (!m) {
        throw new Error(`invalid ref ${JSON.stringify(ref)}`);
    }
    const n = Number(m[1]);
    if (!Number.isInteger(n) || n < 1) {
        throw new Error(`invalid ref ${JSON.stringify(ref)}`);
    }
    return n;
}

export function isClickPoint(target: unknown): target is [number, number] {
    return (
        Array.isArray(target) &&
        target.length >= 2 &&
        typeof target[0] === "number" &&
        typeof target[1] === "number" &&
        Number.isFinite(target[0]) &&
        Number.isFinite(target[1])
    );
}

export function isUsableWebContentsId(id: unknown): boolean {
    if (id == null || id === "") {
        return false;
    }
    const n = typeof id === "number" ? id : parseInt(String(id), 10);
    return Number.isInteger(n) && n > 0;
}

/** True when the script text contains a `secret(` call (prefetch only then). */
export function scriptContainsSecretCall(script: string): boolean {
    return /\bsecret\s*\(/.test(script);
}

export type TypeChunk =
    | { kind: "text"; text: string }
    | { kind: "key"; key: string; code: string; keyCode: number };

/** Split `type()` input so `\n` / `\t` become real key events, not insertText. */
export function splitTypeChunks(text: string): TypeChunk[] {
    const chunks: TypeChunk[] = [];
    const parts = String(text ?? "").split(/(\r\n|\n|\r|\t)/);
    for (const part of parts) {
        if (!part) {
            continue;
        }
        if (part === "\n" || part === "\r\n" || part === "\r") {
            chunks.push({ kind: "key", key: "Enter", code: "Enter", keyCode: 13 });
        } else if (part === "\t") {
            chunks.push({ kind: "key", key: "Tab", code: "Tab", keyCode: 9 });
        } else {
            chunks.push({ kind: "text", text: part });
        }
    }
    return chunks;
}

export function createAbortableSend(send: (method: string, params?: Record<string, unknown>) => Promise<any>): {
    send: (method: string, params?: Record<string, unknown>) => Promise<any>;
    abort: () => void;
    isAborted: () => boolean;
} {
    let aborted = false;
    return {
        abort: () => {
            aborted = true;
        },
        isAborted: () => aborted,
        send: (method, params) => {
            if (aborted) {
                return Promise.reject(new Error(ERR_WEB_RUN_ABORTED));
            }
            return send(method, params);
        },
    };
}

/**
 * Requested navigate URL vs the document we actually landed on.
 * Trailing slashes on the path are ignored; a requested hash must match.
 */
export function urlsMatchForNavigate(requested: string, current: string): boolean {
    if (!requested || !current) {
        return false;
    }
    if (requested === current) {
        return true;
    }
    try {
        const r = new URL(requested);
        const c = new URL(current);
        if (r.protocol !== c.protocol || r.host !== c.host) {
            return false;
        }
        const rPath = r.pathname.replace(/\/+$/, "") || "/";
        const cPath = c.pathname.replace(/\/+$/, "") || "/";
        if (rPath !== cPath) {
            return false;
        }
        if (r.search && r.search !== c.search) {
            return false;
        }
        if (r.hash && r.hash !== c.hash) {
            return false;
        }
        return true;
    } catch {
        return current.includes(requested) || requested.includes(current);
    }
}

export type NavigateWaitState = {
    requestedUrl: string;
    urlBeforeNavigate: string;
    loaderId?: string;
    seenLoaderLoads: string[];
    loadForLoader: boolean;
    mainFrameNavigated: boolean;
    currentUrl: string;
    readyState: string | null;
    elapsedMs: number;
};

export function emptyNavigateWaitState(requestedUrl: string, urlBeforeNavigate = ""): NavigateWaitState {
    return {
        requestedUrl,
        urlBeforeNavigate,
        seenLoaderLoads: [],
        loadForLoader: false,
        mainFrameNavigated: false,
        currentUrl: urlBeforeNavigate,
        readyState: null,
        elapsedMs: 0,
    };
}

export type PageNavigateStrategy = "skip" | "wait-inflight" | "navigate";

/** Avoid Page.navigate when the widget is already loading/at the requested URL (open-then-run). */
export function pageNavigateStrategy(
    requestedUrl: string,
    currentUrl: string,
    readyState: string | null
): PageNavigateStrategy {
    if (!urlsMatchForNavigate(requestedUrl, currentUrl)) {
        return "navigate";
    }
    if (readyState === "complete") {
        return "skip";
    }
    return "wait-inflight";
}

export function isNavigateAbortedError(errorText: unknown): boolean {
    const s = String(errorText ?? "").toLowerCase();
    return s.includes("err_aborted") || s.includes("aborted");
}

export function assignNavigateLoaderId(state: NavigateWaitState, loaderId?: string): void {
    if (!loaderId) {
        return;
    }
    state.loaderId = loaderId;
    if (state.seenLoaderLoads.includes(loaderId)) {
        state.loadForLoader = true;
    }
}

/** Classify CDP events for `waitForNavigate`. Ignores iframe navigations. */
export function applyNavigateCdpEvent(
    state: NavigateWaitState,
    method: string,
    params: any,
    mainFrameId?: string
): void {
    if (method === "Page.lifecycleEvent") {
        const name = params?.name;
        const eventLoader = params?.loaderId;
        if (
            eventLoader &&
            (name === "load" || name === "DOMContentLoaded" || name === "networkIdle") &&
            !state.seenLoaderLoads.includes(eventLoader)
        ) {
            state.seenLoaderLoads.push(eventLoader);
        }
        if (state.loaderId && eventLoader === state.loaderId && state.seenLoaderLoads.includes(state.loaderId)) {
            state.loadForLoader = true;
        }
        return;
    }
    if (method === "Page.frameNavigated") {
        const frame = params?.frame;
        if (!frame) {
            return;
        }
        if (!frame.parentId) {
            state.mainFrameNavigated = true;
        }
        if (mainFrameId && frame.id === mainFrameId) {
            state.mainFrameNavigated = true;
        }
        return;
    }
    // Page.loadEventFired is not loader-scoped; ignore it so an in-flight first
    // load cannot complete a later navigate().
}

/**
 * Complete navigate only for this navigation's loader / main frame + URL.
 * Never complete just because the previous document is already `complete`.
 * `loadForLoader` is only set from a matched `loaderId` lifecycle (including
 * events buffered before `assignNavigateLoaderId`).
 */
export function shouldCompleteNavigate(state: NavigateWaitState): boolean {
    const urlOk = urlsMatchForNavigate(state.requestedUrl, state.currentUrl);
    const ready = state.readyState === "complete" || state.readyState === "interactive";
    if (state.loadForLoader) {
        return true;
    }
    if (state.mainFrameNavigated && urlOk && ready) {
        return true;
    }
    if (urlOk && state.readyState === "complete" && state.elapsedMs >= 100 && isSameDocumentHashNav(state)) {
        return true;
    }
    if (!state.loaderId && urlOk && state.readyState === "complete" && state.elapsedMs >= 100) {
        return true;
    }
    return false;
}

function isSameDocumentHashNav(state: NavigateWaitState): boolean {
    if (!requestedUrlHasHash(state.requestedUrl) || !state.urlBeforeNavigate) {
        return false;
    }
    try {
        const before = new URL(state.urlBeforeNavigate);
        const want = new URL(state.requestedUrl);
        if (before.origin !== want.origin) {
            return false;
        }
        const beforePath = before.pathname.replace(/\/+$/, "") || "/";
        const wantPath = want.pathname.replace(/\/+$/, "") || "/";
        return beforePath === wantPath && before.hash !== want.hash;
    } catch {
        return false;
    }
}

function requestedUrlHasHash(url: string): boolean {
    try {
        return new URL(url).hash.length > 0;
    } catch {
        return url.includes("#");
    }
}

/** Center of a CDP `DOM.getBoxModel` content quad `[x1,y1,x2,y2,x3,y3,x4,y4]`. */
export function contentQuadCenter(quad: number[]): { x: number; y: number } {
    if (!quad || quad.length < 8) {
        throw new Error("invalid box model content quad");
    }
    const xs = [quad[0], quad[2], quad[4], quad[6]];
    const ys = [quad[1], quad[3], quad[5], quad[7]];
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    if (!(width >= 1) || !(height >= 1) || !xs.every(Number.isFinite) || !ys.every(Number.isFinite)) {
        throw new Error("degenerate box model content quad");
    }
    const x = (quad[0] + quad[2] + quad[4] + quad[6]) / 4;
    const y = (quad[1] + quad[3] + quad[5] + quad[7]) / 4;
    return { x, y };
}

export function clientRectCenter(r: { x: number; y: number; width: number; height: number }): { x: number; y: number } {
    if (!Number.isFinite(r.x) || !Number.isFinite(r.y) || !(r.width >= 1) || !(r.height >= 1)) {
        throw new Error("element has zero-area box");
    }
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

export function selectAllModifier(platform: string): "Meta" | "Control" {
    return platform === "darwin" ? "Meta" : "Control";
}

/** CDP Input.dispatchKeyEvent modifiers: Alt=1, Ctrl=2, Meta=4, Shift=8. */
export function selectAllKeyModifiers(platform: string): number {
    return platform === "darwin" ? 4 : 2;
}

export type AxValue = {
    type?: string;
    value?: unknown;
};

export type AxNode = {
    nodeId?: string;
    ignored?: boolean;
    role?: AxValue;
    name?: AxValue;
    value?: AxValue;
    parentId?: string;
    childIds?: string[];
    backendDOMNodeId?: number;
};

export type AxRef = {
    n: number;
    backendDOMNodeId?: number;
};

export type FormatAxResult = {
    text: string;
    truncated: boolean;
    refs: AxRef[];
};

export function axValue(v?: AxValue | null): string {
    if (v == null || v.value == null || v.value === "") {
        return "";
    }
    return String(v.value);
}

function flattenDisplay(s: string): string {
    return s.replace(/[\r\n]+/g, " ");
}

function utf8Len(s: string): number {
    return Buffer.byteLength(s, "utf8");
}

/**
 * Compact accessibility snapshot from CDP `Accessibility.getFullAXTree`.
 * Skips `ignored` nodes (children are still visited). Interactive roles get
 * 1-based `@N` refs in tree order.
 */
export function formatAxSnapshot(opts: {
    nodes: AxNode[] | null | undefined;
    url?: string;
    title?: string;
}): FormatAxResult {
    const url = opts.url ?? "";
    const title = opts.title ?? "";
    const header = `url: ${url}\ntitle: ${title}\n`;
    const nodes = opts.nodes ?? [];
    const byId = new Map<string, AxNode>();
    for (const node of nodes) {
        if (node?.nodeId) {
            byId.set(node.nodeId, node);
        }
    }
    const root = nodes.find((n) => n && !n.parentId) ?? nodes[0];
    const lines: string[] = [];
    const refs: AxRef[] = [];
    let truncated = false;
    let nextN = 1;
    const headerLines = 2;

    const tryPush = (line: string): boolean => {
        const totalLines = headerLines + lines.length + 1;
        const nextText = header + [...lines, line].join("\n") + "\n";
        if (totalLines > SNAPSHOT_MAX_LINES || utf8Len(nextText) > SNAPSHOT_MAX_BYTES) {
            truncated = true;
            return false;
        }
        lines.push(line);
        return true;
    };

    const visit = (node: AxNode | undefined) => {
        if (!node || truncated) {
            return;
        }
        if (!node.ignored) {
            const role = flattenDisplay(axValue(node.role) || "generic");
            const name = flattenDisplay(axValue(node.name));
            const value = flattenDisplay(axValue(node.value));
            const roleLower = role.toLowerCase();
            const isRootWebArea = roleLower === "rootwebarea" || roleLower === "webarea";
            const isInteractive = INTERACTIVE_ROLES.has(roleLower);
            let line: string | null = null;
            if (isRootWebArea) {
                line = null;
            } else if (isInteractive) {
                const n = nextN++;
                refs.push({ n, backendDOMNodeId: node.backendDOMNodeId });
                line = `@${n} ${role} "${name}"`;
                if (value) {
                    line += ` value="${value}"`;
                }
            } else if (name) {
                line = `- ${role} "${name}"`;
            }
            if (line && !tryPush(line)) {
                return;
            }
        }
        for (const childId of node.childIds ?? []) {
            if (truncated) {
                return;
            }
            visit(byId.get(childId));
        }
    };

    if (root) {
        visit(root);
    }

    const text = header + (lines.length ? lines.join("\n") + "\n" : "");
    return { text, truncated, refs };
}

export function truncateJsonValue(
    value: unknown,
    maxBytes: number = JS_RESULT_MAX_BYTES
): { value: unknown; truncated: boolean } {
    let encoded: string;
    try {
        encoded = JSON.stringify(value);
    } catch {
        encoded = JSON.stringify(String(value));
    }
    if (encoded == null) {
        return { value: null, truncated: false };
    }
    if (utf8Len(encoded) <= maxBytes) {
        return { value, truncated: false };
    }
    return { value: { truncated: true, bytes: utf8Len(encoded) }, truncated: true };
}

export function stringifyPrintArg(arg: unknown): string {
    if (typeof arg === "string") {
        return arg;
    }
    if (arg === undefined) {
        return "undefined";
    }
    if (typeof arg === "function") {
        return String(arg);
    }
    try {
        return JSON.stringify(arg);
    } catch {
        return String(arg);
    }
}

export function checkScriptSize(script: string): void {
    if (utf8Len(script) > WEB_RUN_MAX_SCRIPT_BYTES) {
        throw new Error(
            `script exceeds max size (${utf8Len(script)} bytes, max ${WEB_RUN_MAX_SCRIPT_BYTES})`
        );
    }
}

export function capSleepMs(ms: number): number {
    if (!Number.isFinite(ms) || ms <= 0) {
        return 0;
    }
    return Math.min(ms, SLEEP_CAP_MS);
}
