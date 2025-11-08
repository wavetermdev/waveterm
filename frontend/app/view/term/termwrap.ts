// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getFileSubject } from "@/app/store/wps";
import { sendWSCommand } from "@/app/store/ws";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { WOS, atoms, fetchWaveFile, getApi, getSettingsKeyAtom, globalStore, openLink } from "@/store/global";
import * as services from "@/store/services";
import { PLATFORM, PlatformMacOS } from "@/util/platformutil";
import { base64ToArray, base64ToString, fireAndForget } from "@/util/util";
import { SearchAddon } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import * as TermTypes from "@xterm/xterm";
import { Terminal } from "@xterm/xterm";
import debug from "debug";
import * as jotai from "jotai";
import { debounce } from "throttle-debounce";
import { FitAddon } from "./fitaddon";
import { createTempFileFromBlob, extractAllClipboardData } from "./termutil";

const dlog = debug("wave:termwrap");

const TermFileName = "term";
const TermCacheFileName = "cache:term:full";
const MinDataProcessedForCache = 100 * 1024;
export const SupportsImageInput = true;

// detect webgl support
function detectWebGLSupport(): boolean {
    try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("webgl");
        return !!ctx;
    } catch (e) {
        return false;
    }
}

const WebGLSupported = detectWebGLSupport();
let loggedWebGL = false;

type TermWrapOptions = {
    keydownHandler?: (e: KeyboardEvent) => boolean;
    useWebGl?: boolean;
    sendDataHandler?: (data: string) => void;
};

function handleOscWaveCommand(data: string, blockId: string, loaded: boolean): boolean {
    if (!loaded) {
        return true;
    }
    if (!data || data.length === 0) {
        console.log("Invalid Wave OSC command received (empty)");
        return true;
    }

    // Expected formats:
    // "setmeta;{JSONDATA}"
    // "setmeta;[wave-id];{JSONDATA}"
    const parts = data.split(";");
    if (parts[0] !== "setmeta") {
        console.log("Invalid Wave OSC command received (bad command)", data);
        return true;
    }
    let jsonPayload: string;
    let waveId: string | undefined;
    if (parts.length === 2) {
        jsonPayload = parts[1];
    } else if (parts.length >= 3) {
        waveId = parts[1];
        jsonPayload = parts.slice(2).join(";");
    } else {
        console.log("Invalid Wave OSC command received (1 part)", data);
        return true;
    }

    let meta: any;
    try {
        meta = JSON.parse(jsonPayload);
    } catch (e) {
        console.error("Invalid JSON in Wave OSC command:", e);
        return true;
    }

    if (waveId) {
        // Resolve the wave id to an ORef using our ResolveIdsCommand.
        fireAndForget(() => {
            return RpcApi.ResolveIdsCommand(TabRpcClient, { blockid: blockId, ids: [waveId] })
                .then((response: { resolvedids: { [key: string]: any } }) => {
                    const oref = response.resolvedids[waveId];
                    if (!oref) {
                        console.error("Failed to resolve wave id:", waveId);
                        return;
                    }
                    services.ObjectService.UpdateObjectMeta(oref, meta);
                })
                .catch((err: any) => {
                    console.error("Error resolving wave id", waveId, err);
                });
        });
    } else {
        // No wave id provided; update using the current block id.
        fireAndForget(() => {
            return services.ObjectService.UpdateObjectMeta(WOS.makeORef("block", blockId), meta);
        });
    }
    return true;
}

