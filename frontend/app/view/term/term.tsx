// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WOS, atoms, getEventORefSubject, globalStore, useBlockAtom, useSettingsAtom } from "@/store/global";
import * as services from "@/store/services";
import * as keyutil from "@/util/keyutil";
import type { ITheme } from "@xterm/xterm";
import clsx from "clsx";
import { produce } from "immer";
import * as jotai from "jotai";
import * as React from "react";
import { IJsonView } from "./ijson";
import { TermStickers } from "./termsticker";
import { TermWrap } from "./termwrap";

import { WshServer } from "@/app/store/wshserver";
import "public/xterm.css";
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
    if (winData == null) {
        return;
    }
    winData = produce(winData, (draft) => {
        draft.activeblockid = blockId;
    });
    WOS.setObjectValue(winData, globalStore.set, true);
}

const TerminalView = ({ blockId }: { blockId: string }) => {
    const connectElemRef = React.useRef<HTMLDivElement>(null);
    const termRef = React.useRef<TermWrap>(null);
    const shellProcStatusRef = React.useRef<string>(null);
    const blockIconOverrideAtom = useBlockAtom<string>(blockId, "blockicon:override", () => {
        return jotai.atom<string>(null);
    }) as jotai.PrimitiveAtom<string>;
    const htmlElemFocusRef = React.useRef<HTMLInputElement>(null);
    const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", blockId));
    const isFocusedAtom = useBlockAtom<boolean>(blockId, "isFocused", () => {
        return jotai.atom((get) => {
            const winData = get(atoms.waveWindow);
            return winData?.activeblockid === blockId;
        });
    });
    const termSettingsAtom = useSettingsAtom<TerminalConfigType>("term", (settings: SettingsConfigType) => {
        return settings?.term;
    });
    const termSettings = jotai.useAtomValue(termSettingsAtom);
    const isFocused = jotai.useAtomValue(isFocusedAtom);
    React.useEffect(() => {
        function handleTerminalKeydown(event: KeyboardEvent) {
            const waveEvent = keyutil.adaptFromReactOrNativeKeyEvent(event);
            if (keyutil.checkKeyPressed(waveEvent, "Cmd:Escape")) {
                event.preventDefault();
                event.stopPropagation();
                WshServer.SetMetaCommand({ oref: WOS.makeORef("block", blockId), meta: { "term:mode": null } });
                return false;
            }
            if (shellProcStatusRef.current != "running" && keyutil.checkKeyPressed(waveEvent, "Enter")) {
                // restart
                WshServer.BlockRestartCommand({ blockid: blockId });
                return false;
            }
        }

        const termWrap = new TermWrap(
            blockId,
            connectElemRef.current,
            {
                theme: getThemeFromCSSVars(connectElemRef.current),
                fontSize: termSettings?.fontsize ?? 12,
                fontFamily: termSettings?.fontfamily ?? "Hack",
                drawBoldTextInBrightColors: false,
                fontWeight: "normal",
                fontWeightBold: "bold",
            },
            {
                keydownHandler: handleTerminalKeydown,
            }
        );
        (window as any).term = termWrap;
        termRef.current = termWrap;
        termWrap.addFocusListener(() => {
            setBlockFocus(blockId);
        });
        const rszObs = new ResizeObserver(() => {
            termWrap.handleResize_debounced();
        });
        rszObs.observe(connectElemRef.current);
        termWrap.initTerminal();
        return () => {
            termWrap.dispose();
            rszObs.disconnect();
        };
    }, []);

    const handleHtmlKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        const waveEvent = keyutil.adaptFromReactOrNativeKeyEvent(event);
        if (keyutil.checkKeyPressed(waveEvent, "Cmd:Escape")) {
            // reset term:mode
            WshServer.SetMetaCommand({ oref: WOS.makeORef("block", blockId), meta: { "term:mode": null } });
            return false;
        }
        const asciiVal = keyboardEventToASCII(event);
        if (asciiVal.length == 0) {
            return false;
        }
        const b64data = btoa(asciiVal);
        WshServer.BlockInputCommand({ blockid: blockId, inputdata64: b64data });
        return true;
    };

    let termMode = blockData?.meta?.["term:mode"] ?? "term";
    if (termMode != "term" && termMode != "html") {
        termMode = "term";
    }

    // set initial focus
    React.useEffect(() => {
        if (isFocused && termMode == "term") {
            termRef.current?.terminal.focus();
        }
        if (isFocused && termMode == "html") {
            htmlElemFocusRef.current?.focus();
        }
    }, []);

    // set intitial controller status, and then subscribe for updates
    React.useEffect(() => {
        function updateShellProcStatus(status: string) {
            if (status == null) {
                return;
            }
            shellProcStatusRef.current = status;
            if (status == "running") {
                termRef.current?.setIsRunning(true);
                globalStore.set(blockIconOverrideAtom, "terminal");
            } else {
                termRef.current?.setIsRunning(false);
                globalStore.set(blockIconOverrideAtom, "regular@terminal");
            }
        }
        const initialRTStatus = services.BlockService.GetControllerStatus(blockId);
        initialRTStatus.then((rts) => {
            updateShellProcStatus(rts?.shellprocstatus);
        });
        const bcSubject = getEventORefSubject("blockcontroller:status", WOS.makeORef("block", blockId));
        const sub = bcSubject.subscribe((data: WSEventType) => {
            let bcRTS: BlockControllerRuntimeStatus = data.data;
            updateShellProcStatus(bcRTS?.shellprocstatus);
        });
        return () => sub.unsubscribe();
    }, []);

    let stickerConfig = {
        charWidth: 8,
        charHeight: 16,
        rows: termRef.current?.terminal.rows ?? 24,
        cols: termRef.current?.terminal.cols ?? 80,
        blockId: blockId,
    };

    function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
        const waveEvent = keyutil.adaptFromReactOrNativeKeyEvent(e);
        if (keyutil.checkKeyPressed(waveEvent, "Cmd:Shift:v")) {
            const p = navigator.clipboard.readText();
            p.then((text) => {
                termRef.current?.handleTermData(text);
            });
            e.preventDefault();
            e.stopPropagation();
            return true;
        } else if (keyutil.checkKeyPressed(waveEvent, "Cmd:Shift:c")) {
            const sel = termRef.current?.terminal.getSelection();
            navigator.clipboard.writeText(sel);
            e.preventDefault();
            e.stopPropagation();
            return true;
        }
    }

    return (
        <div
            className={clsx("view-term", "term-mode-" + termMode, isFocused ? "is-focused" : null)}
            onKeyDown={handleKeyDown}
        >
            <TermStickers config={stickerConfig} />
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
                        onKeyDown={handleHtmlKeyDown}
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