// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    WOS,
    atoms,
    getBackendHostPort,
    getFileSubject,
    globalStore,
    sendWSCommand,
    useBlockAtom,
} from "@/store/global";
import * as services from "@/store/services";
import { base64ToArray } from "@/util/util";
import { FitAddon } from "@xterm/addon-fit";
import type { ITheme } from "@xterm/xterm";
import { Terminal } from "@xterm/xterm";
import clsx from "clsx";
import { produce } from "immer";
import * as jotai from "jotai";
import * as React from "react";
import { IJsonView } from "./ijson";

import "public/xterm.css";
import { debounce } from "throttle-debounce";
import "./term.less";

function getThemeFromCSSVars(el: Element): ITheme {
    const theme: ITheme = {};
    const elemStyle = getComputedStyle(el);
    theme.foreground = elemStyle.getPropertyValue("--term-foreground");
    theme.background = elemStyle.getPropertyValue("--term-background");
    theme.black = elemStyle.getPropertyValue("--term-black");
    theme.red = elemStyle.getPropertyValue("--term-red");
    theme.green = elemStyle.getPropertyValue("--term-green");
    theme.yellow = elemStyle.getPropertyValue("--term-yellow");
    theme.blue = elemStyle.getPropertyValue("--term-blue");
    theme.magenta = elemStyle.getPropertyValue("--term-magenta");
    theme.cyan = elemStyle.getPropertyValue("--term-cyan");
    theme.white = elemStyle.getPropertyValue("--term-white");
    theme.brightBlack = elemStyle.getPropertyValue("--term-bright-black");
    theme.brightRed = elemStyle.getPropertyValue("--term-bright-red");
    theme.brightGreen = elemStyle.getPropertyValue("--term-bright-green");
    theme.brightYellow = elemStyle.getPropertyValue("--term-bright-yellow");
    theme.brightBlue = elemStyle.getPropertyValue("--term-bright-blue");
    theme.brightMagenta = elemStyle.getPropertyValue("--term-bright-magenta");
    theme.brightCyan = elemStyle.getPropertyValue("--term-bright-cyan");
    theme.brightWhite = elemStyle.getPropertyValue("--term-bright-white");
    theme.selectionBackground = elemStyle.getPropertyValue("--term-selection-background");
    theme.selectionInactiveBackground = elemStyle.getPropertyValue("--term-selection-background");
    theme.cursor = elemStyle.getPropertyValue("--term-selection-background");
    theme.cursorAccent = elemStyle.getPropertyValue("--term-cursor-accent");
    return theme;
}

function handleResize(fitAddon: FitAddon, blockId: string, term: Terminal) {
    if (term == null) {
        return;
    }
    const oldRows = term.rows;
    const oldCols = term.cols;
    fitAddon.fit();
    if (oldRows !== term.rows || oldCols !== term.cols) {
        const wsCommand: SetBlockTermSizeWSCommand = {
            wscommand: "setblocktermsize",
            blockid: blockId,
            termsize: { rows: term.rows, cols: term.cols },
        };
        sendWSCommand(wsCommand);
    }
}

const keyMap = {
    Enter: "\r",
    Backspace: "\x7f",
    Tab: "\t",
    Escape: "\x1b",
    ArrowUp: "\x1b[A",
    ArrowDown: "\x1b[B",
    ArrowRight: "\x1b[C",
    ArrowLeft: "\x1b[D",
    Insert: "\x1b[2~",
    Delete: "\x1b[3~",
    Home: "\x1b[1~",
    End: "\x1b[4~",
    PageUp: "\x1b[5~",
    PageDown: "\x1b[6~",
};

function keyboardEventToASCII(event: React.KeyboardEvent<HTMLInputElement>): string {
    // check modifiers
    // if no modifiers are set, just send the key
    if (!event.altKey && !event.ctrlKey && !event.metaKey) {
        if (event.key == null || event.key == "") {
            return "";
        }
        if (keyMap[event.key] != null) {
            return keyMap[event.key];
        }
        if (event.key.length == 1) {
            return event.key;
        } else {
            console.log("not sending keyboard event", event.key, event);
        }
    }
    // if meta or alt is set, there is no ASCII representation
    if (event.metaKey || event.altKey) {
        return "";
    }
    // if ctrl is set, if it is a letter, subtract 64 from the uppercase value to get the ASCII value
    if (event.ctrlKey) {
        if (
            (event.key.length === 1 && event.key >= "A" && event.key <= "Z") ||
            (event.key >= "a" && event.key <= "z")
        ) {
            const key = event.key.toUpperCase();
            return String.fromCharCode(key.charCodeAt(0) - 64);
        }
    }
    return "";
}

type InitialLoadDataType = {
    loaded: boolean;
    heldData: Uint8Array[];
};

const IJSONConst = {
    tag: "div",
    children: [
        {
            tag: "h1",
            children: ["Hello World"],
        },
        {
            tag: "p",
            children: ["This is a paragraph"],
        },
    ],
};

function setBlockFocus(blockId: string) {
    let winData = globalStore.get(atoms.waveWindow);
    winData = produce(winData, (draft) => {
        draft.activeblockid = blockId;
    });
    WOS.setObjectValue(winData, globalStore.set, true);
}