// for xterm handlers, we return true always because we "own" OSC 7.
// even if it is invalid we dont want to propagate to other handlers
function handleOsc7Command(data: string, blockId: string, loaded: boolean): boolean {
    if (!loaded) {
        return true;
    }
    if (data == null || data.length == 0) {
        console.log("Invalid OSC 7 command received (empty)");
        return true;
    }
    if (data.length > 1024) {
        console.log("Invalid OSC 7, data length too long", data.length);
        return true;
    }

    let pathPart: string;
    try {
        const url = new URL(data);
        if (url.protocol !== "file:") {
            console.log("Invalid OSC 7 command received (non-file protocol)", data);
            return true;
        }
        pathPart = decodeURIComponent(url.pathname);

        // Normalize double slashes at the beginning to single slash
        if (pathPart.startsWith("//")) {
            pathPart = pathPart.substring(1);
        }

        // Handle Windows paths (e.g., /C:/... or /D:\...)
        if (/^\/[a-zA-Z]:[\\/]/.test(pathPart)) {
            // Strip leading slash and normalize to forward slashes
            pathPart = pathPart.substring(1).replace(/\\/g, "/");
        }

        // Handle UNC paths (e.g., /\\server\share)
        if (pathPart.startsWith("/\\\\")) {
            // Strip leading slash but keep backslashes for UNC
            pathPart = pathPart.substring(1);
        }
    } catch (e) {
        console.log("Invalid OSC 7 command received (parse error)", data, e);
        return true;
    }

    setTimeout(() => {
        fireAndForget(async () => {
            await services.ObjectService.UpdateObjectMeta(WOS.makeORef("block", blockId), {
                "cmd:cwd": pathPart,
            });

            const rtInfo = { "shell:hascurcwd": true };
            const rtInfoData: CommandSetRTInfoData = {
                oref: WOS.makeORef("block", blockId),
                data: rtInfo,
            };
            await RpcApi.SetRTInfoCommand(TabRpcClient, rtInfoData).catch((e) =>
                console.log("error setting RT info", e)
            );
        });
    }, 0);
    return true;
}

// some POC concept code for adding a decoration to a marker
function addTestMarkerDecoration(terminal: Terminal, marker: TermTypes.IMarker, termWrap: TermWrap): void {
    const decoration = terminal.registerDecoration({
        marker: marker,
        layer: "top",
    });
    if (!decoration) {
        return;
    }
    decoration.onRender((el) => {
        el.classList.add("wave-decoration");
        el.classList.add("bg-ansi-white");
        el.dataset.markerline = String(marker.line);
        if (!el.querySelector(".wave-deco-line")) {
            const line = document.createElement("div");
            line.classList.add("wave-deco-line", "bg-accent/20");
            line.style.position = "absolute";
            line.style.top = "0";
            line.style.left = "0";
            line.style.width = "500px";
            line.style.height = "1px";
            el.appendChild(line);
        }
    });
}

// OSC 16162 - Shell Integration Commands
// See aiprompts/wave-osc-16162.md for full documentation
type ShellIntegrationStatus = "ready" | "running-command";

type Osc16162Command =
    | { command: "A"; data: {} }
    | { command: "C"; data: { cmd64?: string } }
    | { command: "M"; data: { shell?: string; shellversion?: string; uname?: string; integration?: boolean } }
    | { command: "D"; data: { exitcode?: number } }
    | { command: "I"; data: { inputempty?: boolean } }
    | { command: "R"; data: {} };

