// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WaveAIModel } from "@/app/aipanel/waveai-model";
import { FocusManager } from "@/app/store/focusManager";
import {
    atoms,
    createBlock,
    createBlockSplitHorizontally,
    createBlockSplitVertically,
    createTab,
    getAllBlockComponentModels,
    getApi,
    getBlockComponentModel,
    getFocusedBlockId,
    getSettingsKeyAtom,
    globalStore,
    recordTEvent,
    refocusNode,
    replaceBlock,
    WOS,
} from "@/app/store/global";
import { getActiveTabModel } from "@/app/store/tab-model";
import { WorkspaceLayoutModel } from "@/app/workspace/workspace-layout-model";
import { deleteLayoutModelForTab, getLayoutModelForStaticTab, NavigateDirection } from "@/layout/index";
import * as keyutil from "@/util/keyutil";
import { CHORD_TIMEOUT } from "@/util/sharedconst";
import { fireAndForget } from "@/util/util";
import * as jotai from "jotai";
import { modalsModel } from "./modalmodel";
import { isBuilderWindow, isTabWindow } from "./windowtype";

type KeyHandler = (event: WaveKeyboardEvent) => boolean;

const simpleControlShiftAtom = jotai.atom(false);
const globalKeyMap = new Map<string, (waveEvent: WaveKeyboardEvent) => boolean>();
const globalChordMap = new Map<string, Map<string, KeyHandler>>();
let globalKeybindingsDisabled = false;

// track current chord state and timeout (for resetting)
let activeChord: string | null = null;
let chordTimeout: NodeJS.Timeout = null;

function resetChord() {
    activeChord = null;
    if (chordTimeout) {
        clearTimeout(chordTimeout);
        chordTimeout = null;
    }
}

function setActiveChord(activeChordArg: string) {
    getApi().setKeyboardChordMode();
    if (chordTimeout) {
        clearTimeout(chordTimeout);
    }
    activeChord = activeChordArg;
    chordTimeout = setTimeout(() => resetChord(), CHORD_TIMEOUT);
}

export function keyboardMouseDownHandler(e: MouseEvent) {
    if (!e.ctrlKey || !e.shiftKey) {
        unsetControlShift();
    }
}

function getFocusedBlockInStaticTab(): string {
    const layoutModel = getLayoutModelForStaticTab();
    const focusedNode = globalStore.get(layoutModel.focusedNode);
    return focusedNode.data?.blockId;
}

function getSimpleControlShiftAtom() {
    return simpleControlShiftAtom;
}

function setControlShift() {
    globalStore.set(simpleControlShiftAtom, true);
    const disableDisplay = globalStore.get(getSettingsKeyAtom("app:disablectrlshiftdisplay"));
    if (!disableDisplay) {
        setTimeout(() => {
            const simpleState = globalStore.get(simpleControlShiftAtom);
            if (simpleState) {
                globalStore.set(atoms.controlShiftDelayAtom, true);
            }
        }, 400);
    }
}

function unsetControlShift() {
    globalStore.set(simpleControlShiftAtom, false);
    globalStore.set(atoms.controlShiftDelayAtom, false);
}

function disableGlobalKeybindings() {
    globalKeybindingsDisabled = true;
}

function enableGlobalKeybindings() {
    globalKeybindingsDisabled = false;
}

function shouldDispatchToBlock(e: WaveKeyboardEvent): boolean {
    if (globalStore.get(atoms.modalOpen)) {
        return false;
    }
    const activeElem = document.activeElement;
    if (activeElem != null && activeElem instanceof HTMLElement) {
        if (activeElem.tagName == "INPUT" || activeElem.tagName == "TEXTAREA" || activeElem.contentEditable == "true") {
            if (activeElem.classList.contains("dummy-focus") || activeElem.classList.contains("dummy")) {
                return true;
            }
            if (keyutil.isInputEvent(e)) {
                return false;
            }
            return true;
        }
    }
    return true;
}

function getStaticTabBlockCount(): number {
    const tabId = globalStore.get(atoms.staticTabId);
    const tabORef = WOS.makeORef("tab", tabId);
    const tabAtom = WOS.getWaveObjectAtom<Tab>(tabORef);
    const tabData = globalStore.get(tabAtom);
    return tabData?.blockids?.length ?? 0;
}

