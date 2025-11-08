// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockNodeModel } from "@/app/block/blocktypes";
import { appHandleKeyDown } from "@/app/store/keymodel";
import { waveEventSubscribe } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { makeFeBlockRouteId } from "@/app/store/wshrouter";
import { DefaultRouter, TabRpcClient } from "@/app/store/wshrpcutil";
import { TerminalView } from "@/app/view/term/term";
import { TermWshClient } from "@/app/view/term/term-wsh";
import { VDomModel } from "@/app/view/vdom/vdom-model";
import { WorkspaceLayoutModel } from "@/app/workspace/workspace-layout-model";
import {
    atoms,
    getAllBlockComponentModels,
    getApi,
    getBlockComponentModel,
    getBlockMetaKeyAtom,
    getConnStatusAtom,
    getOverrideConfigAtom,
    getSettingsKeyAtom,
    globalStore,
    useBlockAtom,
    WOS,
} from "@/store/global";
import * as services from "@/store/services";
import * as keyutil from "@/util/keyutil";
import { boundNumber, stringToBase64 } from "@/util/util";
import * as jotai from "jotai";
import * as React from "react";
import { getBlockingCommand } from "./shellblocking";
import { computeTheme, DefaultTermTheme } from "./termutil";
import { TermWrap } from "./termwrap";

