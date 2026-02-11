// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { BlockNodeModel } from "@/app/block/blocktypes";
import { getFileSubject } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import {
    atoms,
    fetchWaveFile,
    getOverrideConfigAtom,
    getSettingsKeyAtom,
    globalStore,
    openLink,
    setTabIndicator,
    WOS,
} from "@/store/global";
import * as services from "@/store/services";
import { PLATFORM, PlatformMacOS } from "@/util/platformutil";
import { base64ToArray, fireAndForget } from "@/util/util";
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
import {
    handleOsc16162Command,
    handleOsc52Command,
    handleOsc7Command,
    type ShellIntegrationStatus,
} from "./osc-handlers";
import { FilePathLinkProvider } from "./term-link-provider";
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
    private toDispose: TermTypes.IDisposable[] = [];
    pasteActive: boolean = false;
    lastUpdated: number;
    promptMarkers: TermTypes.IMarker[] = [];
    shellIntegrationStatusAtom: jotai.PrimitiveAtom<ShellIntegrationStatus | null>;
    lastCommandAtom: jotai.PrimitiveAtom<string | null>;
    nodeModel: BlockNodeModel; // this can be null

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
        this.sendDataHandler = waveOptions.sendDataHandler;
        this.nodeModel = waveOptions.nodeModel;
        this.ptyOffset = 0;
        this.dataBytesProcessed = 0;
        this.hasResized = false;
        this.lastUpdated = Date.now();
        this.promptMarkers = [];
        this.shellIntegrationStatusAtom = jotai.atom(null) as jotai.PrimitiveAtom<ShellIntegrationStatus | null>;
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
        // Register OSC handlers
        this.terminal.parser.registerOscHandler(7, (data: string) => {
            return handleOsc7Command(data, this.blockId, this.loaded);
        });
        this.terminal.parser.registerOscHandler(52, (data: string) => {
            return handleOsc52Command(data, this.blockId, this.loaded, this);
        });
        this.terminal.parser.registerOscHandler(16162, (data: string) => {
            return handleOsc16162Command(data, this.blockId, this.loaded, this);
        });
        this.terminal.registerLinkProvider(new FilePathLinkProvider(this.terminal, this.blockId));
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
                    const tabId = globalStore.get(atoms.staticTabId);
                    setTabIndicator(tabId, { icon: "bell", color: "#fbbf24", clearonfocus: true, priority: 1 });
                }
                return true;
            })
        );
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

    getZoneId(): string {
        return this.blockId;
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
                globalStore.set(this.shellIntegrationStatusAtom, shellState || null);
            } else {
                globalStore.set(this.shellIntegrationStatusAtom, null);
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
}