function simpleCloseStaticTab() {
    const workspaceId = globalStore.get(atoms.workspaceId);
    const tabId = globalStore.get(atoms.staticTabId);
    const confirmClose = globalStore.get(getSettingsKeyAtom("tab:confirmclose")) ?? false;
    getApi()
        .closeTab(workspaceId, tabId, confirmClose)
        .then((didClose) => {
            if (didClose) {
                deleteLayoutModelForTab(tabId);
            }
        })
        .catch((e) => {
            console.log("error closing tab", e);
        });
}

function uxCloseBlock(blockId: string) {
    const workspaceLayoutModel = WorkspaceLayoutModel.getInstance();
    const isAIPanelOpen = workspaceLayoutModel.getAIPanelVisible();
    if (isAIPanelOpen && getStaticTabBlockCount() === 1) {
        const aiModel = WaveAIModel.getInstance();
        const shouldSwitchToAI = !globalStore.get(aiModel.isChatEmptyAtom) || aiModel.hasNonEmptyInput();
        if (shouldSwitchToAI) {
            replaceBlock(blockId, { meta: { view: "launcher" } }, false);
            setTimeout(() => WaveAIModel.getInstance().focusInput(), 50);
            return;
        }
    }

    const blockAtom = WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId));
    const blockData = globalStore.get(blockAtom);
    const isAIFileDiff = blockData?.meta?.view === "aifilediff";

    // If this is the last block, closing it will close the tab — route through simpleCloseStaticTab
    // so the tab:confirmclose setting is respected.
    if (getStaticTabBlockCount() === 1) {
        simpleCloseStaticTab();
        return;
    }

    const layoutModel = getLayoutModelForStaticTab();
    const node = layoutModel.getNodeByBlockId(blockId);
    if (node) {
        fireAndForget(() => layoutModel.closeNode(node.id));

        if (isAIFileDiff && isAIPanelOpen) {
            setTimeout(() => WaveAIModel.getInstance().focusInput(), 50);
        }
    }
}

function genericClose() {
    const focusType = FocusManager.getInstance().getFocusType();
    if (focusType === "waveai") {
        WorkspaceLayoutModel.getInstance().setAIPanelVisible(false);
        return;
    }

    const workspaceLayoutModel = WorkspaceLayoutModel.getInstance();
    const isAIPanelOpen = workspaceLayoutModel.getAIPanelVisible();
    if (isAIPanelOpen && getStaticTabBlockCount() === 1) {
        const aiModel = WaveAIModel.getInstance();
        const shouldSwitchToAI = !globalStore.get(aiModel.isChatEmptyAtom) || aiModel.hasNonEmptyInput();
        if (shouldSwitchToAI) {
            const layoutModel = getLayoutModelForStaticTab();
            const focusedNode = globalStore.get(layoutModel.focusedNode);
            if (focusedNode) {
                replaceBlock(focusedNode.data.blockId, { meta: { view: "launcher" } }, false);
                setTimeout(() => WaveAIModel.getInstance().focusInput(), 50);
                return;
            }
        }
    }
    const blockCount = getStaticTabBlockCount();
    if (blockCount === 0) {
        simpleCloseStaticTab();
        return;
    }

    // If this is the last block, closing it will close the tab — route through simpleCloseStaticTab
    // so the tab:confirmclose setting is respected.
    if (blockCount === 1) {
        simpleCloseStaticTab();
        return;
    }

    const layoutModel = getLayoutModelForStaticTab();
    const focusedNode = globalStore.get(layoutModel.focusedNode);
    const blockId = focusedNode?.data?.blockId;
    const blockAtom = blockId ? WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId)) : null;
    const blockData = blockAtom ? globalStore.get(blockAtom) : null;
    const isAIFileDiff = blockData?.meta?.view === "aifilediff";

    fireAndForget(layoutModel.closeFocusedNode.bind(layoutModel));

    if (isAIFileDiff && isAIPanelOpen) {
        setTimeout(() => WaveAIModel.getInstance().focusInput(), 50);
    }
}

