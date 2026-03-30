// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { BlockNodeModel } from "@/app/block/blocktypes";
import { setBadge } from "@/app/store/badge";
import { getFileSubject } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import {
    fetchWaveFile,
    getApi,
    getOverrideConfigAtom,
    getSettingsKeyAtom,
    globalStore,
    isDev,
    openLink,
    WOS,
} from "@/store/global";
import * as services from "@/store/services";
import { PLATFORM, PlatformMacOS } from "@/util/platformutil";
import { base64ToArray, fireAndForget } from "@/util/util";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import * as TermTypes from "@xterm/xterm";
import { Terminal } from "@xterm/xterm";
import debug from "debug";
import * as jotai from "jotai";
import { debounce } from "throttle-debounce";
import {
    handleOsc16162Command,
    handleOsc52Command,
    handleOsc7Command,
    isClaudeCodeCommand,
    type ShellIntegrationStatus,
} from "./osc-handlers";
import {
    bufferLinesToText,
    createTempFileFromBlob,
    extractAllClipboardData,
    normalizeCursorStyle,
    quoteForPosixShell,
} from "./termutil";

const dlog = debug("wave:termwrap");

const TermFileName = "term";
const TermCacheFileName = "cache:term:full";
const MinDataProcessedForCache = 100 * 1024;
export const SupportsImageInput = true;
const MaxRepaintTransactionMs = 2000;

// detect webgl support
function detectWebGLSupport(): boolean {
    try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("webgl2");
        return !!ctx;
    } catch (e) {
        return false;
    }
}

export const WebGLSupported = detectWebGLSupport();
let loggedWebGL = false;

type TermWrapOptions = {
    keydownHandler?: (e: KeyboardEvent) => boolean;
    useWebGl?: boolean;
    sendDataHandler?: (data: string) => void;
    nodeModel?: BlockNodeModel;
};

export class TermWrap {
    tabId: string;
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
    toDispose: TermTypes.IDisposable[] = [];
    webglAddon: WebglAddon | null = null;
    webglContextLossDisposable: TermTypes.IDisposable | null = null;
    webglEnabledAtom: jotai.PrimitiveAtom<boolean>;
    pasteActive: boolean = false;
    lastUpdated: number;
    promptMarkers: TermTypes.IMarker[] = [];
    shellIntegrationStatusAtom: jotai.PrimitiveAtom<ShellIntegrationStatus | null>;
    lastCommandAtom: jotai.PrimitiveAtom<string | null>;
    claudeCodeActiveAtom: jotai.PrimitiveAtom<boolean>;
    nodeModel: BlockNodeModel; // this can be null
    hoveredLinkUri: string | null = null;
    onLinkHover?: (uri: string | null, mouseX: number, mouseY: number) => void;

    // Paste deduplication
    // xterm.js paste() method triggers onData event, which can cause duplicate sends
    lastPasteData: string = "";
    lastPasteTime: number = 0;

    // dev only (for debugging)
    recentWrites: { idx: number; data: string; ts: number }[] = [];
    recentWritesCounter: number = 0;

