// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { BlockNodeModel } from "@/app/block/blocktypes";
import { setBadge } from "@/app/store/badge";
import { getFileSubject } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import {
    getApi,
    getOverrideConfigAtom,
    getSettingsKeyAtom,
    globalStore,
    isDev,
    openLink,
    WOS,
} from "@/store/global";
import { PLATFORM, PlatformMacOS } from "@/util/platformutil";
import { base64ToArray, fireAndForget } from "@/util/util";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
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
    getWheelLineDelta,
    normalizeCursorStyle,
    quoteForPosixShell,
    trimTerminalSelection,
} from "./termutil";

const dlog = debug("wave:termwrap");

const TermFileName = "term";
export const SupportsImageInput = true;
const MaxRepaintTransactionMs = 2000;
const AgentImeCommandRegex = /^(codex|claude|opencode|aider|gemini|qwen)\b/i;
const AgentImeVisibleRegex = /\b(OpenAI Codex|Codex|Claude Code|opencode|gpt-\d|tokens left|esc to interrupt)\b/i;
const ShellPromptTailRegex = /^(?:PS [^\n>]+>|[A-Za-z]:\\[^>\n]*>|(?:\([^)]+\)\s*)?[\w.@-]+(?::[~./\w-]+)?[$#%>])\s*$/;

function normalizeAgentCommand(command: string | null | undefined): string {
    if (!command) {
        return "";
    }
    let normalized = command.trim();
    normalized = normalized.replace(/^env\s+/, "");
    normalized = normalized.replace(/^(?:\w+=(?:"[^"]*"|'[^']*'|\S+)\s+)*/, "");
    return normalized;
}

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
    terminal: Terminal;
    connectElem: HTMLDivElement;
    fitAddon: FitAddon;
    searchAddon: SearchAddon;
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
    disposed: boolean = false;
    imePositionPatched: boolean = false;
    imePositionSyncScheduled: boolean = false;
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
    wheelScrollRemainder: number = 0;

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
        this.hasResized = false;
        this.lastUpdated = Date.now();
        this.promptMarkers = [];
        this.shellIntegrationStatusAtom = jotai.atom(null) as jotai.PrimitiveAtom<ShellIntegrationStatus | null>;
        this.lastCommandAtom = jotai.atom(null) as jotai.PrimitiveAtom<string | null>;
        this.claudeCodeActiveAtom = jotai.atom(false);
        this.webglEnabledAtom = jotai.atom(false) as jotai.PrimitiveAtom<boolean>;
        this.terminal = new Terminal(options);
        this.fitAddon = new FitAddon();
        this.searchAddon = new SearchAddon();
        this.terminal.loadAddon(this.searchAddon);
        this.terminal.loadAddon(this.fitAddon);
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
        this.installNormalBufferWheelScrollback();
        this.handleResize();
        this.scheduleDeferredResize();
        this.installImePositionFix();
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

    installNormalBufferWheelScrollback() {
        const wheelHandler = (event: WheelEvent) => {
            if (event.defaultPrevented || this.terminal.buffer.active.type !== "normal") {
                this.wheelScrollRemainder = 0;
                return;
            }
            const cellHeight = (this.terminal as any)?._core?._renderService?.dimensions?.css?.cell?.height ?? 16;
            const lineDelta = getWheelLineDelta(event.deltaY, event.deltaMode, cellHeight, this.terminal.rows);
            if (lineDelta === 0) {
                return;
            }
            this.wheelScrollRemainder += lineDelta;
            const wholeLines =
                this.wheelScrollRemainder > 0
                    ? Math.floor(this.wheelScrollRemainder)
                    : Math.ceil(this.wheelScrollRemainder);
            if (wholeLines === 0) {
                return;
            }
            this.wheelScrollRemainder -= wholeLines;
            this.terminal.scrollLines(wholeLines);
            event.preventDefault();
            event.stopPropagation();
        };
        this.connectElem.addEventListener("wheel", wheelHandler, { passive: false });
        this.toDispose.push({
            dispose: () => {
                this.connectElem.removeEventListener("wheel", wheelHandler, false);
            },
        });
    }

    scheduleDeferredResize(forceTermSizeSync = false) {
        const resize = () => {
            if (!this.disposed) {
                this.handleResize(forceTermSizeSync);
            }
        };
        setTimeout(resize, 0);
        setTimeout(resize, 50);
        setTimeout(resize, 250);
    }

    shouldAnchorImeForAgentTui(): boolean {
        const shellState = globalStore.get(this.shellIntegrationStatusAtom);
        if (shellState === "ready") {
            return false;
        }
        const lastCommand = normalizeAgentCommand(globalStore.get(this.lastCommandAtom));
        if (shellState === "running-command" && AgentImeCommandRegex.test(lastCommand)) {
            return true;
        }
        const activeBuffer = this.terminal.buffer.active;
        const tailStart = Math.max(0, activeBuffer.length - Math.max(this.terminal.rows * 2, 80));
        const tailText = bufferLinesToText(activeBuffer, tailStart, activeBuffer.length).join("\n");
        const lastVisibleLine = tailText
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .at(-1);
        if (lastVisibleLine != null && ShellPromptTailRegex.test(lastVisibleLine)) {
            return false;
        }
        return AgentImeVisibleRegex.test(tailText);
    }

    clearImePositionOverrides() {
        if (!this.imePositionPatched) {
            return;
        }
        const textarea = this.terminal.textarea;
        const compositionView = this.connectElem.querySelector<HTMLElement>(".composition-view.active");
        if (textarea != null) {
            textarea.style.removeProperty("top");
            textarea.style.removeProperty("left");
            textarea.style.removeProperty("width");
            textarea.style.removeProperty("height");
            textarea.style.removeProperty("line-height");
            textarea.style.removeProperty("z-index");
        }
        if (compositionView != null) {
            compositionView.style.removeProperty("top");
            compositionView.style.removeProperty("left");
            compositionView.style.removeProperty("height");
            compositionView.style.removeProperty("line-height");
            compositionView.style.removeProperty("z-index");
        }
        this.imePositionPatched = false;
    }

    syncImePositionForAgentTui() {
        if (!this.shouldAnchorImeForAgentTui()) {
            this.clearImePositionOverrides();
            return;
        }
        const textarea = this.terminal.textarea;
        const compositionView = this.connectElem.querySelector<HTMLElement>(".composition-view.active");
        if (textarea == null) {
            return;
        }
        const cellHeight = (this.terminal as any)?._core?._renderService?.dimensions?.css?.cell?.height ?? 16;
        const cellWidth = (this.terminal as any)?._core?._renderService?.dimensions?.css?.cell?.width ?? 8;
        const activeBuffer = this.terminal.buffer.active;
        const cursorRow = Math.max(0, Math.min(this.terminal.rows - 1, activeBuffer.cursorY ?? 0));
        const cursorCol = Math.max(0, Math.min(this.terminal.cols - 1, activeBuffer.cursorX ?? 0));
        const top = `${cursorRow * cellHeight}px`;
        const left = `${cursorCol * cellWidth}px`;
        const lineHeight = `${Math.max(1, cellHeight)}px`;
        if (compositionView != null) {
            compositionView.style.top = top;
            compositionView.style.left = left;
            compositionView.style.height = lineHeight;
            compositionView.style.lineHeight = lineHeight;
            compositionView.style.zIndex = "6";
        }
        const compositionWidth = Math.max(compositionView?.getBoundingClientRect().width ?? 0, cellWidth * 2, 1);
        textarea.style.top = top;
        textarea.style.left = left;
        textarea.style.width = `${compositionWidth}px`;
        textarea.style.height = lineHeight;
        textarea.style.lineHeight = lineHeight;
        textarea.style.zIndex = "5";
        this.imePositionPatched = true;
    }

    scheduleImePositionSync() {
        this.syncImePositionForAgentTui();
        if (this.imePositionSyncScheduled) {
            return;
        }
        this.imePositionSyncScheduled = true;
        setTimeout(() => {
            if (!this.disposed) {
                this.syncImePositionForAgentTui();
            }
        }, 0);
        setTimeout(() => {
            if (!this.disposed) {
                this.syncImePositionForAgentTui();
            }
        }, 16);
        setTimeout(() => {
            if (!this.disposed) {
                this.syncImePositionForAgentTui();
            }
            this.imePositionSyncScheduled = false;
        }, 100);
    }

    installImePositionFix() {
        const textarea = this.terminal.textarea;
        if (textarea == null) {
            return;
        }
        const sync = () => this.scheduleImePositionSync();
        const clear = () => this.clearImePositionOverrides();
        for (const eventName of ["focus", "compositionstart", "compositionupdate"]) {
            textarea.addEventListener(eventName, sync);
        }
        textarea.addEventListener("blur", clear);
        this.toDispose.push({
            dispose: () => {
                for (const eventName of ["focus", "compositionstart", "compositionupdate"]) {
                    textarea.removeEventListener(eventName, sync);
                }
                textarea.removeEventListener("blur", clear);
                this.clearImePositionOverrides();
            },
        });
        this.toDispose.push(
            this.terminal.onRender(() => {
                const compositionView = this.connectElem.querySelector<HTMLElement>(".composition-view.active");
                const shouldAnchorIme = this.shouldAnchorImeForAgentTui();
                if (shouldAnchorIme || document.activeElement === textarea || compositionView != null) {
                    this.scheduleImePositionSync();
                } else {
                    this.clearImePositionOverrides();
                }
            })
        );
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
        const trimTrailingWhitespaceAtom = getSettingsKeyAtom("term:trimtrailingwhitespace");
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
                    let selectedText = this.terminal.getSelection();
                    if (selectedText.length > 0) {
                        if (globalStore.get(trimTrailingWhitespaceAtom) !== false) {
                            selectedText = trimTerminalSelection(selectedText);
                        }
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

        this.loaded = true;
        await this.flushHeldTerminalData();
        this.scheduleDeferredResize(true);
        this.scheduleImePositionSync();
    }

    dispose() {
        this.disposed = true;
        this.clearImePositionOverrides();
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
                this.doTerminalWrite(decodedData);
            } else {
                this.heldData.push(decodedData);
            }
        } else {
            console.log("bad fileop for terminal", msg);
            return;
        }
    }

    async flushHeldTerminalData(): Promise<void> {
        if (this.heldData.length === 0) {
            return;
        }
        const pendingData = this.heldData;
        this.heldData = [];
        for (const data of pendingData) {
            await this.doTerminalWrite(data);
        }
    }

    doTerminalWrite(data: string | Uint8Array): Promise<void> {
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
            this.lastUpdated = Date.now();
            resolve();
            if (document.activeElement === this.terminal.textarea || this.imePositionPatched) {
                this.scheduleImePositionSync();
            }
        });
        return prtn;
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

    syncControllerTermSize(reason: string) {
        const termSize: TermSize = { rows: this.terminal.rows, cols: this.terminal.cols };
        if (termSize.rows <= 0 || termSize.cols <= 0) {
            return;
        }
        dlog("termsize sync", reason, `${termSize.rows}x${termSize.cols}`);
        fireAndForget(async () => {
            try {
                await RpcApi.ControllerInputCommand(TabRpcClient, { blockid: this.blockId, termsize: termSize });
            } catch (e) {
                console.warn("failed to sync terminal size", this.blockId, reason, e);
            }
        });
    }

    handleResize(forceTermSizeSync = false) {
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
            this.syncControllerTermSize("resize");
        } else if (forceTermSizeSync) {
            this.syncControllerTermSize("forced resize sync");
        }
        dlog("resize", `${this.terminal.rows}x${this.terminal.cols}`, `${oldRows}x${oldCols}`, this.hasResized);
        if (!this.hasResized) {
            this.hasResized = true;
            this.resyncController("initial resize");
        }
        this.scheduleImePositionSync();
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