function switchBlockByBlockNum(index: number) {
    const layoutModel = getLayoutModelForStaticTab();
    if (!layoutModel) {
        return;
    }
    layoutModel.switchNodeFocusByBlockNum(index);
    setTimeout(() => {
        globalRefocus();
    }, 10);
}

function switchBlockInDirection(direction: NavigateDirection) {
    const layoutModel = getLayoutModelForStaticTab();
    const focusType = FocusManager.getInstance().getFocusType();

    if (direction === NavigateDirection.Left) {
        const numBlocks = globalStore.get(layoutModel.numLeafs);
        if (focusType === "waveai") {
            return;
        }
        if (numBlocks === 1) {
            FocusManager.getInstance().requestWaveAIFocus();
            setTimeout(() => {
                FocusManager.getInstance().refocusNode();
            }, 10);
            return;
        }
    }

    if (direction === NavigateDirection.Right && focusType === "waveai") {
        FocusManager.getInstance().requestNodeFocus();
        return;
    }

    const inWaveAI = focusType === "waveai";
    const navResult = layoutModel.switchNodeFocusInDirection(direction, inWaveAI);
    if (navResult.atLeft) {
        FocusManager.getInstance().requestWaveAIFocus();
        setTimeout(() => {
            FocusManager.getInstance().refocusNode();
        }, 10);
        return;
    }
    setTimeout(() => {
        globalRefocus();
    }, 10);
}

function getAllTabs(ws: Workspace): string[] {
    return ws.tabids ?? [];
}

function switchTabAbs(index: number) {
    console.log("switchTabAbs", index);
    const ws = globalStore.get(atoms.workspace);
    const newTabIdx = index - 1;
    const tabids = getAllTabs(ws);
    if (newTabIdx < 0 || newTabIdx >= tabids.length) {
        return;
    }
    const newActiveTabId = tabids[newTabIdx];
    getApi().setActiveTab(newActiveTabId);
}

function switchTab(offset: number) {
    console.log("switchTab", offset);
    const ws = globalStore.get(atoms.workspace);
    const curTabId = globalStore.get(atoms.staticTabId);
    let tabIdx = -1;
    const tabids = getAllTabs(ws);
    for (let i = 0; i < tabids.length; i++) {
        if (tabids[i] == curTabId) {
            tabIdx = i;
            break;
        }
    }
    if (tabIdx == -1) {
        return;
    }
    const newTabIdx = (tabIdx + offset + tabids.length) % tabids.length;
    const newActiveTabId = tabids[newTabIdx];
    getApi().setActiveTab(newActiveTabId);
}

function handleCmdI() {
    globalRefocus();
}

function globalRefocusWithTimeout(timeoutVal: number) {
    setTimeout(() => {
        globalRefocus();
    }, timeoutVal);
}

function globalRefocus() {
    if (isBuilderWindow()) {
        return;
    }

    const layoutModel = getLayoutModelForStaticTab();
    const focusedNode = globalStore.get(layoutModel.focusedNode);
    if (focusedNode == null) {
        // focus a node
        layoutModel.focusFirstNode();
        return;
    }
    const blockId = focusedNode?.data?.blockId;
    if (blockId == null) {
        return;
    }
    refocusNode(blockId);
}

function getDefaultNewBlockDef(): BlockDef {
    const adnbAtom = getSettingsKeyAtom("app:defaultnewblock");
    const adnb = globalStore.get(adnbAtom) ?? "term";
    if (adnb == "launcher") {
        return {
            meta: {
                view: "launcher",
            },
        };
    }
    // "term", blank, anything else, fall back to terminal
    const termBlockDef: BlockDef = {
        meta: {
            view: "term",
            controller: "shell",
        },
    };
    const layoutModel = getLayoutModelForStaticTab();
    const focusedNode = globalStore.get(layoutModel.focusedNode);
    if (focusedNode != null) {
        const blockAtom = WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", focusedNode.data?.blockId));
        const blockData = globalStore.get(blockAtom);
        if (blockData?.meta?.view == "term") {
            if (blockData?.meta?.["cmd:cwd"] != null) {
                termBlockDef.meta["cmd:cwd"] = blockData.meta["cmd:cwd"];
            }
        }
        if (blockData?.meta?.connection != null) {
            termBlockDef.meta.connection = blockData.meta.connection;
        }
    }
    return termBlockDef;
}

