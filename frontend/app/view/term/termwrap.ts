// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { BlockNodeModel } from "@/app/block/blocktypes";
import { getFileSubject } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { WOS, fetchWaveFile, getApi, getSettingsKeyAtom, globalStore, openLink } from "@/store/global";
import * as services from "@/store/services";
import { sanitizeOsc7Path } from "@/util/pathutil";
import { PLATFORM, PlatformMacOS } from "@/util/platformutil";
import { base64ToArray, base64ToString, fireAndForget } from "@/util/util";
import { LigaturesAddon } from "@xterm/addon-ligatures";
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

// Debounce map for OSC 7 updates per tab
const osc7DebounceMap = new Map<string, NodeJS.Timeout>();
const OSC7_DEBOUNCE_MS = 300;

function clearOsc7Debounce(tabId: string) {
    const existing = osc7DebounceMap.get(tabId);
    if (existing) {
        clearTimeout(existing);
        osc7DebounceMap.delete(tabId);
    }
}

// Cleanup function to prevent memory leaks
function cleanupOsc7DebounceForTab(tabId: string) {
    clearOsc7Debounce(tabId);
}

// Export cleanup function for use in tab close handlers
export { cleanupOsc7DebounceForTab };

const TermFileName = "term";
const TermCacheFileName = "cache:term:full";
const MinDataProcessedForCache = 100 * 1024;
const Osc52MaxDecodedSize = 75 * 1024; // max clipboard size for OSC 52 (matches common terminal implementations)
const Osc52MaxRawLength = 128 * 1024; // includes selector + base64 + whitespace (rough check)
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
    useLigatures?: boolean;
    sendDataHandler?: (data: string) => void;
    nodeModel?: BlockNodeModel;
    jobId?: string;
};

// for xterm OSC handlers, we return true always because we "own" the OSC number.
// even if data is invalid we don't want to propagate to other handlers.
function handleOsc52Command(data: string, blockId: string, loaded: boolean, termWrap: TermWrap): boolean {
    if (!loaded) {
        return true;
    }
    const isBlockFocused = termWrap.nodeModel ? globalStore.get(termWrap.nodeModel.isFocused) : false;
    if (!document.hasFocus() || !isBlockFocused) {
        console.log("OSC 52: rejected, window or block not focused");
        return true;
    }
    if (!data || data.length === 0) {
        console.log("OSC 52: empty data received");
        return true;
    }
    if (data.length > Osc52MaxRawLength) {
        console.log("OSC 52: raw data too large", data.length);
        return true;
    }

    const semicolonIndex = data.indexOf(";");
    if (semicolonIndex === -1) {
        console.log("OSC 52: invalid format (no semicolon)", data.substring(0, 50));
        return true;
    }

    const clipboardSelection = data.substring(0, semicolonIndex);
    const base64Data = data.substring(semicolonIndex + 1);

    // clipboard query ("?") is not supported for security (prevents clipboard theft)
    if (base64Data === "?") {
        console.log("OSC 52: clipboard query not supported");
        return true;
    }

    if (base64Data.length === 0) {
        return true;
    }

    if (clipboardSelection.length > 10) {
        console.log("OSC 52: clipboard selection too long", clipboardSelection);
        return true;
    }

    const estimatedDecodedSize = Math.ceil(base64Data.length * 0.75);
    if (estimatedDecodedSize > Osc52MaxDecodedSize) {
        console.log("OSC 52: data too large", estimatedDecodedSize, "bytes");
        return true;
    }

    try {
        // strip whitespace from base64 data (some terminals chunk with newlines per RFC 4648)
        const cleanBase64Data = base64Data.replace(/\s+/g, "");
        const decodedText = base64ToString(cleanBase64Data);

        // validate actual decoded size (base64 estimate can be off for multi-byte UTF-8)
        const actualByteSize = new TextEncoder().encode(decodedText).length;
        if (actualByteSize > Osc52MaxDecodedSize) {
            console.log("OSC 52: decoded text too large", actualByteSize, "bytes");
            return true;
        }

        fireAndForget(async () => {
            try {
                await navigator.clipboard.writeText(decodedText);
                dlog("OSC 52: copied", decodedText.length, "characters to clipboard");
            } catch (err) {
                console.error("OSC 52: clipboard write failed:", err);
            }
        });
    } catch (e) {
        console.error("OSC 52: base64 decode error:", e);
    }

    return true;
}