function handleOsc16162Command(data: string, blockId: string, loaded: boolean, termWrap: TermWrap): boolean {
    const terminal = termWrap.terminal;
    if (!loaded) {
        return true;
    }
    if (!data || data.length === 0) {
        return true;
    }

    const parts = data.split(";");
    const commandStr = parts[0];
    const jsonDataStr = parts.length > 1 ? parts.slice(1).join(";") : null;
    let parsedData: Record<string, any> = {};
    if (jsonDataStr) {
        try {
            parsedData = JSON.parse(jsonDataStr);
        } catch (e) {
            console.error("Error parsing OSC 16162 JSON data:", e);
        }
    }

    const cmd: Osc16162Command = { command: commandStr, data: parsedData } as Osc16162Command;
    const rtInfo: ObjRTInfo = {};
    switch (cmd.command) {
        case "A":
            rtInfo["shell:state"] = "ready";
            globalStore.set(termWrap.shellIntegrationStatusAtom, "ready");
            const marker = terminal.registerMarker(0);
            if (marker) {
                termWrap.promptMarkers.push(marker);
                // addTestMarkerDecoration(terminal, marker, termWrap);
                marker.onDispose(() => {
                    const idx = termWrap.promptMarkers.indexOf(marker);
                    if (idx !== -1) {
                        termWrap.promptMarkers.splice(idx, 1);
                    }
                });
            }
            break;
        case "C":
            rtInfo["shell:state"] = "running-command";
            globalStore.set(termWrap.shellIntegrationStatusAtom, "running-command");
            getApi().incrementTermCommands();
            if (cmd.data.cmd64) {
                const decodedLen = Math.ceil(cmd.data.cmd64.length * 0.75);
                if (decodedLen > 8192) {
                    rtInfo["shell:lastcmd"] = `# command too large (${decodedLen} bytes)`;
                    globalStore.set(termWrap.lastCommandAtom, rtInfo["shell:lastcmd"]);
                } else {
                    try {
                        const decodedCmd = base64ToString(cmd.data.cmd64);
                        rtInfo["shell:lastcmd"] = decodedCmd;
                        globalStore.set(termWrap.lastCommandAtom, decodedCmd);
                    } catch (e) {
                        console.error("Error decoding cmd64:", e);
                        rtInfo["shell:lastcmd"] = null;
                        globalStore.set(termWrap.lastCommandAtom, null);
                    }
                }
            } else {
                rtInfo["shell:lastcmd"] = null;
                globalStore.set(termWrap.lastCommandAtom, null);
            }
            // also clear lastcmdexitcode (since we've now started a new command)
            rtInfo["shell:lastcmdexitcode"] = null;
            break;
        case "M":
            if (cmd.data.shell) {
                rtInfo["shell:type"] = cmd.data.shell;
            }
            if (cmd.data.shellversion) {
                rtInfo["shell:version"] = cmd.data.shellversion;
            }
            if (cmd.data.uname) {
                rtInfo["shell:uname"] = cmd.data.uname;
            }
            if (cmd.data.integration != null) {
                rtInfo["shell:integration"] = cmd.data.integration;
            }
            break;
        case "D":
            if (cmd.data.exitcode != null) {
                rtInfo["shell:lastcmdexitcode"] = cmd.data.exitcode;
            } else {
                rtInfo["shell:lastcmdexitcode"] = null;
            }
            break;
        case "I":
            if (cmd.data.inputempty != null) {
                rtInfo["shell:inputempty"] = cmd.data.inputempty;
            }
            break;
        case "R":
            globalStore.set(termWrap.shellIntegrationStatusAtom, null);
            if (terminal.buffer.active.type === "alternate") {
                terminal.write("\x1b[?1049l");
            }
            break;
    }

    if (Object.keys(rtInfo).length > 0) {
        setTimeout(() => {
            fireAndForget(async () => {
                const rtInfoData: CommandSetRTInfoData = {
                    oref: WOS.makeORef("block", blockId),
                    data: rtInfo,
                };
                await RpcApi.SetRTInfoCommand(TabRpcClient, rtInfoData).catch((e) =>
                    console.log("error setting RT info (OSC 16162)", e)
                );
            });
        }, 0);
    }

    return true;
}

export class TermWrap {
    blockId: string;
    ptyOffset: number;
    dataBytesProcessed: number;
    terminal: Terminal;
    connectElem: HTMLDivElement;
    fitAddon: FitAddon;
    searchAddon: SearchAddon;
    serializeAddon: SerializeAddon;
    mainFileSubject: SubjectWithRef<WSFileEventData>;
    loaded: boolean;
    heldData: Uint8Array[];
    handleResize_debounced: () => void;
    hasResized: boolean;
    multiInputCallback: (data: string) => void;
    sendDataHandler: (data: string) => void;
    onSearchResultsDidChange?: (result: { resultIndex: number; resultCount: number }) => void;
    private toDispose: TermTypes.IDisposable[] = [];
    pasteActive: boolean = false;
    lastUpdated: number;
    promptMarkers: TermTypes.IMarker[] = [];
    shellIntegrationStatusAtom: jotai.PrimitiveAtom<"ready" | "running-command" | null>;
    lastCommandAtom: jotai.PrimitiveAtom<string | null>;