async function handleCmdN() {
    const blockDef = getDefaultNewBlockDef();
    await createBlock(blockDef);
}

async function handleSplitHorizontal(position: "before" | "after") {
    const layoutModel = getLayoutModelForStaticTab();
    const focusedNode = globalStore.get(layoutModel.focusedNode);
    if (focusedNode == null) {
        return;
    }
    const blockDef = getDefaultNewBlockDef();
    await createBlockSplitHorizontally(blockDef, focusedNode.data.blockId, position);
}

async function handleSplitVertical(position: "before" | "after") {
    const layoutModel = getLayoutModelForStaticTab();
    const focusedNode = globalStore.get(layoutModel.focusedNode);
    if (focusedNode == null) {
        return;
    }
    const blockDef = getDefaultNewBlockDef();
    await createBlockSplitVertically(blockDef, focusedNode.data.blockId, position);
}

let lastHandledEvent: KeyboardEvent | null = null;

// returns [keymatch, T]
function checkKeyMap<T>(waveEvent: WaveKeyboardEvent, keyMap: Map<string, T>): [string, T] {
    for (const key of keyMap.keys()) {
        if (keyutil.checkKeyPressed(waveEvent, key)) {
            const val = keyMap.get(key);
            return [key, val];
        }
    }
    return [null, null];
}

function appHandleKeyDown(waveEvent: WaveKeyboardEvent): boolean {
    if (globalKeybindingsDisabled) {
        return false;
    }
    const nativeEvent = (waveEvent as any).nativeEvent;
    if (lastHandledEvent != null && nativeEvent != null && lastHandledEvent === nativeEvent) {
        return false;
    }
    lastHandledEvent = nativeEvent;
    if (activeChord) {
        console.log("handle activeChord", activeChord);
        // If we're in chord mode, look for the second key.
        const chordBindings = globalChordMap.get(activeChord);
        const [, handler] = checkKeyMap(waveEvent, chordBindings);
        if (handler) {
            resetChord();
            return handler(waveEvent);
        } else {
            // invalid chord; reset state and consume key
            resetChord();
            return true;
        }
    }
    const [chordKeyMatch] = checkKeyMap(waveEvent, globalChordMap);
    if (chordKeyMatch) {
        setActiveChord(chordKeyMatch);
        return true;
    }

    const [, globalHandler] = checkKeyMap(waveEvent, globalKeyMap);
    if (globalHandler) {
        const handled = globalHandler(waveEvent);
        if (handled) {
            return true;
        }
    }
    if (isTabWindow()) {
        const layoutModel = getLayoutModelForStaticTab();
        const focusedNode = globalStore.get(layoutModel.focusedNode);
        const blockId = focusedNode?.data?.blockId;
        if (blockId != null && shouldDispatchToBlock(waveEvent)) {
            const bcm = getBlockComponentModel(blockId);
            const viewModel = bcm?.viewModel;
            if (viewModel?.keyDownHandler) {
                const handledByBlock = viewModel.keyDownHandler(waveEvent);
                if (handledByBlock) {
                    return true;
                }
            }
        }
    }
    return false;
}

function registerControlShiftStateUpdateHandler() {
    getApi().onControlShiftStateUpdate((state: boolean) => {
        if (state) {
            setControlShift();
        } else {
            unsetControlShift();
        }
    });
}

function registerElectronReinjectKeyHandler() {
    getApi().onReinjectKey((event: WaveKeyboardEvent) => {
        appHandleKeyDown(event);
    });
}

function tryReinjectKey(event: WaveKeyboardEvent): boolean {
    return appHandleKeyDown(event);
}

function countTermBlocks(): number {
    const allBCMs = getAllBlockComponentModels();
    let count = 0;
    const gsGetBound = globalStore.get.bind(globalStore);
    for (const bcm of allBCMs) {
        const viewModel = bcm.viewModel;
        if (viewModel.viewType == "term" && viewModel.isBasicTerm?.(gsGetBound)) {
            count++;
        }
    }
    return count;
}