const TerminalView = ({ blockId }: { blockId: string }) => {
    const connectElemRef = React.useRef<HTMLDivElement>(null);
    const termRef = React.useRef<Terminal>(null);
    const initialLoadRef = React.useRef<InitialLoadDataType>({ loaded: false, heldData: [] });
    const htmlElemFocusRef = React.useRef<HTMLInputElement>(null);
    const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", blockId));
    const isFocusedAtom = useBlockAtom<boolean>(blockId, "isFocused", () => {
        return jotai.atom((get) => {
            const winData = get(atoms.waveWindow);
            return winData.activeblockid === blockId;
        });
    });
    const isFocused = jotai.useAtomValue(isFocusedAtom);
    React.useEffect(() => {
        console.log("terminal created");
        const newTerm = new Terminal({
            theme: getThemeFromCSSVars(connectElemRef.current),
            fontSize: 12,
            fontFamily: "Hack",
            drawBoldTextInBrightColors: false,
            fontWeight: "normal",
            fontWeightBold: "bold",
        });
        termRef.current = newTerm;
        const newFitAddon = new FitAddon();
        newTerm.loadAddon(newFitAddon);
        newTerm.open(connectElemRef.current);
        newFitAddon.fit();
        sendWSCommand({
            wscommand: "setblocktermsize",
            blockid: blockId,
            termsize: { rows: newTerm.rows, cols: newTerm.cols },
        });
        connectElemRef.current.addEventListener(
            "keydown",
            (ev) => {
                if (ev.code == "Escape" && ev.metaKey) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    const metaCmd: BlockSetMetaCommand = { command: "setmeta", meta: { "term:mode": "html" } };
                    services.BlockService.SendCommand(blockId, metaCmd);
                    return false;
                }
            },
            true
        );
        newTerm.onData((data) => {
            const b64data = btoa(data);
            const inputCmd: BlockInputCommand = { command: "controller:input", inputdata64: b64data };
            services.BlockService.SendCommand(blockId, inputCmd);
        });
        newTerm.textarea.addEventListener("focus", () => {
            setBlockFocus(blockId);
        });
        const mainFileSubject = getFileSubject(blockId, "main");
        mainFileSubject.subscribe((msg: WSFileEventData) => {
            if (msg.fileop != "append") {
                console.log("bad fileop for terminal", msg);
                return;
            }
            const decodedData = base64ToArray(msg.data64);
            if (initialLoadRef.current.loaded) {
                newTerm.write(decodedData);
            } else {
                initialLoadRef.current.heldData.push(decodedData);
            }
        });
        // load data from filestore
        const startTs = Date.now();
        let loadedBytes = 0;
        const localTerm = termRef.current; // avoids devmode double effect running issue (terminal gets created twice)
        const usp = new URLSearchParams();
        usp.set("zoneid", blockId);
        usp.set("name", "main");
        fetch(getBackendHostPort() + "/wave/file?" + usp.toString())
            .then((resp) => {
                if (resp.ok) {
                    return resp.arrayBuffer();
                }
                console.log("error loading file", resp.status, resp.statusText);
            })
            .then((data: ArrayBuffer) => {
                const uint8View = new Uint8Array(data);
                localTerm.write(uint8View);
                loadedBytes = uint8View.byteLength;
            })
            .finally(() => {
                initialLoadRef.current.heldData.forEach((data) => {
                    localTerm.write(data);
                });
                initialLoadRef.current.loaded = true;
                initialLoadRef.current.heldData = [];
                console.log(`terminal loaded file ${loadedBytes} bytes, ${Date.now() - startTs}ms`);
            });

        const resize_debounced = debounce(50, () => {
            handleResize(newFitAddon, blockId, newTerm);
        });
        const rszObs = new ResizeObserver(() => {
            resize_debounced();
        });
        rszObs.observe(connectElemRef.current);

        return () => {
            newTerm.dispose();
            mainFileSubject.release();
        };
    }, []);

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.code === "Escape" && event.metaKey) {
            // reset term:mode
            const metaCmd: BlockSetMetaCommand = { command: "setmeta", meta: { "term:mode": null } };
            services.BlockService.SendCommand(blockId, metaCmd);
            return false;
        }
        const asciiVal = keyboardEventToASCII(event);
        if (asciiVal.length == 0) {
            return false;
        }
        const b64data = btoa(asciiVal);
        const inputCmd: BlockInputCommand = { command: "controller:input", inputdata64: b64data };
        services.BlockService.SendCommand(blockId, inputCmd);
        return true;
    };

    let termMode = blockData?.meta?.["term:mode"] ?? "term";
    if (termMode != "term" && termMode != "html") {
        termMode = "term";
    }

    React.useEffect(() => {
        if (isFocused && termMode == "term") {
            termRef.current?.focus();
        }
        if (isFocused && termMode == "html") {
            htmlElemFocusRef.current?.focus();
        }
    });

    return (
        <div className={clsx("view-term", "term-mode-" + termMode, isFocused ? "is-focused" : null)}>
            <div key="conntectElem" className="term-connectelem" ref={connectElemRef}></div>
            <div
                key="htmlElem"
                className="term-htmlelem"
                onClick={() => {
                    if (htmlElemFocusRef.current != null) {
                        htmlElemFocusRef.current.focus();
                    }
                    setBlockFocus(blockId);
                }}
            >
                <div key="htmlElemFocus" className="term-htmlelem-focus">
                    <input
                        type="text"
                        value={""}
                        ref={htmlElemFocusRef}
                        onKeyDown={handleKeyDown}
                        onChange={() => {}}
                    />
                </div>
                <div key="htmlElemContent" className="term-htmlelem-content">
                    <IJsonView rootNode={IJSONConst} />
                </div>
            </div>
        </div>
    );
};

export { TerminalView };