    // IME composition state tracking
    // Prevents duplicate input when switching input methods during composition (e.g., using Capslock)
    // xterm.js sends data during compositionupdate AND after compositionend, causing duplicates
    isComposing: boolean = false;
    composingData: string = "";
    lastCompositionEnd: number = 0;
    lastComposedText: string = "";
    firstDataAfterCompositionSent: boolean = false;

    // Paste deduplication
    // xterm.js paste() method triggers onData event, which can cause duplicate sends
    lastPasteData: string = "";
    lastPasteTime: number = 0;

    constructor(
        blockId: string,
        connectElem: HTMLDivElement,
        options: TermTypes.ITerminalOptions & TermTypes.ITerminalInitOnlyOptions,
        waveOptions: TermWrapOptions
    ) {
        this.loaded = false;
        this.blockId = blockId;
        this.sendDataHandler = waveOptions.sendDataHandler;
        this.ptyOffset = 0;
        this.dataBytesProcessed = 0;
        this.hasResized = false;
        this.lastUpdated = Date.now();
        this.promptMarkers = [];
        this.shellIntegrationStatusAtom = jotai.atom(null) as jotai.PrimitiveAtom<"ready" | "running-command" | null>;
        this.lastCommandAtom = jotai.atom(null) as jotai.PrimitiveAtom<string | null>;
        this.terminal = new Terminal(options);
        this.fitAddon = new FitAddon();
        this.fitAddon.noScrollbar = PLATFORM === PlatformMacOS;
        this.serializeAddon = new SerializeAddon();
        this.searchAddon = new SearchAddon();
        this.terminal.loadAddon(this.searchAddon);
        this.terminal.loadAddon(this.fitAddon);
        this.terminal.loadAddon(this.serializeAddon);
        this.terminal.loadAddon(
            new WebLinksAddon((e, uri) => {
                e.preventDefault();
                switch (PLATFORM) {
                    case PlatformMacOS:
                        if (e.metaKey) {
                            fireAndForget(() => openLink(uri));
                        }
                        break;
                    default:
                        if (e.ctrlKey) {
                            fireAndForget(() => openLink(uri));
                        }
                        break;
                }
            })
        );
        if (WebGLSupported && waveOptions.useWebGl) {
            const webglAddon = new WebglAddon();
            this.toDispose.push(
                webglAddon.onContextLoss(() => {
                    webglAddon.dispose();
                })
            );
            this.terminal.loadAddon(webglAddon);
            if (!loggedWebGL) {
                console.log("loaded webgl!");
                loggedWebGL = true;
            }
        }
        // Register OSC 9283 handler
        this.terminal.parser.registerOscHandler(9283, (data: string) => {
            return handleOscWaveCommand(data, this.blockId, this.loaded);
        });
        this.terminal.parser.registerOscHandler(7, (data: string) => {
            return handleOsc7Command(data, this.blockId, this.loaded);
        });
        this.terminal.parser.registerOscHandler(16162, (data: string) => {
            return handleOsc16162Command(data, this.blockId, this.loaded, this);
        });
        this.terminal.attachCustomKeyEventHandler(waveOptions.keydownHandler);
        this.connectElem = connectElem;
        this.mainFileSubject = null;
        this.heldData = [];
        this.handleResize_debounced = debounce(50, this.handleResize.bind(this));
        this.terminal.open(this.connectElem);
        this.handleResize();
        const pasteHandler = this.pasteHandler.bind(this);
        this.connectElem.addEventListener("paste", pasteHandler, true);
        this.toDispose.push({
            dispose: () => {
                this.connectElem.removeEventListener("paste", pasteHandler, true);
            },
        });
    }

    resetCompositionState() {
        this.isComposing = false;
        this.composingData = "";
    }

