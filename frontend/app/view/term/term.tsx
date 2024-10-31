// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Block, SubBlock } from "@/app/block/block";
import { BlockNodeModel } from "@/app/block/blocktypes";
import { getAllGlobalKeyBindings } from "@/app/store/keymodel";
import { waveEventSubscribe } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { makeFeBlockRouteId } from "@/app/store/wshrouter";
import { DefaultRouter, TabRpcClient } from "@/app/store/wshrpcutil";
import { TermWshClient } from "@/app/view/term/term-wsh";
import { VDomModel } from "@/app/view/vdom/vdom-model";
import {
    WOS,
    atoms,
    getBlockComponentModel,
    getConnStatusAtom,
    getSettingsKeyAtom,
    globalStore,
    useBlockAtom,
    useSettingsPrefixAtom,
} from "@/store/global";
import * as services from "@/store/services";
import * as keyutil from "@/util/keyutil";
import clsx from "clsx";
import debug from "debug";
import * as jotai from "jotai";
import * as React from "react";
import { TermStickers } from "./termsticker";
import { TermThemeUpdater } from "./termtheme";
import { computeTheme } from "./termutil";
import { TermWrap } from "./termwrap";
import "./xterm.css";

const dlog = debug("wave:term");

type InitialLoadDataType = {
    loaded: boolean;
    heldData: Uint8Array[];
};

class TermViewModel {
    viewType: string;
    nodeModel: BlockNodeModel;
    connected: boolean;
    termRef: React.RefObject<TermWrap>;
    blockAtom: jotai.Atom<Block>;
    termMode: jotai.Atom<string>;
    blockId: string;
    viewIcon: jotai.Atom<string>;
    viewName: jotai.Atom<string>;
    viewText: jotai.Atom<HeaderElem[]>;
    blockBg: jotai.Atom<MetaType>;
    manageConnection: jotai.Atom<boolean>;
    connStatus: jotai.Atom<ConnStatus>;
    termWshClient: TermWshClient;
    shellProcStatusRef: React.MutableRefObject<string>;
    vdomBlockId: jotai.Atom<string>;
    fontSizeAtom: jotai.Atom<number>;
    termThemeNameAtom: jotai.Atom<string>;

