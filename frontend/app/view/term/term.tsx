// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getAllGlobalKeyBindings } from "@/app/store/keymodel";
import { waveEventSubscribe } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { WindowRpcClient } from "@/app/store/wshrpcutil";
import { VDomView } from "@/app/view/term/vdom";
import { NodeModel } from "@/layout/index";
import {
    WOS,
    atoms,
    getConnStatusAtom,
    getSettingsKeyAtom,
    globalStore,
    useBlockAtom,
    useSettingsPrefixAtom,
} from "@/store/global";
import * as services from "@/store/services";
import * as keyutil from "@/util/keyutil";
import * as util from "@/util/util";
import clsx from "clsx";
import * as jotai from "jotai";
import * as React from "react";
import { TermStickers } from "./termsticker";
import { TermThemeUpdater } from "./termtheme";
import { computeTheme } from "./termutil";
import { TermWrap } from "./termwrap";
import "./xterm.css";

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

class TermViewModel {
    viewType: string;
    connected: boolean;
    termRef: React.RefObject<TermWrap>;
    blockAtom: jotai.Atom<Block>;
    termMode: jotai.Atom<string>;
    htmlElemFocusRef: React.RefObject<HTMLInputElement>;
    blockId: string;
    nodeModel: NodeModel;
    viewIcon: jotai.Atom<string>;
    viewName: jotai.Atom<string>;
    blockBg: jotai.Atom<MetaType>;
    manageConnection: jotai.Atom<boolean>;
    connStatus: jotai.Atom<ConnStatus>;
    fontSizeAtom: jotai.Atom<number>;
    termThemeNameAtom: jotai.Atom<string>;