    private handleCompositionStart = (e: CompositionEvent) => {
        dlog("compositionstart", e.data);
        this.isComposing = true;
        this.composingData = "";
    };

    private handleCompositionUpdate = (e: CompositionEvent) => {
        dlog("compositionupdate", e.data);
        this.composingData = e.data || "";
    };

    private handleCompositionEnd = (e: CompositionEvent) => {
        dlog("compositionend", e.data);
        this.isComposing = false;
        this.lastComposedText = e.data || "";
        this.lastCompositionEnd = Date.now();
        this.firstDataAfterCompositionSent = false;
    };

    async initTerminal() {
        const copyOnSelectAtom = getSettingsKeyAtom("term:copyonselect");
        this.toDispose.push(this.terminal.onData(this.handleTermData.bind(this)));
        this.toDispose.push(this.terminal.onKey(this.onKeyHandler.bind(this)));
        this.toDispose.push(
            this.terminal.onSelectionChange(
                debounce(50, () => {
                    if (!globalStore.get(copyOnSelectAtom)) {
                        return;
                    }
                    const selectedText = this.terminal.getSelection();
                    if (selectedText.length > 0) {
                        navigator.clipboard.writeText(selectedText);
                    }
                })
            )
        );
        if (this.onSearchResultsDidChange != null) {
            this.toDispose.push(this.searchAddon.onDidChangeResults(this.onSearchResultsDidChange.bind(this)));
        }

        // Register IME composition event listeners on the xterm.js textarea
        const textareaElem = this.connectElem.querySelector("textarea");
        if (textareaElem) {
            textareaElem.addEventListener("compositionstart", this.handleCompositionStart);
            textareaElem.addEventListener("compositionupdate", this.handleCompositionUpdate);
            textareaElem.addEventListener("compositionend", this.handleCompositionEnd);

            // Handle blur during composition - reset state to avoid stale data
            const blurHandler = () => {
                if (this.isComposing) {
                    dlog("Terminal lost focus during composition, resetting IME state");
                    this.resetCompositionState();
                }
            };
            textareaElem.addEventListener("blur", blurHandler);

            this.toDispose.push({
                dispose: () => {
                    textareaElem.removeEventListener("compositionstart", this.handleCompositionStart);
                    textareaElem.removeEventListener("compositionupdate", this.handleCompositionUpdate);
                    textareaElem.removeEventListener("compositionend", this.handleCompositionEnd);
                    textareaElem.removeEventListener("blur", blurHandler);
                },
            });
        }

        this.mainFileSubject = getFileSubject(this.blockId, TermFileName);
        this.mainFileSubject.subscribe(this.handleNewFileSubjectData.bind(this));

        try {
            const rtInfo = await RpcApi.GetRTInfoCommand(TabRpcClient, {
                oref: WOS.makeORef("block", this.blockId),
            });

            if (rtInfo["shell:integration"]) {
                const shellState = rtInfo["shell:state"] as ShellIntegrationStatus;
                globalStore.set(this.shellIntegrationStatusAtom, shellState || null);
            } else {
                globalStore.set(this.shellIntegrationStatusAtom, null);
            }

            const lastCmd = rtInfo["shell:lastcmd"];
            globalStore.set(this.lastCommandAtom, lastCmd || null);
        } catch (e) {
            console.log("Error loading runtime info:", e);
        }

        try {
            await this.loadInitialTerminalData();
        } finally {
            this.loaded = true;
        }
        this.runProcessIdleTimeout();
    }

    dispose() {
        this.promptMarkers.forEach((marker) => {
            try {
                marker.dispose();
            } catch (_) {}
        });
        this.promptMarkers = [];
        this.terminal.dispose();
        this.toDispose.forEach((d) => {
            try {
                d.dispose();
            } catch (_) {}
        });
        this.mainFileSubject.release();
    }