    constructor(blockId: string, nodeModel: BlockNodeModel) {
        this.viewType = "term";
        this.blockId = blockId;
        this.termWshClient = new TermWshClient(blockId, this);
        DefaultRouter.registerRoute(makeFeBlockRouteId(blockId), this.termWshClient);
        this.nodeModel = nodeModel;
        this.blockAtom = WOS.getWaveObjectAtom<Block>(`block:${blockId}`);
        this.vdomBlockId = jotai.atom((get) => {
            const blockData = get(this.blockAtom);
            return blockData?.meta?.["term:vdomblockid"];
        });
        this.termMode = jotai.atom((get) => {
            const blockData = get(this.blockAtom);
            return blockData?.meta?.["term:mode"] ?? "term";
        });
        this.viewIcon = jotai.atom((get) => {
            const termMode = get(this.termMode);
            if (termMode == "vdom") {
                return "bolt";
            }
            return "terminal";
        });
        this.viewName = jotai.atom((get) => {
            const blockData = get(this.blockAtom);
            const termMode = get(this.termMode);
            if (termMode == "vdom") {
                return "Wave App";
            }
            if (blockData?.meta?.controller == "cmd") {
                return "Command";
            }
            return "Terminal";
        });
        this.viewText = jotai.atom((get) => {
            const termMode = get(this.termMode);
            if (termMode == "vdom") {
                return [
                    {
                        elemtype: "iconbutton",
                        icon: "square-terminal",
                        title: "Switch back to Terminal",
                        click: () => {
                            this.setTermMode("term");
                        },
                    },
                ];
            } else {
                const vdomBlockId = get(this.vdomBlockId);
                if (vdomBlockId) {
                    return [
                        {
                            elemtype: "iconbutton",
                            icon: "bolt",
                            title: "Switch to Wave App",
                            click: () => {
                                this.setTermMode("vdom");
                            },
                        },
                    ];
                }
            }
            return null;
        });
        this.manageConnection = jotai.atom((get) => {
            const termMode = get(this.termMode);
            if (termMode == "vdom") {
                return false;
            }
            return true;
        });
        this.blockBg = jotai.atom((get) => {
            const blockData = get(this.blockAtom);
            const fullConfig = get(atoms.fullConfigAtom);
            let themeName: string = get(getSettingsKeyAtom("term:theme"));
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

    setTermMode(mode: "term" | "vdom") {
        if (mode == "term") {
            mode = null;
        }
        RpcApi.SetMetaCommand(TabRpcClient, {
            oref: WOS.makeORef("block", this.blockId),
            meta: { "term:mode": mode },
        });
    }

    getVDomModel(): VDomModel {
        const vdomBlockId = globalStore.get(this.vdomBlockId);
        if (!vdomBlockId) {
            return null;
        }
        const bcm = getBlockComponentModel(vdomBlockId);
        if (!bcm) {
            return null;
        }
        return bcm.viewModel as VDomModel;
    }

    dispose() {
        DefaultRouter.unregisterRoute(makeFeBlockRouteId(this.blockId));
    }

    giveFocus(): boolean {
        let termMode = globalStore.get(this.termMode);
        if (termMode == "term") {
            if (this.termRef?.current?.terminal) {
                this.termRef.current.terminal.focus();
                return true;
            }
        }
        return false;
    }

    keyDownHandler(waveEvent: WaveKeyboardEvent): boolean {
        if (keyutil.checkKeyPressed(waveEvent, "Cmd:Escape")) {
            const blockAtom = WOS.getWaveObjectAtom<Block>(`block:${this.blockId}`);
            const blockData = globalStore.get(blockAtom);
            const newTermMode = blockData?.meta?.["term:mode"] == "vdom" ? null : "vdom";
            const vdomBlockId = globalStore.get(this.vdomBlockId);
            if (newTermMode == "vdom" && !vdomBlockId) {
                return;
            }
            this.setTermMode(newTermMode);
            return true;
        }
        const blockData = globalStore.get(this.blockAtom);
        if (blockData.meta?.["term:mode"] == "vdom") {
            const vdomModel = this.getVDomModel();
            return vdomModel?.keyDownHandler(waveEvent);
        }
        return false;
    }

    handleTerminalKeydown(event: KeyboardEvent): boolean {
        const waveEvent = keyutil.adaptFromReactOrNativeKeyEvent(event);
        if (waveEvent.type != "keydown") {
            return true;
        }
        if (this.keyDownHandler(waveEvent)) {
            event.preventDefault();
            event.stopPropagation();
            return false;
        }
        // deal with terminal specific keybindings
        if (keyutil.checkKeyPressed(waveEvent, "Ctrl:Shift:v")) {
            const p = navigator.clipboard.readText();
            p.then((text) => {
                this.termRef.current?.terminal.paste(text);
            });
            event.preventDefault();
            event.stopPropagation();
            return false;
        } else if (keyutil.checkKeyPressed(waveEvent, "Ctrl:Shift:c")) {
            const sel = this.termRef.current?.terminal.getSelection();
            navigator.clipboard.writeText(sel);
            event.preventDefault();
            event.stopPropagation();
            return false;
        }
        if (this.shellProcStatusRef.current != "running" && keyutil.checkKeyPressed(waveEvent, "Enter")) {
            // restart
            const tabId = globalStore.get(atoms.staticTabId);
            const prtn = RpcApi.ControllerResyncCommand(TabRpcClient, { tabid: tabId, blockid: this.blockId });
            prtn.catch((e) => console.log("error controller resync (enter)", this.blockId, e));
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

    setTerminalTheme(themeName: string) {
        RpcApi.SetMetaCommand(TabRpcClient, {
            oref: WOS.makeORef("block", this.blockId),
            meta: { "term:theme": themeName },
        });
    }

    getSettingsMenuItems(): ContextMenuItem[] {
        const fullConfig = globalStore.get(atoms.fullConfigAtom);
        const termThemes = fullConfig?.termthemes ?? {};
        const termThemeKeys = Object.keys(termThemes);
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
                        RpcApi.SetMetaCommand(TabRpcClient, {
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
                RpcApi.SetMetaCommand(TabRpcClient, {
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
                const prtn = RpcApi.ControllerResyncCommand(TabRpcClient, {
                    tabid: globalStore.get(atoms.staticTabId),
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

function makeTerminalModel(blockId: string, nodeModel: BlockNodeModel): TermViewModel {
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

const TermVDomNodeSingleId = ({ vdomBlockId, blockId, model }: TerminalViewProps & { vdomBlockId: string }) => {
    React.useEffect(() => {
        const unsub = waveEventSubscribe({
            eventType: "blockclose",
            scope: WOS.makeORef("block", vdomBlockId),
            handler: (event) => {
                RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("block", blockId),
                    meta: {
                        "term:mode": null,
                        "term:vdomblockid": null,
                    },
                });
            },
        });
        return () => {
            unsub();
        };
    }, []);
    const isFocusedAtom = jotai.atom((get) => {
        return get(model.nodeModel.isFocused) && get(model.termMode) == "vdom";
    });
    let vdomNodeModel = {
        blockId: vdomBlockId,
        isFocused: isFocusedAtom,
        focusNode: () => {
            model.nodeModel.focusNode();
        },
        onClose: () => {
            if (vdomBlockId != null) {
                RpcApi.DeleteSubBlockCommand(TabRpcClient, { blockid: vdomBlockId });
            }
        },
    };
    return (
        <div key="htmlElem" className="term-htmlelem">
            <SubBlock key="vdom" nodeModel={vdomNodeModel} />
        </div>
    );
};

const TermVDomNode = ({ blockId, model }: TerminalViewProps) => {
    const vdomBlockId = jotai.useAtomValue(model.vdomBlockId);
    if (vdomBlockId == null) {
        return null;
    }
    return <TermVDomNodeSingleId key={vdomBlockId} vdomBlockId={vdomBlockId} blockId={blockId} model={model} />;
};

const TerminalView = ({ blockId, model }: TerminalViewProps) => {
    const viewRef = React.useRef<HTMLDivElement>(null);
    const connectElemRef = React.useRef<HTMLDivElement>(null);
    const termRef = React.useRef<TermWrap>(null);
    model.termRef = termRef;
    const spstatusRef = React.useRef<string>(null);
    model.shellProcStatusRef = spstatusRef;
    const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", blockId));
    const termSettingsAtom = useSettingsPrefixAtom("term");
    const termSettings = jotai.useAtomValue(termSettingsAtom);
    let termMode = blockData?.meta?.["term:mode"] ?? "term";
    if (termMode != "term" && termMode != "vdom") {
        termMode = "term";
    }
    const termModeRef = React.useRef(termMode);

    const termFontSize = jotai.useAtomValue(model.fontSizeAtom);

    React.useEffect(() => {
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
                keydownHandler: model.handleTerminalKeydown.bind(model),
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

    React.useEffect(() => {
        if (termModeRef.current == "vdom" && termMode == "term") {
            // focus the terminal
            model.giveFocus();
        }
        termModeRef.current = termMode;
    }, [termMode]);

    // set intitial controller status, and then subscribe for updates
    React.useEffect(() => {
        function updateShellProcStatus(status: string) {
            if (status == null) {
                return;
            }
            model.shellProcStatusRef.current = status;
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
            <TermVDomNode key="vdom" blockId={blockId} model={model} />
        </div>
    );
};

export { TermViewModel, TerminalView, makeTerminalModel };