/**
 * Handles OSC 7 terminal escape sequences for directory change notifications.
 *
 * OSC 7 is a standard terminal escape sequence that shells use to report
 * the current working directory. Format: `\033]7;file://hostname/path\007`
 *
 * This handler performs two operations:
 * 1. Updates the block's `cmd:cwd` metadata with the current directory
 * 2. Optionally updates the tab's `tab:basedir` via smart auto-detection
 *
 * ## Smart Auto-Detection
 *
 * The tab's base directory is updated ONLY when ALL conditions are met:
 * - `tab:basedirlock` is false (not locked by user)
 * - `tab:basedir` is either:
 *   - Not set (null/undefined) - First directory wins
 *   - Set to home directory ("~") - Replace default with actual path
 *
 * This design allows the first terminal to "teach" the tab its working
 * directory, while respecting explicit user choices.
 *
 * @param data - OSC 7 command data in URL format (file://hostname/path)
 * @param blockId - Block ID of the terminal emitting the command
 * @param loaded - Whether terminal has completed initialization
 * @returns true (always claims ownership of OSC 7)
 *
 * @example
 * // Shell sends: printf '\033]7;file://localhost/home/user/project\007'
 * // Handler extracts: /home/user/project
 * // Updates: block.meta["cmd:cwd"] = "/home/user/project"
 * // If unlocked and basedir empty: tab.meta["tab:basedir"] = "/home/user/project"
 *
 * @see https://invisible-island.net/xterm/ctlseqs/ctlseqs.html#h3-Operating-System-Commands
 */