    handleTermData(data: string) {
        if (!this.loaded) {
            return;
        }

        // IME Composition Handling
        // Block all data during composition - only send the final text after compositionend
        // This prevents xterm.js from sending intermediate composition data (e.g., during compositionupdate)
        if (this.isComposing) {
            dlog("Blocked data during composition:", data);
            return;
        }

        // Paste Deduplication
        // xterm.js paste() method triggers onData event, causing handleTermData to be called twice:
        // 1. From our paste handler (pasteActive=true)
        // 2. From xterm.js onData (pasteActive=false)
        // We allow the first call and block the second duplicate
        const DEDUP_WINDOW_MS = 50;
        const now = Date.now();
        const timeSinceLastPaste = now - this.lastPasteTime;

        if (this.pasteActive) {
            // First paste event - record it and allow through
            this.pasteActive = false;
            this.lastPasteData = data;
            this.lastPasteTime = now;
            if (this.multiInputCallback) {
                this.multiInputCallback(data);
            }
        } else if (timeSinceLastPaste < DEDUP_WINDOW_MS && data === this.lastPasteData && this.lastPasteData) {
            // Second paste event with same data within time window - this is a duplicate, block it
            dlog("Blocked duplicate paste data:", data);
            this.lastPasteData = ""; // Clear to allow same data to be pasted later
            return;
        }

        // IME Deduplication (for Capslock input method switching)
        // When switching input methods with Capslock during composition, some systems send the
        // composed text twice. We allow the first send and block subsequent duplicates.
        const timeSinceCompositionEnd = now - this.lastCompositionEnd;

        if (timeSinceCompositionEnd < DEDUP_WINDOW_MS && data === this.lastComposedText && this.lastComposedText) {
            if (!this.firstDataAfterCompositionSent) {
                // First send after composition - allow it but mark as sent
                this.firstDataAfterCompositionSent = true;
                dlog("First data after composition, allowing:", data);
            } else {
                // Second send of the same data - this is a duplicate from Capslock switching, block it
                dlog("Blocked duplicate IME data:", data);
                this.lastComposedText = ""; // Clear to allow same text to be typed again later
                this.firstDataAfterCompositionSent = false;
                return;
            }
        }

        this.sendDataHandler?.(data);
    }

    onKeyHandler(data: { key: string; domEvent: KeyboardEvent }) {
        if (this.multiInputCallback) {
            this.multiInputCallback(data.key);
        }
    }

    addFocusListener(focusFn: () => void) {
        this.terminal.textarea.addEventListener("focus", focusFn);
    }

    handleNewFileSubjectData(msg: WSFileEventData) {
        if (msg.fileop == "truncate") {
            this.terminal.clear();
            this.heldData = [];
        } else if (msg.fileop == "append") {
            const decodedData = base64ToArray(msg.data64);
            if (this.loaded) {
                this.doTerminalWrite(decodedData, null);
            } else {
                this.heldData.push(decodedData);
            }
        } else {
            console.log("bad fileop for terminal", msg);
            return;
        }
    }

    doTerminalWrite(data: string | Uint8Array, setPtyOffset?: number): Promise<void> {
        let resolve: () => void = null;
        let prtn = new Promise<void>((presolve, _) => {
            resolve = presolve;
        });
        this.terminal.write(data, () => {
            if (setPtyOffset != null) {
                this.ptyOffset = setPtyOffset;
            } else {
                this.ptyOffset += data.length;
                this.dataBytesProcessed += data.length;
            }
            this.lastUpdated = Date.now();
            resolve();
        });
        return prtn;
    }