export class TermViewModel implements ViewModel {
    viewType: string;
    nodeModel: BlockNodeModel;
    connected: boolean;
    termRef: React.RefObject<TermWrap> = { current: null };
    blockAtom: jotai.Atom<Block>;
    termMode: jotai.Atom<string>;
    blockId: string;
    viewIcon: jotai.Atom<string>;
    viewName: jotai.Atom<string>;
    viewText: jotai.Atom<HeaderElem[]>;
    blockBg: jotai.Atom<MetaType>;
    manageConnection: jotai.Atom<boolean>;
    filterOutNowsh?: jotai.Atom<boolean>;
    connStatus: jotai.Atom<ConnStatus>;
    termWshClient: TermWshClient;
    vdomBlockId: jotai.Atom<string>;
    vdomToolbarBlockId: jotai.Atom<string>;
    vdomToolbarTarget: jotai.PrimitiveAtom<VDomTargetToolbar>;
    fontSizeAtom: jotai.Atom<number>;
    termThemeNameAtom: jotai.Atom<string>;
    termTransparencyAtom: jotai.Atom<number>;
    noPadding: jotai.PrimitiveAtom<boolean>;
    endIconButtons: jotai.Atom<IconButtonDecl[]>;
    shellProcFullStatus: jotai.PrimitiveAtom<BlockControllerRuntimeStatus>;
    shellProcStatus: jotai.Atom<string>;
    shellProcStatusUnsubFn: () => void;
    isCmdController: jotai.Atom<boolean>;
    isRestarting: jotai.PrimitiveAtom<boolean>;
    searchAtoms?: SearchAtoms;

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
        this.vdomToolbarBlockId = jotai.atom((get) => {
            const blockData = get(this.blockAtom);
            return blockData?.meta?.["term:vdomtoolbarblockid"];
        });
        this.vdomToolbarTarget = jotai.atom<VDomTargetToolbar>(null) as jotai.PrimitiveAtom<VDomTargetToolbar>;
        this.termMode = jotai.atom((get) => {
            const blockData = get(this.blockAtom);
            return blockData?.meta?.["term:mode"] ?? "term";
        });
        this.isRestarting = jotai.atom(false);
        this.viewIcon = jotai.atom((get) => {
            const termMode = get(this.termMode);
            if (termMode == "vdom") {
                return "bolt";
            }
            const isCmd = get(this.isCmdController);
            if (isCmd) {
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
                return "";
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
            }
            const vdomBlockId = get(this.vdomBlockId);
            const rtn: HeaderElem[] = [];
            if (vdomBlockId) {
                rtn.push({
                    elemtype: "iconbutton",
                    icon: "bolt",
                    title: "Switch to Wave App",
                    click: () => {
                        this.setTermMode("vdom");
                    },
                });
            }
            const isCmd = get(this.isCmdController);
            if (isCmd) {
                const blockMeta = get(this.blockAtom)?.meta;
                let cmdText = blockMeta?.["cmd"];
                let cmdArgs = blockMeta?.["cmd:args"];
                if (cmdArgs != null && Array.isArray(cmdArgs) && cmdArgs.length > 0) {
                    cmdText += " " + cmdArgs.join(" ");
                }
                rtn.push({
                    elemtype: "text",
                    text: cmdText,
                    noGrow: true,
                });
                const isRestarting = get(this.isRestarting);
                if (isRestarting) {
                    rtn.push({
                        elemtype: "iconbutton",
                        icon: "refresh",
                        iconColor: "var(--success-color)",
                        iconSpin: true,
                        title: "Restarting Command",
                        noAction: true,
                    });
                } else {
                    const fullShellProcStatus = get(this.shellProcFullStatus);
                    if (fullShellProcStatus?.shellprocstatus == "done") {
                        if (fullShellProcStatus?.shellprocexitcode == 0) {
                            rtn.push({
                                elemtype: "iconbutton",
                                icon: "check",
                                iconColor: "var(--success-color)",
                                title: "Command Exited Successfully",
                                noAction: true,
                            });
                        } else {
                            rtn.push({
                                elemtype: "iconbutton",
                                icon: "xmark-large",
                                iconColor: "var(--error-color)",
                                title: "Exit Code: " + fullShellProcStatus?.shellprocexitcode,
                                noAction: true,
                            });
                        }
                    }
                }
            }
            const isMI = get(atoms.isTermMultiInput);
            if (isMI && this.isBasicTerm(get)) {
                rtn.push({
                    elemtype: "textbutton",
                    text: "Multi Input ON",
                    className: "yellow !py-[2px] !px-[10px] text-[11px] font-[500]",
                    title: "Input will be sent to all connected terminals (click to disable)",
                    onClick: () => {
                        globalStore.set(atoms.isTermMultiInput, false);
                    },
                });
            }
            return rtn;
        });
        this.manageConnection = jotai.atom((get) => {
            const termMode = get(this.termMode);
            if (termMode == "vdom") {
                return false;
            }
            const isCmd = get(this.isCmdController);
            if (isCmd) {
                return false;
            }
            return true;
        });
        this.filterOutNowsh = jotai.atom(false);
        this.termThemeNameAtom = useBlockAtom(blockId, "termthemeatom", () => {
            return jotai.atom<string>((get) => {
                return get(getOverrideConfigAtom(this.blockId, "term:theme")) ?? DefaultTermTheme;
            });
        });
        this.termTransparencyAtom = useBlockAtom(blockId, "termtransparencyatom", () => {
            return jotai.atom<number>((get) => {
                let value = get(getOverrideConfigAtom(this.blockId, "term:transparency")) ?? 0.5;
                return boundNumber(value, 0, 1);
            });
        });
        this.blockBg = jotai.atom((get) => {
            const fullConfig = get(atoms.fullConfigAtom);
            const themeName = get(this.termThemeNameAtom);
            const termTransparency = get(this.termTransparencyAtom);
            const [_, bgcolor] = computeTheme(fullConfig, themeName, termTransparency);
            if (bgcolor != null) {
                return { bg: bgcolor };
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
                const connName = blockData?.meta?.connection;
                const fullConfig = get(atoms.fullConfigAtom);
                const connFontSize = fullConfig?.connections?.[connName]?.["term:fontsize"];
                const rtnFontSize = blockData?.meta?.["term:fontsize"] ?? connFontSize ?? settingsFontSize ?? 12;
                if (typeof rtnFontSize != "number" || isNaN(rtnFontSize) || rtnFontSize < 4 || rtnFontSize > 64) {
                    return 12;
                }
                return rtnFontSize;
            });
        });
        this.noPadding = jotai.atom(true);
        this.endIconButtons = jotai.atom((get) => {
            const blockData = get(this.blockAtom);
            const shellProcStatus = get(this.shellProcStatus);
            const connStatus = get(this.connStatus);
            const isCmd = get(this.isCmdController);
            const rtn: IconButtonDecl[] = [];

            const isAIPanelOpen = get(WorkspaceLayoutModel.getInstance().panelVisibleAtom);
            if (isAIPanelOpen) {
                const shellIntegrationButton = this.getShellIntegrationIconButton(get);
                if (shellIntegrationButton) {
                    rtn.push(shellIntegrationButton);
                }
            }

            if (blockData?.meta?.["controller"] != "cmd" && shellProcStatus != "done") {
                return rtn;
            }
            if (connStatus?.status != "connected") {
                return rtn;
            }
            let iconName: string = null;
            let title: string = null;
            const noun = isCmd ? "Command" : "Shell";
            if (shellProcStatus == "init") {
                iconName = "play";
                title = "Click to Start " + noun;
            } else if (shellProcStatus == "running") {
                iconName = "refresh";
                title = noun + " Running. Click to Restart";
            } else if (shellProcStatus == "done") {
                iconName = "refresh";
                title = noun + " Exited. Click to Restart";
            }
            if (iconName != null) {
                const buttonDecl: IconButtonDecl = {
                    elemtype: "iconbutton",
                    icon: iconName,
                    click: this.forceRestartController.bind(this),
                    title: title,
                };
                rtn.push(buttonDecl);
            }
            return rtn;
        });
        this.isCmdController = jotai.atom((get) => {
            const controllerMetaAtom = getBlockMetaKeyAtom(this.blockId, "controller");
            return get(controllerMetaAtom) == "cmd";
        });
        this.shellProcFullStatus = jotai.atom(null) as jotai.PrimitiveAtom<BlockControllerRuntimeStatus>;
        const initialShellProcStatus = services.BlockService.GetControllerStatus(blockId);
        initialShellProcStatus.then((rts) => {
            this.updateShellProcStatus(rts);
        });
        this.shellProcStatusUnsubFn = waveEventSubscribe({
            eventType: "controllerstatus",
            scope: WOS.makeORef("block", blockId),
            handler: (event) => {
                let bcRTS: BlockControllerRuntimeStatus = event.data;
                this.updateShellProcStatus(bcRTS);
            },
        });
        this.shellProcStatus = jotai.atom((get) => {
            const fullStatus = get(this.shellProcFullStatus);
            return fullStatus?.shellprocstatus ?? "init";
        });
    }

    getShellIntegrationIconButton(get: jotai.Getter): IconButtonDecl | null {
        if (!this.termRef.current?.shellIntegrationStatusAtom) {
            return null;
        }
        const shellIntegrationStatus = get(this.termRef.current.shellIntegrationStatusAtom);
        if (shellIntegrationStatus == null) {
            return {
                elemtype: "iconbutton",
                icon: "sparkles",
                className: "text-muted",
                title: "No shell integration — Wave AI unable to run commands.",
                noAction: true,
            };
        }
        if (shellIntegrationStatus === "ready") {
            return {
                elemtype: "iconbutton",
                icon: "sparkles",
                className: "text-accent",
                title: "Shell ready — Wave AI can run commands in this terminal.",
                noAction: true,
            };
        }
        if (shellIntegrationStatus === "running-command") {
            let title = "Shell busy — Wave AI unable to run commands while another command is running.";

            if (this.termRef.current) {
                const inAltBuffer = this.termRef.current.terminal?.buffer?.active?.type === "alternate";
                const lastCommand = get(this.termRef.current.lastCommandAtom);
                const blockingCmd = getBlockingCommand(lastCommand, inAltBuffer);
                if (blockingCmd) {
                    title = `Wave AI integration disabled while you're inside ${blockingCmd}.`;
                }
            }

            return {
                elemtype: "iconbutton",
                icon: "sparkles",
                className: "text-warning",
                title: title,
                noAction: true,
            };
        }
        return null;
    }

    get viewComponent(): ViewComponent {
        return TerminalView as ViewComponent;
    }

    isBasicTerm(getFn: jotai.Getter): boolean {
        const termMode = getFn(this.termMode);
        if (termMode == "vdom") {
            return false;
        }
        const blockData = getFn(this.blockAtom);
        if (blockData?.meta?.controller == "cmd") {
            return false;
        }
        return true;
    }

    multiInputHandler(data: string) {
        const tvms = getAllBasicTermModels();
        for (const tvm of tvms) {
            if (tvm != this) {
                tvm.sendDataToController(data);
            }
        }
    }

    sendDataToController(data: string) {
        const b64data = stringToBase64(data);
        RpcApi.ControllerInputCommand(TabRpcClient, { blockid: this.blockId, inputdata64: b64data });
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

    triggerRestartAtom() {
        globalStore.set(this.isRestarting, true);
        setTimeout(() => {
            globalStore.set(this.isRestarting, false);
        }, 300);
    }

    updateShellProcStatus(fullStatus: BlockControllerRuntimeStatus) {
        if (fullStatus == null) {
            return;
        }
        const curStatus = globalStore.get(this.shellProcFullStatus);
        if (curStatus == null || curStatus.version < fullStatus.version) {
            globalStore.set(this.shellProcFullStatus, fullStatus);
        }
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

    getVDomToolbarModel(): VDomModel {
        const vdomToolbarBlockId = globalStore.get(this.vdomToolbarBlockId);
        if (!vdomToolbarBlockId) {
            return null;
        }
        const bcm = getBlockComponentModel(vdomToolbarBlockId);
        if (!bcm) {
            return null;
        }
        return bcm.viewModel as VDomModel;
    }

    dispose() {
        DefaultRouter.unregisterRoute(makeFeBlockRouteId(this.blockId));
        if (this.shellProcStatusUnsubFn) {
            this.shellProcStatusUnsubFn();
        }
    }

    giveFocus(): boolean {
        if (this.searchAtoms && globalStore.get(this.searchAtoms.isOpen)) {
            console.log("search is open, not giving focus");
            return true;
        }
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

        // Handle Escape key during IME composition
        if (keyutil.checkKeyPressed(waveEvent, "Escape")) {
            if (this.termRef.current?.isComposing) {
                // Reset composition state when Escape is pressed during composition
                this.termRef.current.resetCompositionState();
            }
        }

        if (this.keyDownHandler(waveEvent)) {
            event.preventDefault();
            event.stopPropagation();
            return false;
        }
        if (keyutil.checkKeyPressed(waveEvent, "Shift:Enter")) {
            const shiftEnterNewlineAtom = getOverrideConfigAtom(this.blockId, "term:shiftenternewline");
            const shiftEnterNewlineEnabled = globalStore.get(shiftEnterNewlineAtom) ?? true;
            if (shiftEnterNewlineEnabled) {
                this.sendDataToController("\n");
                event.preventDefault();
                event.stopPropagation();
                return false;
            }
        }
        if (keyutil.checkKeyPressed(waveEvent, "Ctrl:Shift:v")) {
            event.preventDefault();
            event.stopPropagation();
            getApi().nativePaste();
            // this.termRef.current?.pasteHandler();
            return false;
        } else if (keyutil.checkKeyPressed(waveEvent, "Ctrl:Shift:c")) {
            event.preventDefault();
            event.stopPropagation();
            const sel = this.termRef.current?.terminal.getSelection();
            navigator.clipboard.writeText(sel);
            return false;
        } else if (keyutil.checkKeyPressed(waveEvent, "Cmd:k")) {
            event.preventDefault();
            event.stopPropagation();
            this.termRef.current?.terminal?.clear();
            return false;
        }
        const shellProcStatus = globalStore.get(this.shellProcStatus);
        if ((shellProcStatus == "done" || shellProcStatus == "init") && keyutil.checkKeyPressed(waveEvent, "Enter")) {
            this.forceRestartController();
            return false;
        }
        const appHandled = appHandleKeyDown(waveEvent);
        if (appHandled) {
            event.preventDefault();
            event.stopPropagation();
            return false;
        }
        return true;
    }

    setTerminalTheme(themeName: string) {
        RpcApi.SetMetaCommand(TabRpcClient, {
            oref: WOS.makeORef("block", this.blockId),
            meta: { "term:theme": themeName },
        });
    }

    forceRestartController() {
        if (globalStore.get(this.isRestarting)) {
            return;
        }
        this.triggerRestartAtom();
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
    }

    getSettingsMenuItems(): ContextMenuItem[] {
        const fullConfig = globalStore.get(atoms.fullConfigAtom);
        const termThemes = fullConfig?.termthemes ?? {};
        const termThemeKeys = Object.keys(termThemes);
        const curThemeName = globalStore.get(getBlockMetaKeyAtom(this.blockId, "term:theme"));
        const defaultFontSize = globalStore.get(getSettingsKeyAtom("term:fontsize")) ?? 12;
        const transparencyMeta = globalStore.get(getBlockMetaKeyAtom(this.blockId, "term:transparency"));
        const blockData = globalStore.get(this.blockAtom);
        const overrideFontSize = blockData?.meta?.["term:fontsize"];

        termThemeKeys.sort((a, b) => {
            return (termThemes[a]["display:order"] ?? 0) - (termThemes[b]["display:order"] ?? 0);
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
        submenu.unshift({
            label: "Default",
            type: "checkbox",
            checked: curThemeName == null,
            click: () => this.setTerminalTheme(null),
        });
        const transparencySubMenu: ContextMenuItem[] = [];
        transparencySubMenu.push({
            label: "Default",
            type: "checkbox",
            checked: transparencyMeta == null,
            click: () => {
                RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("block", this.blockId),
                    meta: { "term:transparency": null },
                });
            },
        });
        transparencySubMenu.push({
            label: "Transparent Background",
            type: "checkbox",
            checked: transparencyMeta == 0.5,
            click: () => {
                RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("block", this.blockId),
                    meta: { "term:transparency": 0.5 },
                });
            },
        });
        transparencySubMenu.push({
            label: "No Transparency",
            type: "checkbox",
            checked: transparencyMeta == 0,
            click: () => {
                RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("block", this.blockId),
                    meta: { "term:transparency": 0 },
                });
            },
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
        fullMenu.push({
            label: "Transparency",
            submenu: transparencySubMenu,
        });
        fullMenu.push({ type: "separator" });
        fullMenu.push({
            label: "Force Restart Controller",
            click: this.forceRestartController.bind(this),
        });
        const isClearOnStart = blockData?.meta?.["cmd:clearonstart"];
        fullMenu.push({
            label: "Clear Output On Restart",
            submenu: [
                {
                    label: "On",
                    type: "checkbox",
                    checked: isClearOnStart,
                    click: () => {
                        RpcApi.SetMetaCommand(TabRpcClient, {
                            oref: WOS.makeORef("block", this.blockId),
                            meta: { "cmd:clearonstart": true },
                        });
                    },
                },
                {
                    label: "Off",
                    type: "checkbox",
                    checked: !isClearOnStart,
                    click: () => {
                        RpcApi.SetMetaCommand(TabRpcClient, {
                            oref: WOS.makeORef("block", this.blockId),
                            meta: { "cmd:clearonstart": false },
                        });
                    },
                },
            ],
        });
        const runOnStart = blockData?.meta?.["cmd:runonstart"];
        fullMenu.push({
            label: "Run On Startup",
            submenu: [
                {
                    label: "On",
                    type: "checkbox",
                    checked: runOnStart,
                    click: () => {
                        RpcApi.SetMetaCommand(TabRpcClient, {
                            oref: WOS.makeORef("block", this.blockId),
                            meta: { "cmd:runonstart": true },
                        });
                    },
                },
                {
                    label: "Off",
                    type: "checkbox",
                    checked: !runOnStart,
                    click: () => {
                        RpcApi.SetMetaCommand(TabRpcClient, {
                            oref: WOS.makeORef("block", this.blockId),
                            meta: { "cmd:runonstart": false },
                        });
                    },
                },
            ],
        });
        if (blockData?.meta?.["term:vdomtoolbarblockid"]) {
            fullMenu.push({ type: "separator" });
            fullMenu.push({
                label: "Close Toolbar",
                click: () => {
                    RpcApi.DeleteSubBlockCommand(TabRpcClient, { blockid: blockData.meta["term:vdomtoolbarblockid"] });
                },
            });
        }
        const debugConn = blockData?.meta?.["term:conndebug"];
        fullMenu.push({
            label: "Debug Connection",
            submenu: [
                {
                    label: "Off",
                    type: "checkbox",
                    checked: !debugConn,
                    click: () => {
                        RpcApi.SetMetaCommand(TabRpcClient, {
                            oref: WOS.makeORef("block", this.blockId),
                            meta: { "term:conndebug": null },
                        });
                    },
                },
                {
                    label: "Info",
                    type: "checkbox",
                    checked: debugConn == "info",
                    click: () => {
                        RpcApi.SetMetaCommand(TabRpcClient, {
                            oref: WOS.makeORef("block", this.blockId),
                            meta: { "term:conndebug": "info" },
                        });
                    },
                },
                {
                    label: "Verbose",
                    type: "checkbox",
                    checked: debugConn == "debug",
                    click: () => {
                        RpcApi.SetMetaCommand(TabRpcClient, {
                            oref: WOS.makeORef("block", this.blockId),
                            meta: { "term:conndebug": "debug" },
                        });
                    },
                },
            ],
        });
        return fullMenu;
    }
}

export function getAllBasicTermModels(): TermViewModel[] {
    const termModels: TermViewModel[] = [];
    const bcms = getAllBlockComponentModels();
    for (const bcm of bcms) {
        if (bcm?.viewModel?.viewType == "term") {
            const tvm = bcm.viewModel as TermViewModel;
            if (tvm.isBasicTerm((atom) => globalStore.get(atom))) {
                termModels.push(tvm);
            }
        }
    }
    return termModels;
}

export function makeTerminalModel(blockId: string, nodeModel: BlockNodeModel): TermViewModel {
    return new TermViewModel(blockId, nodeModel);
}