    // for repaint transaction scrolling behavior
    lastClearScrollbackTs: number = 0;
    lastMode2026SetTs: number = 0;
    lastMode2026ResetTs: number = 0;
    inSyncTransaction: boolean = false;
    inRepaintTransaction: boolean = false;

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
        this.sendDataHandler = waveOptions.sendDataHandler;
        this.nodeModel = waveOptions.nodeModel;
        this.ptyOffset = 0;
        this.dataBytesProcessed = 0;
        this.hasResized = false;
        this.lastUpdated = Date.now();
        this.promptMarkers = [];
        this.shellIntegrationStatusAtom = jotai.atom(null) as jotai.PrimitiveAtom<ShellIntegrationStatus | null>;
        this.lastCommandAtom = jotai.atom(null) as jotai.PrimitiveAtom<string | null>;
        this.claudeCodeActiveAtom = jotai.atom(false);
        this.webglEnabledAtom = jotai.atom(false) as jotai.PrimitiveAtom<boolean>;
        this.terminal = new Terminal(options);
        this.fitAddon = new FitAddon();
        this.serializeAddon = new SerializeAddon();
        this.searchAddon = new SearchAddon();
        this.terminal.loadAddon(this.searchAddon);
        this.terminal.loadAddon(this.fitAddon);
        this.terminal.loadAddon(this.serializeAddon);
        this.terminal.loadAddon(
            new WebLinksAddon(
                (e, uri) => {
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
                },
                {
                    hover: (e, uri) => {
                        this.hoveredLinkUri = uri;
                        this.onLinkHover?.(uri, e.clientX, e.clientY);
                    },
                    leave: () => {
                        this.hoveredLinkUri = null;
                        this.onLinkHover?.(null, 0, 0);
                    },
                }
            )
        );
        this.setTermRenderer(WebGLSupported && waveOptions.useWebGl ? "webgl" : "dom");
        // Register OSC handlers
        this.terminal.parser.registerOscHandler(7, (data: string) => {
            try {
                return handleOsc7Command(data, this.blockId, this.loaded);
            } catch (e) {
                console.error("[termwrap] osc 7 handler error", this.blockId, e);
                return false;
            }
        });
        this.terminal.parser.registerOscHandler(52, (data: string) => {
            try {
                return handleOsc52Command(data, this.blockId, this.loaded, this);
            } catch (e) {
                console.error("[termwrap] osc 52 handler error", this.blockId, e);
                return false;
            }
        });
        this.terminal.parser.registerOscHandler(16162, (data: string) => {
            try {
                return handleOsc16162Command(data, this.blockId, this.loaded, this);
            } catch (e) {
                console.error("[termwrap] osc 16162 handler error", this.blockId, e);
                return false;
            }
        });
        this.toDispose.push(
            this.terminal.parser.registerCsiHandler({ final: "J" }, (params) => {
                if (params == null || params.length < 1) {
                    return false;
                }
                if (params[0] === 3) {
                    this.lastClearScrollbackTs = Date.now();
                    if (this.inSyncTransaction) {
                        console.log("[termwrap] repaint transaction starting");
                        this.inRepaintTransaction = true;
                    }
                }
                return false;
            })
        );
        this.toDispose.push(
            this.terminal.parser.registerCsiHandler({ prefix: "?", final: "h" }, (params) => {
                if (params == null || params.length < 1) {
                    return false;
                }
                if (params[0] === 2026) {
                    this.lastMode2026SetTs = Date.now();
                    this.inSyncTransaction = true;
                }
                return false;
            })
        );
        this.toDispose.push(
            this.terminal.parser.registerCsiHandler({ prefix: "?", final: "l" }, (params) => {
                if (params == null || params.length < 1) {
                    return false;
                }
                if (params[0] === 2026) {
                    this.lastMode2026ResetTs = Date.now();
                    this.inSyncTransaction = false;
                    const wasRepaint = this.inRepaintTransaction;
                    this.inRepaintTransaction = false;
                    if (wasRepaint && Date.now() - this.lastClearScrollbackTs <= MaxRepaintTransactionMs) {
                        setTimeout(() => {
                            console.log("[termwrap] repaint transaction complete, scrolling to bottom");
                            this.terminal.scrollToBottom();
                        }, 20);
                    }
                }
                return false;
            })
        );
        this.toDispose.push(
            this.terminal.onBell(() => {
                if (!this.loaded) {
                    return true;
                }
                console.log("BEL received in terminal", this.blockId);
                const bellSoundEnabled =
                    globalStore.get(getOverrideConfigAtom(this.blockId, "term:bellsound")) ?? false;
                if (bellSoundEnabled) {
                    fireAndForget(() => RpcApi.ElectronSystemBellCommand(TabRpcClient, { route: "electron" }));
                }
                const bellIndicatorEnabled =
                    globalStore.get(getOverrideConfigAtom(this.blockId, "term:bellindicator")) ?? false;
                if (bellIndicatorEnabled) {
                    setBadge(this.blockId, { icon: "bell", color: "#fbbf24", priority: 1 });
                }
                return true;
            })
        );
        this.terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
            if (!waveOptions.keydownHandler) {
                return true;
            }
            return waveOptions.keydownHandler(e);
        });
        this.connectElem = connectElem;
        this.mainFileSubject = null;
        this.heldData = [];
        this.handleResize_debounced = debounce(50, this.handleResize.bind(this));
        this.terminal.open(this.connectElem);

        const dragoverHandler = (e: DragEvent) => {
            e.preventDefault();
            if (e.dataTransfer) {
                e.dataTransfer.dropEffect = "copy";
            }
        };
        const dropHandler = (e: DragEvent) => {
            e.preventDefault();
            if (!e.dataTransfer || e.dataTransfer.files.length === 0) {
                return;
            }
            const paths: string[] = [];
            for (let i = 0; i < e.dataTransfer.files.length; i++) {
                const file = e.dataTransfer.files[i];
                const filePath = getApi().getPathForFile(file);
                if (filePath) {
                    paths.push(quoteForPosixShell(filePath));
                }
            }
            if (paths.length > 0) {
                this.terminal.paste(paths.join(" ") + " ");
            }
        };
        this.connectElem.addEventListener("dragover", dragoverHandler);
        this.connectElem.addEventListener("drop", dropHandler);
        this.toDispose.push({
            dispose: () => {
                this.connectElem.removeEventListener("dragover", dragoverHandler);
                this.connectElem.removeEventListener("drop", dropHandler);
            },
        });
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
        return this.blockId;
    }

    setCursorStyle(cursorStyle: string) {
        this.terminal.options.cursorStyle = normalizeCursorStyle(cursorStyle);
    }

    setCursorBlink(cursorBlink: boolean) {
        this.terminal.options.cursorBlink = cursorBlink ?? false;
    }

    setTermRenderer(renderer: "webgl" | "dom") {
        if (renderer === "webgl") {
            if (this.webglAddon != null) {
                return;
            }
            if (!WebGLSupported) {
                renderer = "dom";
            }
        } else {
            if (this.webglAddon == null) {
                return;
            }
        }
        if (this.webglAddon != null) {
            this.webglContextLossDisposable?.dispose();
            this.webglContextLossDisposable = null;
            this.webglAddon.dispose();
            this.webglAddon = null;
            globalStore.set(this.webglEnabledAtom, false);
        }
        if (renderer === "webgl") {
            const addon = new WebglAddon();
            this.webglContextLossDisposable = addon.onContextLoss(() => {
                this.setTermRenderer("dom");
            });
            this.terminal.loadAddon(addon);
            this.webglAddon = addon;
            globalStore.set(this.webglEnabledAtom, true);
            if (!loggedWebGL) {
                console.log("loaded webgl!");
                loggedWebGL = true;
            }
        }
    }

    getTermRenderer(): "webgl" | "dom" {
        return this.webglAddon != null ? "webgl" : "dom";
    }

    isWebGlEnabled(): boolean {
        return this.webglAddon != null;
    }

    async initTerminal() {
        const copyOnSelectAtom = getSettingsKeyAtom("term:copyonselect");
        this.toDispose.push(this.terminal.onData(this.handleTermData.bind(this)));
        this.toDispose.push(
            this.terminal.onSelectionChange(
                debounce(50, () => {
                    if (!globalStore.get(copyOnSelectAtom)) {
                        return;
                    }
                    // Don't copy-on-select when the search bar has focus — navigating
                    // search results changes the terminal selection programmatically.
                    const active = document.activeElement;
                    if (active != null && active.closest(".search-container") != null) {
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

        this.mainFileSubject = getFileSubject(this.getZoneId(), TermFileName);
        this.mainFileSubject.subscribe(this.handleNewFileSubjectData.bind(this));

        try {
            const rtInfo = await RpcApi.GetRTInfoCommand(TabRpcClient, {
                oref: WOS.makeORef("block", this.blockId),
            });
            let shellState: ShellIntegrationStatus = null;

            if (rtInfo && rtInfo["shell:integration"]) {
                shellState = rtInfo["shell:state"] as ShellIntegrationStatus;
                globalStore.set(this.shellIntegrationStatusAtom, shellState || null);
            } else {
                globalStore.set(this.shellIntegrationStatusAtom, null);
            }

            const lastCmd = rtInfo ? rtInfo["shell:lastcmd"] : null;
            const isCC = shellState === "running-command" && isClaudeCodeCommand(lastCmd);
            globalStore.set(this.lastCommandAtom, lastCmd || null);
            globalStore.set(this.claudeCodeActiveAtom, isCC);
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
            } catch (_) {
                /* nothing */
            }
        });
        this.promptMarkers = [];
        this.webglContextLossDisposable?.dispose();
        this.webglContextLossDisposable = null;
        this.terminal.dispose();
        this.toDispose.forEach((d) => {
            try {
                d.dispose();
            } catch (_) {
                /* nothing */
            }
        });
        this.mainFileSubject.release();
    }

    handleTermData(data: string) {
        if (!this.loaded) {
            return;
        }

        this.sendDataHandler?.(data);
        this.multiInputCallback?.(data);
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
        if (isDev() && this.loaded) {
            const dataStr = data instanceof Uint8Array ? new TextDecoder().decode(data) : data;
            this.recentWrites.push({ idx: this.recentWritesCounter++, ts: Date.now(), data: dataStr });
            if (this.recentWrites.length > 50) {
                this.recentWrites.shift();
            }
        }
        let resolve: () => void = null;
        const prtn = new Promise<void>((presolve, _) => {
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
        console.log(
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
            console.log(
                "[termwrap] resize",
                `${oldRows}x${oldCols}`,
                "->",
                `${this.terminal.rows}x${this.terminal.cols}`
            );
            RpcApi.ControllerInputCommand(TabRpcClient, { blockid: this.blockId, termsize: termSize });
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

    getScrollbackContent(): string {
        if (!this.terminal) {
            return "";
        }
        const buffer = this.terminal.buffer.active;
        const lines = bufferLinesToText(buffer, 0, buffer.length);
        return lines.join("\n");
    }
}