    async loadInitialTerminalData(): Promise<void> {
        let startTs = Date.now();
        const { data: cacheData, fileInfo: cacheFile } = await fetchWaveFile(this.blockId, TermCacheFileName);
        let ptyOffset = 0;
        if (cacheFile != null) {
            ptyOffset = cacheFile.meta["ptyoffset"] ?? 0;
            if (cacheData.byteLength > 0) {
                const curTermSize: TermSize = { rows: this.terminal.rows, cols: this.terminal.cols };
                const fileTermSize: TermSize = cacheFile.meta["termsize"];
                let didResize = false;
                if (
                    fileTermSize != null &&
                    (fileTermSize.rows != curTermSize.rows || fileTermSize.cols != curTermSize.cols)
                ) {
                    console.log("terminal restore size mismatch, temp resize", fileTermSize, curTermSize);
                    this.terminal.resize(fileTermSize.cols, fileTermSize.rows);
                    didResize = true;
                }
                this.doTerminalWrite(cacheData, ptyOffset);
                if (didResize) {
                    this.terminal.resize(curTermSize.cols, curTermSize.rows);
                }
            }
        }
        const { data: mainData, fileInfo: mainFile } = await fetchWaveFile(this.blockId, TermFileName, ptyOffset);
        console.log(
            `terminal loaded cachefile:${cacheData?.byteLength ?? 0} main:${mainData?.byteLength ?? 0} bytes, ${Date.now() - startTs}ms`
        );
        if (mainFile != null) {
            await this.doTerminalWrite(mainData, null);
        }
    }

    async resyncController(reason: string) {
        dlog("resync controller", this.blockId, reason);
        const tabId = globalStore.get(atoms.staticTabId);
        const rtOpts: RuntimeOpts = { termsize: { rows: this.terminal.rows, cols: this.terminal.cols } };
        try {
            await RpcApi.ControllerResyncCommand(TabRpcClient, {
                tabid: tabId,
                blockid: this.blockId,
                rtopts: rtOpts,
            });
        } catch (e) {
            console.log(`error controller resync (${reason})`, this.blockId, e);
        }
    }

    handleResize() {
        const oldRows = this.terminal.rows;
        const oldCols = this.terminal.cols;
        this.fitAddon.fit();
        if (oldRows !== this.terminal.rows || oldCols !== this.terminal.cols) {
            const termSize: TermSize = { rows: this.terminal.rows, cols: this.terminal.cols };
            const wsCommand: SetBlockTermSizeWSCommand = {
                wscommand: "setblocktermsize",
                blockid: this.blockId,
                termsize: termSize,
            };
            sendWSCommand(wsCommand);
        }
        dlog("resize", `${this.terminal.rows}x${this.terminal.cols}`, `${oldRows}x${oldCols}`, this.hasResized);
        if (!this.hasResized) {
            this.hasResized = true;
            this.resyncController("initial resize");
        }
    }

    processAndCacheData() {
        if (this.dataBytesProcessed < MinDataProcessedForCache) {
            return;
        }
        const serializedOutput = this.serializeAddon.serialize();
        const termSize: TermSize = { rows: this.terminal.rows, cols: this.terminal.cols };
        console.log("idle timeout term", this.dataBytesProcessed, serializedOutput.length, termSize);
        fireAndForget(() =>
            services.BlockService.SaveTerminalState(this.blockId, serializedOutput, "full", this.ptyOffset, termSize)
        );
        this.dataBytesProcessed = 0;
    }

    runProcessIdleTimeout() {
        setTimeout(() => {
            window.requestIdleCallback(() => {
                this.processAndCacheData();
                this.runProcessIdleTimeout();
            });
        }, 5000);
    }

    async pasteHandler(e?: ClipboardEvent): Promise<void> {
        this.pasteActive = true;
        e?.preventDefault();
        e?.stopPropagation();

        try {
            const clipboardData = await extractAllClipboardData(e);
            let firstImage = true;
            for (const data of clipboardData) {
                if (data.image && SupportsImageInput) {
                    if (!firstImage) {
                        await new Promise((r) => setTimeout(r, 150));
                    }
                    const tempPath = await createTempFileFromBlob(data.image);
                    this.terminal.paste(tempPath + " ");
                    firstImage = false;
                }
                if (data.text) {
                    this.terminal.paste(data.text);
                }
            }
        } catch (err) {
            console.error("Paste error:", err);
        } finally {
            setTimeout(() => {
                this.pasteActive = false;
            }, 30);
        }
    }
}