const DirectionMap: Record<string, NavigateDirection> = {
    up: NavigateDirection.Up,
    down: NavigateDirection.Down,
    left: NavigateDirection.Left,
    right: NavigateDirection.Right,
};

function activateSearch(event: WaveKeyboardEvent): boolean {
    const bcm = getBlockComponentModel(getFocusedBlockInStaticTab());
    if (bcm?.viewModel == null) {
        return false;
    }
    if (event.control && bcm.viewModel.viewType == "term") {
        return false;
    }
    if (bcm.viewModel.searchAtoms) {
        if (globalStore.get(bcm.viewModel.searchAtoms.isOpen)) {
            const cur = globalStore.get(bcm.viewModel.searchAtoms.focusInput) as number;
            globalStore.set(bcm.viewModel.searchAtoms.focusInput, cur + 1);
        } else {
            globalStore.set(bcm.viewModel.searchAtoms.isOpen, true);
        }
        return true;
    }
    return false;
}

function deactivateSearch(): boolean {
    const bcm = getBlockComponentModel(getFocusedBlockInStaticTab());
    if (bcm?.viewModel?.searchAtoms && globalStore.get(bcm.viewModel.searchAtoms.isOpen)) {
        globalStore.set(bcm.viewModel.searchAtoms.isOpen, false);
        return true;
    }
    return false;
}

type CommandHandler = (commandStr?: string) => KeyHandler;

function getCommandHandlers(): Record<string, CommandHandler> {
    return {
        "tab:next": () => () => {
            switchTab(1);
            return true;
        },
        "tab:prev": () => () => {
            switchTab(-1);
            return true;
        },
        "tab:new": () => () => {
            createTab();
            return true;
        },
        "tab:close": () => () => {
            simpleCloseStaticTab();
            return true;
        },
        "tab:switch-num": (commandStr) => () => {
            const tabNum = parseInt(commandStr);
            if (isNaN(tabNum)) {
                return false;
            }
            switchTabAbs(tabNum);
            return true;
        },
        "block:new": () => () => {
            handleCmdN();
            return true;
        },
        "block:close": () => () => {
            genericClose();
            return true;
        },
        "block:split-right": () => () => {
            handleSplitHorizontal("after");
            return true;
        },
        "block:split-down": () => () => {
            handleSplitVertical("after");
            return true;
        },
        "block:magnify": () => () => {
            const layoutModel = getLayoutModelForStaticTab();
            const focusedNode = globalStore.get(layoutModel.focusedNode);
            if (focusedNode != null) {
                const ephemeralNode = globalStore.get(layoutModel.ephemeralNode);
                if (ephemeralNode?.id === focusedNode.id) {
                    layoutModel.addEphemeralNodeToLayout();
                } else {
                    layoutModel.magnifyNodeToggle(focusedNode.id);
                }
            }
            return true;
        },
        "block:refocus": () => () => {
            handleCmdI();
            return true;
        },
        "block:focus": (commandStr) => (waveEvent) => {
            const direction = DirectionMap[commandStr];
            if (direction == null) {
                return false;
            }
            if (waveEvent?.control && waveEvent?.shift) {
                const disableCtrlShiftArrows = globalStore.get(getSettingsKeyAtom("app:disablectrlshiftarrows"));
                if (disableCtrlShiftArrows) {
                    return false;
                }
            }
            switchBlockInDirection(direction);
            return true;
        },
        "block:focus-num": (commandStr) => () => {
            const blockNum = parseInt(commandStr);
            if (isNaN(blockNum)) {
                return false;
            }
            switchBlockByBlockNum(blockNum);
            return true;
        },
        "block:replace-launcher": () => () => {
            const blockId = getFocusedBlockId();
            if (blockId == null) {
                return true;
            }
            replaceBlock(blockId, { meta: { view: "launcher" } }, true);
            return true;
        },
        "block:rename": () => () => {
            const tabModel = getActiveTabModel();
            if (tabModel?.startRenameCallback != null) {
                tabModel.startRenameCallback();
                return true;
            }
            return false;
        },
        "block:connection": () => () => {
            const bcm = getBlockComponentModel(getFocusedBlockInStaticTab());
            if (bcm?.openSwitchConnection != null) {
                recordTEvent("action:other", { "action:type": "conndropdown", "action:initiator": "keyboard" });
                bcm.openSwitchConnection();
                return true;
            }
            return false;
        },
        "block:search": () => activateSearch,
        "generic:escape": () => () => {
            if (modalsModel.hasOpenModals()) {
                modalsModel.popModal();
                return true;
            }
            if (deactivateSearch()) {
                return true;
            }
            return false;
        },
        "ai:toggle": () => () => {
            const currentVisible = WorkspaceLayoutModel.getInstance().getAIPanelVisible();
            WorkspaceLayoutModel.getInstance().setAIPanelVisible(!currentVisible);
            return true;
        },
        "ai:focus": () => () => {
            WaveAIModel.getInstance().focusInput();
            return true;
        },
        "ai:focus-windows": () => () => {
            WaveAIModel.getInstance().focusInput();
            return true;
        },
        "term:multi-input": () => () => {
            const tabModel = getActiveTabModel();
            if (tabModel == null) {
                return true;
            }
            const curMI = globalStore.get(tabModel.isTermMultiInput);
            if (!curMI && countTermBlocks() <= 1) {
                return true;
            }
            globalStore.set(tabModel.isTermMultiInput, !curMI);
            return true;
        },
        "block:split-chord": (commandStr) => () => {
            const direction = commandStr;
            if (direction === "up") {
                handleSplitVertical("before");
            } else if (direction === "down") {
                handleSplitVertical("after");
            } else if (direction === "left") {
                handleSplitHorizontal("before");
            } else if (direction === "right") {
                handleSplitHorizontal("after");
            }
            return true;
        },
    };
}