    constructor(blockId: string, nodeModel: NodeModel) {
        this.viewType = "term";
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.blockAtom = WOS.getWaveObjectAtom<Block>(`block:${blockId}`);
        this.termMode = jotai.atom((get) => {
            const blockData = get(this.blockAtom);
            return blockData?.meta?.["term:mode"] ?? "term";
        });
        this.viewIcon = jotai.atom((get) => {
            return "terminal";
        });
        this.viewName = jotai.atom((get) => {
            const blockData = get(this.blockAtom);
            if (blockData?.meta?.controller == "cmd") {
                return "Command";
            }
            return "Terminal";
        });
        this.manageConnection = jotai.atom(true);
        this.blockBg = jotai.atom((get) => {
            const blockData = get(this.blockAtom);
            const fullConfig = get(atoms.fullConfigAtom);
            let themeName: string = globalStore.get(getSettingsKeyAtom("term:theme"));
            if (blockData?.meta?.["term:theme"]) {
                themeName = blockData.meta["term:theme"];
            }
            const theme = computeTheme(fullConfig, themeName);
            if (theme != null && theme.background != null) {
                return { bg: theme.background };
            }
            return null;
        });
        this.connStatus = jotai.atom((get) => {
            const blockData = get(this.blockAtom);
            const connName = blockData?.meta?.connection;
            const connAtom = getConnStatusAtom(connName);
            return get(connAtom);
        });
        this.fontSizeAtom = useBlockAtom(blockId, "fontsizeatom", () => {
            return jotai.atom<number>((get) => {
                const blockData = get(this.blockAtom);
                const fsSettingsAtom = getSettingsKeyAtom("term:fontsize");
                const settingsFontSize = get(fsSettingsAtom);
                const rtnFontSize = blockData?.meta?.["term:fontsize"] ?? settingsFontSize ?? 12;
                if (typeof rtnFontSize != "number" || isNaN(rtnFontSize) || rtnFontSize < 4 || rtnFontSize > 64) {
                    return 12;
                }
                return rtnFontSize;
            });
        });
        this.termThemeNameAtom = useBlockAtom(blockId, "termthemeatom", () => {
            return jotai.atom<string>((get) => {
                const blockData = get(this.blockAtom);
                const settingsKeyAtom = getSettingsKeyAtom("term:theme");
                return blockData?.meta?.["term:theme"] ?? get(settingsKeyAtom) ?? "default-dark";
            });
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

    setTerminalTheme(themeName: string) {
        RpcApi.SetMetaCommand(WindowRpcClient, {
            oref: WOS.makeORef("block", this.blockId),
            meta: { "term:theme": themeName },
        });
    }

    getSettingsMenuItems(): ContextMenuItem[] {
        const fullConfig = globalStore.get(atoms.fullConfigAtom);
        const termThemes = fullConfig?.termthemes ?? {};
        const termThemeKeys = Object.keys(termThemes);
        const curFontSize = globalStore.get(this.fontSizeAtom);
        const curThemeName = globalStore.get(this.termThemeNameAtom);
        const defaultFontSize = globalStore.get(getSettingsKeyAtom("term:fontsize")) ?? 12;
        const blockData = globalStore.get(this.blockAtom);
        const overrideFontSize = blockData?.meta?.["term:fontsize"];

        termThemeKeys.sort((a, b) => {
            return termThemes[a]["display:order"] - termThemes[b]["display:order"];
        });
        const fullMenu: ContextMenuItem[] = [];
        const submenu: ContextMenuItem[] = termThemeKeys.map((themeName) => {
            return {
                label: termThemes[themeName]["display:name"] ?? themeName,
                type: "checkbox",
                checked: curThemeName == themeName,
                click: () => this.setTerminalTheme(themeName),
            };
        });
        const fontSizeSubMenu: ContextMenuItem[] = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].map(
            (fontSize: number) => {
                return {
                    label: fontSize.toString() + "px",
                    type: "checkbox",
                    checked: overrideFontSize == fontSize,
                    click: () => {
                        RpcApi.SetMetaCommand(WindowRpcClient, {
                            oref: WOS.makeORef("block", this.blockId),
                            meta: { "term:fontsize": fontSize },
                        });
                    },
                };
            }
        );
        fontSizeSubMenu.unshift({
            label: "Default (" + defaultFontSize + "px)",
            type: "checkbox",
            checked: overrideFontSize == null,
            click: () => {
                RpcApi.SetMetaCommand(WindowRpcClient, {
                    oref: WOS.makeORef("block", this.blockId),
                    meta: { "term:fontsize": null },
                });
            },
        });
        fullMenu.push({
            label: "Themes",
            submenu: submenu,
        });
        fullMenu.push({
            label: "Font Size",
            submenu: fontSizeSubMenu,
        });
        fullMenu.push({ type: "separator" });
        fullMenu.push({
            label: "Force Restart Controller",
            click: () => {
                const termsize = {
                    rows: this.termRef.current?.terminal?.rows,
                    cols: this.termRef.current?.terminal?.cols,
                };
                const prtn = RpcApi.ControllerResyncCommand(WindowRpcClient, {
                    tabid: globalStore.get(atoms.activeTabId),
                    blockid: this.blockId,
                    forcerestart: true,
                    rtopts: { termsize: termsize },
                });
                prtn.catch((e) => console.log("error controller resync (force restart)", e));
            },
        });
        return fullMenu;
    }
}

function makeTerminalModel(blockId: string, nodeModel: NodeModel): TermViewModel {
    return new TermViewModel(blockId, nodeModel);
}

interface TerminalViewProps {
    blockId: string;
    model: TermViewModel;
}

const TermResyncHandler = React.memo(({ blockId, model }: TerminalViewProps) => {
    const connStatus = jotai.useAtomValue(model.connStatus);
    const [lastConnStatus, setLastConnStatus] = React.useState<ConnStatus>(connStatus);

    React.useEffect(() => {
        if (!model.termRef.current?.hasResized) {
            return;
        }
        const isConnected = connStatus?.status == "connected";
        const wasConnected = lastConnStatus?.status == "connected";
        const curConnName = connStatus?.connection;
        const lastConnName = lastConnStatus?.connection;
        if (isConnected == wasConnected && curConnName == lastConnName) {
            return;
        }
        model.termRef.current?.resyncController("resync handler");
        setLastConnStatus(connStatus);
    }, [connStatus]);

    return null;
});

const TerminalView = ({ blockId, model }: TerminalViewProps) => {
    const viewRef = React.createRef<HTMLDivElement>();
    const connectElemRef = React.useRef<HTMLDivElement>(null);
    const termRef = React.useRef<TermWrap>(null);
    model.termRef = termRef;
    const shellProcStatusRef = React.useRef<string>(null);
    const htmlElemFocusRef = React.useRef<HTMLInputElement>(null);
    model.htmlElemFocusRef = htmlElemFocusRef;
    const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", blockId));
    const termSettingsAtom = useSettingsPrefixAtom("term");
    const termSettings = jotai.useAtomValue(termSettingsAtom);

    const termFontSize = jotai.useAtomValue(model.fontSizeAtom);

    React.useEffect(() => {
        function handleTerminalKeydown(event: KeyboardEvent): boolean {
            const waveEvent = keyutil.adaptFromReactOrNativeKeyEvent(event);
            if (waveEvent.type != "keydown") {
                return true;
            }
            // deal with terminal specific keybindings
            if (keyutil.checkKeyPressed(waveEvent, "Cmd:Escape")) {
                event.preventDefault();
                event.stopPropagation();
                RpcApi.SetMetaCommand(WindowRpcClient, {
                    oref: WOS.makeORef("block", blockId),
                    meta: { "term:mode": null },
                });
                return false;
            }
            if (keyutil.checkKeyPressed(waveEvent, "Ctrl:Shift:v")) {
                const p = navigator.clipboard.readText();
                p.then((text) => {
                    termRef.current?.terminal.paste(text);
                });
                event.preventDefault();
                event.stopPropagation();
                return false;
            } else if (keyutil.checkKeyPressed(waveEvent, "Ctrl:Shift:c")) {
                const sel = termRef.current?.terminal.getSelection();
                navigator.clipboard.writeText(sel);
                event.preventDefault();
                event.stopPropagation();
                return false;
            }
            if (shellProcStatusRef.current != "running" && keyutil.checkKeyPressed(waveEvent, "Enter")) {
                // restart
                const tabId = globalStore.get(atoms.activeTabId);
                const prtn = RpcApi.ControllerResyncCommand(WindowRpcClient, { tabid: tabId, blockid: blockId });
                prtn.catch((e) => console.log("error controller resync (enter)", blockId, e));
                return false;
            }
            const globalKeys = getAllGlobalKeyBindings();
            for (const key of globalKeys) {
                if (keyutil.checkKeyPressed(waveEvent, key)) {
                    return false;
                }
            }
            return true;
        }
        const fullConfig = globalStore.get(atoms.fullConfigAtom);
        const termTheme = computeTheme(fullConfig, blockData?.meta?.["term:theme"]);
        const themeCopy = { ...termTheme };
        themeCopy.background = "#00000000";
        let termScrollback = 1000;
        if (termSettings?.["term:scrollback"]) {
            termScrollback = Math.floor(termSettings["term:scrollback"]);
        }
        if (blockData?.meta?.["term:scrollback"]) {
            termScrollback = Math.floor(blockData.meta["term:scrollback"]);
        }
        if (termScrollback < 0) {
            termScrollback = 0;
        }
        if (termScrollback > 10000) {
            termScrollback = 10000;
        }
        const wasFocused = termRef.current != null && globalStore.get(model.nodeModel.isFocused);
        const termWrap = new TermWrap(
            blockId,
            connectElemRef.current,
            {
                theme: themeCopy,
                fontSize: termFontSize,
                fontFamily: termSettings?.["term:fontfamily"] ?? "Hack",
                drawBoldTextInBrightColors: false,
                fontWeight: "normal",
                fontWeightBold: "bold",
                allowTransparency: true,
                scrollback: termScrollback,
            },
            {
                keydownHandler: handleTerminalKeydown,
                useWebGl: !termSettings?.["term:disablewebgl"],
            }
        );
        (window as any).term = termWrap;
        termRef.current = termWrap;
        const rszObs = new ResizeObserver(() => {
            termWrap.handleResize_debounced();
        });
        rszObs.observe(connectElemRef.current);
        termWrap.initTerminal();
        if (wasFocused) {
            setTimeout(() => {
                model.giveFocus();
            }, 10);
        }
        return () => {
            termWrap.dispose();
            rszObs.disconnect();
        };
    }, [blockId, termSettings, termFontSize]);

    const handleHtmlKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        const waveEvent = keyutil.adaptFromReactOrNativeKeyEvent(event);
        if (keyutil.checkKeyPressed(waveEvent, "Cmd:Escape")) {
            // reset term:mode
            RpcApi.SetMetaCommand(WindowRpcClient, {
                oref: WOS.makeORef("block", blockId),
                meta: { "term:mode": null },
            });
            return false;
        }
        const asciiVal = keyboardEventToASCII(event);
        if (asciiVal.length == 0) {
            return false;
        }
        const b64data = util.stringToBase64(asciiVal);
        RpcApi.ControllerInputCommand(WindowRpcClient, { blockid: blockId, inputdata64: b64data });
        return true;
    };

    let termMode = blockData?.meta?.["term:mode"] ?? "term";
    if (termMode != "term" && termMode != "html") {
        termMode = "term";
    }

    // set intitial controller status, and then subscribe for updates
    React.useEffect(() => {
        function updateShellProcStatus(status: string) {
            if (status == null) {
                return;
            }
            shellProcStatusRef.current = status;
            if (status == "running") {
                termRef.current?.setIsRunning(true);
            } else {
                termRef.current?.setIsRunning(false);
            }
        }
        const initialRTStatus = services.BlockService.GetControllerStatus(blockId);
        initialRTStatus.then((rts) => {
            updateShellProcStatus(rts?.shellprocstatus);
        });
        return waveEventSubscribe({
            eventType: "controllerstatus",
            scope: WOS.makeORef("block", blockId),
            handler: (event) => {
                console.log("term waveEvent handler", event);
                let bcRTS: BlockControllerRuntimeStatus = event.data;
                updateShellProcStatus(bcRTS?.shellprocstatus);
            },
        });
    }, []);

    let stickerConfig = {
        charWidth: 8,
        charHeight: 16,
        rows: termRef.current?.terminal.rows ?? 24,
        cols: termRef.current?.terminal.cols ?? 80,
        blockId: blockId,
    };

    return (
        <div className={clsx("view-term", "term-mode-" + termMode)} ref={viewRef}>
            <TermResyncHandler blockId={blockId} model={model} />
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

export { TermViewModel, TerminalView, makeTerminalModel };