function handleOsc7Command(data: string, blockId: string, tabId: string, loaded: boolean): boolean {
    dlog("OSC 7 received:", { data, blockId, loaded });
    if (!loaded) {
        dlog("OSC 7 ignored - terminal not loaded");
        return true;
    }
    if (data == null || data.length == 0) {
        dlog("Invalid OSC 7 command received (empty)");
        return true;
    }
    if (data.length > 1024) {
        dlog("Invalid OSC 7, data length too long", data.length);
        return true;
    }

    let pathPart: string;
    try {
        const url = new URL(data);
        if (url.protocol !== "file:") {
            dlog("Invalid OSC 7 command received (non-file protocol)", data);
            return true;
        }

        // SECURITY: Only decode once to prevent double-encoding bypass attacks
        // e.g., %252e%252e -> %2e%2e -> .. (if decoded twice)
        pathPart = decodeURIComponent(url.pathname);

        // SECURITY: Block UNC paths BEFORE normalization to prevent bypass
        // UNC paths like //server or \\server can be used for data exfiltration via network shares
        // This regex matches both forward-slash and backslash UNC paths: //server, \\server, /\\server
        if (/^[\\/]{2}[^\\/]/.test(pathPart)) {
            console.warn("[Security] UNC path blocked in OSC 7:", pathPart);
            return true;
        }

        // Normalize double slashes at the beginning to single slash
        if (pathPart.startsWith("//")) {
            pathPart = pathPart.substring(1);
        }

        // Handle Windows paths (e.g., /C:/... or /D:\...)
        if (/^\/[a-zA-Z]:[\\/]/.test(pathPart)) {
            // Strip leading slash and normalize to forward slashes
            pathPart = pathPart.substring(1).replace(/\\/g, "/");
            dlog("OSC 7 Windows path normalized:", pathPart);
        }
    } catch (e) {
        dlog("Invalid OSC 7 command received (parse error)", data, e);
        return true;
    }

    // ========== SECURITY VALIDATION ==========
    // Validate and sanitize the path before storing to metadata
    const validatedPath = sanitizeOsc7Path(pathPart);
    if (validatedPath == null) {
        // Path was rejected by security validation
        // Warning already logged by sanitizeOsc7Path
        return true;
    }
    // ==========================================

    setTimeout(() => {
        fireAndForget(async () => {
            // Use validated path for all operations
            await services.ObjectService.UpdateObjectMeta(WOS.makeORef("block", blockId), {
                "cmd:cwd": validatedPath,
            });

            const rtInfo = { "shell:hascurcwd": true };
            const rtInfoData: CommandSetRTInfoData = {
                oref: WOS.makeORef("block", blockId),
                data: rtInfo,
            };
            await RpcApi.SetRTInfoCommand(TabRpcClient, rtInfoData).catch((e) =>
                console.log("error setting RT info", e)
            );

            // ===== Smart Auto-Detection =====
            // Automatically update tab basedir from terminal's working directory.
            // This allows the first terminal in a tab to "teach" the tab its project context.
            //
            // Design: Uses debouncing (300ms) + atomic lock check to prevent race conditions
            // when multiple terminals send OSC 7 updates simultaneously.
            //
            // IMPORTANT: We use the tabId passed from TermWrap (the tab that owns this terminal),
            // NOT atoms.activeTab, to ensure background terminals update the correct tab.
            if (!tabId) {
                return; // Early return if no tabId
            }

            const tabORef = WOS.makeORef("tab", tabId);

            // Clear existing debounce timer for this tab
            clearOsc7Debounce(tabId);

            // Debounce OSC 7 updates to reduce race condition window (300ms)
            // This consolidates rapid cd commands into a single update
            osc7DebounceMap.set(
                tabId,
                setTimeout(() => {
                    osc7DebounceMap.delete(tabId);

                    fireAndForget(async () => {
                        // Get fresh tab data with current version for atomic update
                        const currentTab = WOS.getObjectValue<Tab>(tabORef);
                        if (!currentTab) {
                            return;
                        }

                        const currentVersion = currentTab.version ?? 0;
                        const isLocked = currentTab.meta?.["tab:basedirlock"];
                        const currentBasedir = currentTab.meta?.["tab:basedir"];

                        // Only skip if explicitly locked
                        if (isLocked) {
                            dlog("OSC 7: Skipping update - tab basedir is locked");
                            return;
                        }

                        // Only update basedir if it's empty or equals "~" (smart auto-detection)
                        // This respects user-set directories while allowing first terminal to "teach" the tab
                        if (currentBasedir && currentBasedir !== "~") {
                            dlog("OSC 7: Skipping update - tab basedir already explicitly set:", currentBasedir);
                            return;
                        }

                        try {
                            // Use atomic lock-aware update to prevent TOCTOU (Time-Of-Check-Time-Of-Use)
                            // This ensures the lock state and version haven't changed since we checked
                            await services.ObjectService.UpdateObjectMetaIfNotLocked(
                                tabORef,
                                { "tab:basedir": validatedPath },
                                "tab:basedirlock",
                                currentVersion
                            );

                            // Update validation state to "valid" after successful OSC 7 update
                            const { getTabModelByTabId } = await import("@/store/tab-model");
                            const tabModel = getTabModelByTabId(tabId);
                            globalStore.set(tabModel.basedirValidationAtom, "valid");
                            globalStore.set(tabModel.lastValidationTimeAtom, Date.now());
                        } catch (err: any) {
                            // Version mismatch or locked - silently ignore
                            // This is expected during concurrent updates or when user locks the directory
                            if (err.message?.includes("version mismatch") || err.message?.includes("locked")) {
                                dlog("OSC 7: Skipped update (concurrent modification or locked)");
                                return;
                            }
                            console.log("OSC 7: Error updating tab basedir:", err);
                        }
                    });
                }, OSC7_DEBOUNCE_MS)
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

// Telemetry removed - checkCommandForTelemetry function removed

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
            termWrap.setShellIntegrationStatus("ready");
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
            termWrap.setShellIntegrationStatus("running-command");
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
                        // Telemetry removed - no command tracking
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
            termWrap.setShellIntegrationStatus(null);
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
    tabId: string;
    blockId: string;
    jobId: string;
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
    nodeModel: BlockNodeModel; // this can be null
    onShellIntegrationStatusChange?: () => void; // callback for tab status updates

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
        tabId: string,
        blockId: string,
        connectElem: HTMLDivElement,
        options: TermTypes.ITerminalOptions & TermTypes.ITerminalInitOnlyOptions,
        waveOptions: TermWrapOptions
    ) {
        this.loaded = false;
        this.tabId = tabId;
        this.blockId = blockId;
        this.jobId = waveOptions.jobId;
        this.sendDataHandler = waveOptions.sendDataHandler;
        this.nodeModel = waveOptions.nodeModel;
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
                dlog("loaded webgl!");
                loggedWebGL = true;
            }
        }
        // Register OSC handlers
        this.terminal.parser.registerOscHandler(7, (data: string) => {
            return handleOsc7Command(data, this.blockId, this.tabId, this.loaded);
        });
        this.terminal.parser.registerOscHandler(52, (data: string) => {
            return handleOsc52Command(data, this.blockId, this.loaded, this);
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
        if (waveOptions.useLigatures) {
            const ligaturesAddon = new LigaturesAddon();
            this.terminal.loadAddon(ligaturesAddon);
        }
        this.handleResize();
        const pasteHandler = this.pasteHandler.bind(this);
        this.connectElem.addEventListener("paste", pasteHandler, true);
        this.toDispose.push({
            dispose: () => {
                this.connectElem.removeEventListener("paste", pasteHandler, true);
            },
        });
    }

    getZoneId(): string {
        return this.jobId ?? this.blockId;
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

        this.mainFileSubject = getFileSubject(this.getZoneId(), TermFileName);
        this.mainFileSubject.subscribe(this.handleNewFileSubjectData.bind(this));

        try {
            const rtInfo = await RpcApi.GetRTInfoCommand(TabRpcClient, {
                oref: WOS.makeORef("block", this.blockId),
            });

            if (rtInfo && rtInfo["shell:integration"]) {
                const shellState = rtInfo["shell:state"] as ShellIntegrationStatus;
                this.setShellIntegrationStatus(shellState || null);
            } else {
                this.setShellIntegrationStatus(null);
            }

            const lastCmd = rtInfo ? rtInfo["shell:lastcmd"] : null;
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

    /**
     * Sets the shell integration status and notifies listeners for tab status updates.
     */
    setShellIntegrationStatus(status: "ready" | "running-command" | null) {
        globalStore.set(this.shellIntegrationStatusAtom, status);
        this.onShellIntegrationStatusChange?.();
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

        if (this.pasteActive) {
            if (this.multiInputCallback) {
                this.multiInputCallback(data);
            }
        }

        // IME Deduplication (for Capslock input method switching)
        // When switching input methods with Capslock during composition, some systems send the
        // composed text twice. We allow the first send and block subsequent duplicates.
        const IMEDedupWindowMs = 50;
        const now = Date.now();
        const timeSinceCompositionEnd = now - this.lastCompositionEnd;
        if (timeSinceCompositionEnd < IMEDedupWindowMs && data === this.lastComposedText && this.lastComposedText) {
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
        const startTs = Date.now();
        const zoneId = this.getZoneId();
        const { data: cacheData, fileInfo: cacheFile } = await fetchWaveFile(zoneId, TermCacheFileName);
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
        const { data: mainData, fileInfo: mainFile } = await fetchWaveFile(zoneId, TermFileName, ptyOffset);
        dlog(
            `terminal loaded cachefile:${cacheData?.byteLength ?? 0} main:${mainData?.byteLength ?? 0} bytes, ${Date.now() - startTs}ms`
        );
        if (mainFile != null) {
            await this.doTerminalWrite(mainData, null);
        }
    }

    async resyncController(reason: string) {
        dlog("resync controller", this.blockId, reason);
        const rtOpts: RuntimeOpts = { termsize: { rows: this.terminal.rows, cols: this.terminal.cols } };
        try {
            await RpcApi.ControllerResyncCommand(TabRpcClient, {
                tabid: this.tabId,
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
            RpcApi.ControllerInputCommand(TabRpcClient, { blockid: this.blockId, termsize: termSize }).catch(() => {
                // Expected during startup - controller may not be ready yet
            });
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
