// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WshServer } from "@/app/store/wshserver";
import { VDomView } from "@/app/view/term/vdom";
import { WOS, atoms, getEventORefSubject, globalStore, useBlockAtom, useSettingsAtom } from "@/store/global";
import * as services from "@/store/services";
import * as keyutil from "@/util/keyutil";
import * as util from "@/util/util";
import clsx from "clsx";
import { produce } from "immer";
import * as jotai from "jotai";
import * as React from "react";
import { TermStickers } from "./termsticker";
import { TermThemeUpdater } from "./termtheme";
import { TermWrap } from "./termwrap";

import "public/xterm.css";

function computeTheme(settings: SettingsConfigType, themeName: string) {
    let defaultThemeName = "default-dark";
    themeName = themeName ?? "default-dark";
    const defaultTheme: TermThemeType = settings?.termthemes?.[defaultThemeName] || ({} as any);
    const theme: TermThemeType = settings?.termthemes?.[themeName] || ({} as any);
    const combinedTheme = { ...defaultTheme };
    for (const key in theme) {
        if (!util.isBlank(theme[key])) {
            combinedTheme[key] = theme[key];
        }
    }
    return combinedTheme;
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

function vdomText(text: string): VDomElem {
    return {
        tag: "#text",
        text: text,
    };
}

const testVDom: VDomElem = {
    id: "testid1",
    tag: "div",
    children: [
        {
            id: "testh1",
            tag: "h1",
            children: [vdomText("Hello World")],
        },
        {
            id: "testp",
            tag: "p",
            children: [vdomText("This is a paragraph (from VDOM)")],
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

class TermViewModel {
    termRef: React.RefObject<TermWrap>;
    blockAtom: jotai.Atom<Block>;
    termMode: jotai.Atom<string>;
    htmlElemFocusRef: React.RefObject<HTMLInputElement>;
    blockId: string;

    constructor(blockId: string) {
        this.blockId = blockId;
        this.blockAtom = WOS.getWaveObjectAtom<Block>(`block:${blockId}`);
        this.termMode = jotai.atom((get) => {
            const blockData = get(this.blockAtom);
            return blockData?.meta?.["term:mode"] ?? "term";
        });
    }

    giveFocus(): boolean {
        let termMode = globalStore.get(this.termMode);
        if (termMode == "term") {
            if (this.termRef?.current?.terminal) {
                this.termRef.current.terminal.focus();
                return true;
            }
        } else {
            if (this.htmlElemFocusRef?.current) {
                this.htmlElemFocusRef.current.focus();
                return true;
            }
        }
        return false;
    }
}

function makeTerminalModel(blockId: string): TermViewModel {
    return new TermViewModel(blockId);
}

interface TerminalViewProps {
    blockId: string;
    model: TermViewModel;
}

const TerminalView = ({ blockId, model }: TerminalViewProps) => {
    const connectElemRef = React.useRef<HTMLDivElement>(null);
    const termRef = React.useRef<TermWrap>(null);
    model.termRef = termRef;
    const shellProcStatusRef = React.useRef<string>(null);
    const blockIconOverrideAtom = useBlockAtom<string>(blockId, "blockicon:override", () => {
        return jotai.atom<string>(null);
    }) as jotai.PrimitiveAtom<string>;
    const htmlElemFocusRef = React.useRef<HTMLInputElement>(null);
    model.htmlElemFocusRef = htmlElemFocusRef;
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
        const settings = globalStore.get(atoms.settingsConfigAtom);
        const termTheme = computeTheme(settings, blockData?.meta?.termtheme);
        const termWrap = new TermWrap(
            blockId,
            connectElemRef.current,
            {
                theme: termTheme,
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
    }, [blockId, termSettings]);

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
            <TermThemeUpdater blockId={blockId} termRef={termRef} />
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
                    <VDomView rootNode={testVDom} />
                </div>
            </div>
        </div>
    );
};

export { TerminalView, makeTerminalModel };
