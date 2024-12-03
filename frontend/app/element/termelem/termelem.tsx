// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { PLATFORM } from "@/store/global";
import { useAtomValueSafe } from "@/util/util";
import { SerializeAddon } from "@xterm/addon-serialize";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import * as TermTypes from "@xterm/xterm";
import { Terminal } from "@xterm/xterm";
import { Atom } from "jotai";
import { useEffect, useRef } from "react";
import { debounce } from "throttle-debounce";
import { FitAddon } from "./fitaddon";

const MinDataProcessedForCache = 100 * 1024;

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

export type TermWrapOptions = {
    xtermOpts: TermTypes.ITerminalOptions & TermTypes.ITerminalInitOnlyOptions;
    keydownHandler?: (e: KeyboardEvent) => boolean;
    useWebGl?: boolean;
    useWebLinksAddon?: boolean;
    useSerializeAddon?: boolean;
    termTheme: Atom<TermTypes.ITheme>;
    onOpenLink?: (uri: string) => void;
    onCwdChange?: (newCwd: string) => void;
    handleInputData?: (data: string) => void;
    resyncController?: (reason: string) => void;
    onResize?: (termSize: TermSize) => void;
    onSelectionChange?: (selectedText: string) => void;
    onFocus?: () => void;
    onMount?: () => void;
    onDispose?: () => void;
};

export class TermWrap {
    ptyOffset: number;
    dataBytesProcessed: number;
    terminal: Terminal;
    connectElem?: HTMLDivElement;
    fitAddon: FitAddon;
    serializeAddon?: SerializeAddon;
    handleResize_debounced: () => void;
    hasResized: boolean;
    termOpts: TermWrapOptions;

    constructor(waveOptions: TermWrapOptions) {
        this.termOpts = waveOptions;
        this.ptyOffset = 0;
        this.dataBytesProcessed = 0;
        this.hasResized = false;
        this.terminal = new Terminal(this.termOpts.xtermOpts);
        this.fitAddon = new FitAddon();
        this.fitAddon.noScrollbar = PLATFORM == "darwin";
        this.terminal.loadAddon(this.fitAddon);
        if (this.termOpts.useSerializeAddon) {
            this.serializeAddon = new SerializeAddon();
            this.terminal.loadAddon(this.serializeAddon);
        }
        if (this.termOpts.useWebLinksAddon && this.termOpts.onOpenLink) {
            this.terminal.loadAddon(
                new WebLinksAddon((e, uri) => {
                    e.preventDefault();
                    switch (PLATFORM) {
                        case "darwin":
                            if (e.metaKey) {
                                this.termOpts.onOpenLink?.(uri);
                            }
                            break;
                        default:
                            if (e.ctrlKey) {
                                this.termOpts.onOpenLink?.(uri);
                            }
                            break;
                    }
                })
            );
        }
        if (WebGLSupported && this.termOpts.useWebGl) {
            const webglAddon = new WebglAddon();
            webglAddon.onContextLoss(() => {
                webglAddon.dispose();
            });
            this.terminal.loadAddon(webglAddon);
            if (!loggedWebGL) {
                console.log("loaded webgl!");
                loggedWebGL = true;
            }
        }
        this.terminal.parser.registerOscHandler(7, (data: string) => {
            if (data == null || data.length == 0) {
                return false;
            }
            if (data.startsWith("file://")) {
                data = data.substring(7);
                const nextSlashIdx = data.indexOf("/");
                if (nextSlashIdx == -1) {
                    return false;
                }
                data = data.substring(nextSlashIdx);
            }
            setTimeout(() => {
                this.termOpts?.onCwdChange?.(data);
            }, 0);
            return true;
        });
        this.handleResize_debounced = debounce(50, this.handleResize.bind(this));
        if (this.termOpts.keydownHandler != null) {
            this.terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
                return this.termOpts.keydownHandler?.(e);
            });
        }
        if (this.termOpts.onFocus != null) {
            this.terminal.textarea.addEventListener("focus", () => {
                this.termOpts.onFocus?.();
            });
        }
    }

    async initTerminal(connectElem: HTMLDivElement) {
        this.connectElem = connectElem;
        this.terminal.open(this.connectElem);
        this.handleResize();
        this.terminal.onData(this.handleTermData.bind(this));
        this.terminal.onSelectionChange(() => {
            const selectedText = this.terminal.getSelection();
            this.termOpts.onSelectionChange?.(selectedText);
        });
        this.termOpts.onMount?.();
    }

    dispose() {
        this.termOpts.onDispose?.();
        this.terminal.dispose();
    }

    handleTermData(data: string) {
        this.termOpts.handleInputData?.(data);
    }

    addFocusListener(focusFn: () => void) {
        this.terminal.textarea.addEventListener("focus", focusFn);
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
            resolve();
        });
        return prtn;
    }

    resizeTerminal(termSize: TermSize) {
        this.terminal.resize(termSize.cols, termSize.rows);
    }

    resyncController(reason: string) {
        this.termOpts.resyncController?.(reason);
    }

    handleResize() {
        const oldRows = this.terminal.rows;
        const oldCols = this.terminal.cols;
        this.fitAddon.fit();
        if (oldRows !== this.terminal.rows || oldCols !== this.terminal.cols) {
            const termSize: TermSize = { rows: this.terminal.rows, cols: this.terminal.cols };
            this.termOpts.onResize?.(termSize);
        }
        if (!this.hasResized) {
            this.hasResized = true;
            this.resyncController("initial resize");
        }
    }

    getDataBytesProcessed(): number {
        return this.dataBytesProcessed;
    }

    getTerminalCacheData(): { data: string; ptyOffset: number; termSize: TermSize } {
        if (this.serializeAddon == null) {
            return null;
        }
        const serializedOutput = this.serializeAddon.serialize();
        const termSize: TermSize = { rows: this.terminal.rows, cols: this.terminal.cols };
        return { data: serializedOutput, ptyOffset: this.ptyOffset, termSize };
    }
}

export const TermElem = (props: { termOpts: TermWrapOptions }) => {
    const connectElemRef = useRef<HTMLDivElement>(null);
    const termWrapRef = useRef<TermWrap>(null);
    const termTheme = useAtomValueSafe(props.termOpts.termTheme);
    useEffect(() => {
        if (termWrapRef.current == null || termTheme == null) {
            return;
        }
        termWrapRef.current.terminal.options.theme = termTheme;
    }, [termTheme]);
    useEffect(() => {
        termWrapRef.current = new TermWrap(props.termOpts);
        if (termTheme != null) {
            termWrapRef.current.terminal.options.theme = termTheme;
        }
        termWrapRef.current.initTerminal(connectElemRef.current);
        return () => {
            termWrapRef.current.dispose();
        };
    }, []);
    return <div key="conntectElem" className="term-connectelem" ref={connectElemRef}></div>;
};