function registerGlobalKeys() {
    const fullConfig = globalStore.get(atoms.fullConfigAtom);
    const keybindings: KeybindingConfigType[] = fullConfig?.keybindings ?? [];
    const commandHandlers = getCommandHandlers();

    for (const kb of keybindings) {
        const handlerFactory = commandHandlers[kb.command];
        if (handlerFactory == null) {
            continue;
        }
        const handler = handlerFactory(kb.commandstr);
        for (const keyStr of kb.keys ?? []) {
            const parts = keyStr.trim().split(/\s+/);
            if (parts.length > 2 || parts[0] === "") {
                console.warn("ignoring invalid keybinding (expected a key or a two-key chord):", keyStr);
                continue;
            }
            if (parts.length === 2) {
                const [chordKey, secondKey] = parts;
                if (!globalChordMap.has(chordKey)) {
                    globalChordMap.set(chordKey, new Map<string, KeyHandler>());
                }
                globalChordMap.get(chordKey).set(secondKey, handler);
            } else {
                globalKeyMap.set(parts[0], handler);
            }
        }
    }

    const allKeys = Array.from(
        new Set([
            ...globalKeyMap.keys(),
            ...globalChordMap.keys(),
            "Cmd:l",
            "Cmd:r",
            "Cmd:ArrowRight",
            "Cmd:ArrowLeft",
            "Cmd:o",
        ])
    );
    getApi().registerGlobalWebviewKeys(allKeys);
}

function reregisterGlobalKeys() {
    resetChord();
    globalKeyMap.clear();
    globalChordMap.clear();
    registerGlobalKeys();
}

function registerBuilderGlobalKeys() {
    globalKeyMap.set("Cmd:w", () => {
        getApi().closeBuilderWindow();
        return true;
    });
    const allKeys = Array.from(globalKeyMap.keys());
    getApi().registerGlobalWebviewKeys(allKeys);
}

function getAllGlobalKeyBindings(): string[] {
    const allKeys = Array.from(globalKeyMap.keys());
    return allKeys;
}

export {
    appHandleKeyDown,
    disableGlobalKeybindings,
    enableGlobalKeybindings,
    getSimpleControlShiftAtom,
    globalRefocus,
    globalRefocusWithTimeout,
    registerBuilderGlobalKeys,
    registerControlShiftStateUpdateHandler,
    registerElectronReinjectKeyHandler,
    registerGlobalKeys,
    reregisterGlobalKeys,
    tryReinjectKey,
    unsetControlShift,
    uxCloseBlock,
};
