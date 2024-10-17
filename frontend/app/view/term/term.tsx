// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getAllGlobalKeyBindings } from "@/app/store/keymodel";
import { waveEventSubscribe } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { makeFeBlockRouteId } from "@/app/store/wshrouter";
import { DefaultRouter, TabRpcClient } from "@/app/store/wshrpcutil";
import { TermWshClient } from "@/app/view/term/term-wsh";
import { VDomView } from "@/app/view/term/vdom";
import { VDomModel } from "@/app/view/term/vdom-model";
import { NodeModel } from "@/layout/index";
import { WOS, atoms, getConnStatusAtom, getSettingsKeyAtom, globalStore, useSettingsPrefixAtom } from "@/store/global";
import * as services from "@/store/services";
import * as keyutil from "@/util/keyutil";
import clsx from "clsx";
import * as jotai from "jotai";
import * as React from "react";
import { TermStickers } from "./termsticker";
import { TermThemeUpdater } from "./termtheme";
import { computeTheme } from "./termutil";
import { TermWrap } from "./termwrap";
import "./xterm.css";

type InitialLoadDataType = {
    loaded: boolean;
    heldData: Uint8Array[];
};

class TermViewModel {
    viewType: string;
    nodeModel: NodeModel;
    connected: boolean;
    termRef: React.RefObject<TermWrap>;
    blockAtom: jotai.Atom<Block>;
    termMode: jotai.Atom<string>;
    blockId: string;
    viewIcon: jotai.Atom<string>;
    viewName: jotai.Atom<string>;
    blockBg: jotai.Atom<MetaType>;
    manageConnection: jotai.Atom<boolean>;
    connStatus: jotai.Atom<ConnStatus>;
    termWshClient: TermWshClient;
    shellProcStatusRef: React.MutableRefObject<string>;
    vdomModel: VDomModel;

    constructor(blockId: string, nodeModel: NodeModel) {
        this.viewType = "term";
        this.blockId = blockId;
        this.termWshClient = new TermWshClient(blockId, this);
        DefaultRouter.registerRoute(makeFeBlockRouteId(blockId), this.termWshClient);
        this.nodeModel = nodeModel;
        this.vdomModel = new VDomModel(blockId, nodeModel, null, this.termWshClient);
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
            const newTermMode = blockData?.meta?.["term:mode"] == "html" ? null : "html";
            RpcApi.SetMetaCommand(TabRpcClient, {
                oref: WOS.makeORef("block", this.blockId),
                meta: { "term:mode": newTermMode },
            });
            return true;
        }
        const blockData = globalStore.get(this.blockAtom);
        if (blockData.meta?.["term:mode"] == "html") {
            return this.vdomModel?.globalKeydownHandler(waveEvent);
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

        termThemeKeys.sort((a, b) => {
            return termThemes[a]["display:order"] - termThemes[b]["display:order"];
        });
        const fullMenu: ContextMenuItem[] = [];
        const submenu: ContextMenuItem[] = termThemeKeys.map((themeName) => {
            return {
                label: termThemes[themeName]["display:name"] ?? themeName,
                click: () => this.setTerminalTheme(themeName),
            };
        });
        fullMenu.push({
            label: "Themes",
            submenu: submenu,
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
    if (termMode != "term" && termMode != "html") {
        termMode = "term";
    }
    const termModeRef = React.useRef(termMode);

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
        const termWrap = new TermWrap(
            blockId,
            connectElemRef.current,
            {
                theme: themeCopy,
                fontSize: termSettings?.["term:fontsize"] ?? 12,
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
        return () => {
            termWrap.dispose();
            rszObs.disconnect();
        };
    }, [blockId, termSettings]);

    React.useEffect(() => {
        if (termModeRef.current == "html" && termMode == "term") {
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
            <div key="htmlElem" className="term-htmlelem">
                <div key="htmlElemContent" className="term-htmlelem-content">
                    <VDomView blockId={blockId} nodeModel={model.nodeModel} viewRef={viewRef} model={model.vdomModel} />
                </div>
            </div>
        </div>
    );
};

export { TermViewModel, TerminalView, makeTerminalModel };
