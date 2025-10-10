// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WaveAIModel } from "@/app/aipanel/waveai-model";
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
    refocusNode,
    replaceBlock,
    WOS,
} from "@/app/store/global";
import { focusManager } from "@/app/store/focusManager";
import { WorkspaceLayoutModel } from "@/app/workspace/workspace-layout-model";
import { deleteLayoutModelForTab, getLayoutModelForStaticTab, NavigateDirection } from "@/layout/index";
import * as keyutil from "@/util/keyutil";
import { CHORD_TIMEOUT } from "@/util/sharedconst";
import { fireAndForget } from "@/util/util";
import * as jotai from "jotai";
import { modalsModel } from "./modalmodel";

type KeyHandler = (event: WaveKeyboardEvent) => boolean;

const simpleControlShiftAtom = jotai.atom(false);
const globalKeyMap = new Map<string, (waveEvent: WaveKeyboardEvent) => boolean>();
const globalChordMap = new Map<string, Map<string, KeyHandler>>();

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

function getFocusedBlockInStaticTab() {
    const layoutModel = getLayoutModelForStaticTab();
    const focusedNode = globalStore.get(layoutModel.focusedNode);
    return focusedNode.data?.blockId;
}

function getSimpleControlShiftAtom() {
    return simpleControlShiftAtom;
}

function setControlShift() {
    globalStore.set(simpleControlShiftAtom, true);
    setTimeout(() => {
        const simpleState = globalStore.get(simpleControlShiftAtom);
        if (simpleState) {
            globalStore.set(atoms.controlShiftDelayAtom, true);
        }
    }, 400);
}

function unsetControlShift() {
    globalStore.set(simpleControlShiftAtom, false);
    globalStore.set(atoms.controlShiftDelayAtom, false);
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

function genericClose() {
    const focusType = focusManager.getFocusType();
    if (focusType === "waveai") {
        WorkspaceLayoutModel.getInstance().setAIPanelVisible(false);
        return;
    }
    const ws = globalStore.get(atoms.workspace);
    const tabId = globalStore.get(atoms.staticTabId);
    const tabORef = WOS.makeORef("tab", tabId);
    const tabAtom = WOS.getWaveObjectAtom<Tab>(tabORef);
    const tabData = globalStore.get(tabAtom);
    if (tabData == null) {
        return;
    }
    if (ws.pinnedtabids?.includes(tabId) && tabData.blockids?.length == 1) {
        // don't allow closing the last block in a pinned tab
        return;
    }
    if (tabData.blockids == null || tabData.blockids.length == 0) {
        // close tab
        getApi().closeTab(ws.oid, tabId);
        deleteLayoutModelForTab(tabId);
        return;
    }
    const layoutModel = getLayoutModelForStaticTab();
    fireAndForget(layoutModel.closeFocusedNode.bind(layoutModel));
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
    const focusType = focusManager.getFocusType();

    if (direction === NavigateDirection.Left) {
        const numBlocks = globalStore.get(layoutModel.numLeafs);
        if (focusType === "waveai") {
            return;
        }
        if (numBlocks === 1) {
            focusManager.requestWaveAIFocus();
            return;
        }
    }

    if (direction === NavigateDirection.Right && focusType === "waveai") {
        focusManager.requestNodeFocus();
        return;
    }

    const inWaveAI = focusType === "waveai";
    const navResult = layoutModel.switchNodeFocusInDirection(direction, inWaveAI);
    if (navResult.atLeft) {
        focusManager.requestWaveAIFocus();
        return;
    }
    setTimeout(() => {
        globalRefocus();
    }, 10);
}

function getAllTabs(ws: Workspace): string[] {
    return [...(ws.pinnedtabids ?? []), ...(ws.tabids ?? [])];
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
    const nativeEvent = (waveEvent as any).nativeEvent;
    if (lastHandledEvent != null && nativeEvent != null && lastHandledEvent === nativeEvent) {
        console.log("lastHandledEvent return false");
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
    let gsGetBound = globalStore.get.bind(globalStore);
    for (const bcm of allBCMs) {
        const viewModel = bcm.viewModel;
        if (viewModel.viewType == "term" && viewModel.isBasicTerm?.(gsGetBound)) {
            count++;
        }
    }
    return count;
}

function registerGlobalKeys() {
    globalKeyMap.set("Cmd:]", () => {
        switchTab(1);
        return true;
    });
    globalKeyMap.set("Shift:Cmd:]", () => {
        switchTab(1);
        return true;
    });
    globalKeyMap.set("Cmd:[", () => {
        switchTab(-1);
        return true;
    });
    globalKeyMap.set("Shift:Cmd:[", () => {
        switchTab(-1);
        return true;
    });
    globalKeyMap.set("Cmd:n", () => {
        handleCmdN();
        return true;
    });
    globalKeyMap.set("Cmd:d", () => {
        handleSplitHorizontal("after");
        return true;
    });
    globalKeyMap.set("Shift:Cmd:d", () => {
        handleSplitVertical("after");
        return true;
    });
    globalKeyMap.set("Cmd:i", () => {
        handleCmdI();
        return true;
    });
    globalKeyMap.set("Cmd:t", () => {
        createTab();
        return true;
    });
    globalKeyMap.set("Cmd:w", () => {
        genericClose();
        return true;
    });
    globalKeyMap.set("Cmd:Shift:w", () => {
        const tabId = globalStore.get(atoms.staticTabId);
        const ws = globalStore.get(atoms.workspace);
        if (ws.pinnedtabids?.includes(tabId)) {
            // switch to first unpinned tab if it exists (for close spamming)
            if (ws.tabids != null && ws.tabids.length > 0) {
                getApi().setActiveTab(ws.tabids[0]);
            }
            return true;
        }
        getApi().closeTab(ws.oid, tabId);
        return true;
    });
    globalKeyMap.set("Cmd:m", () => {
        const layoutModel = getLayoutModelForStaticTab();
        const focusedNode = globalStore.get(layoutModel.focusedNode);
        if (focusedNode != null) {
            layoutModel.magnifyNodeToggle(focusedNode.id);
        }
        return true;
    });
    globalKeyMap.set("Ctrl:Shift:ArrowUp", () => {
        switchBlockInDirection(NavigateDirection.Up);
        return true;
    });
    globalKeyMap.set("Ctrl:Shift:ArrowDown", () => {
        switchBlockInDirection(NavigateDirection.Down);
        return true;
    });
    globalKeyMap.set("Ctrl:Shift:ArrowLeft", () => {
        switchBlockInDirection(NavigateDirection.Left);
        return true;
    });
    globalKeyMap.set("Ctrl:Shift:ArrowRight", () => {
        switchBlockInDirection(NavigateDirection.Right);
        return true;
    });
    globalKeyMap.set("Ctrl:Shift:k", () => {
        const blockId = getFocusedBlockId();
        if (blockId == null) {
            return true;
        }
        replaceBlock(blockId, {
            meta: {
                view: "launcher",
            },
        });
        return true;
    });
    globalKeyMap.set("Cmd:g", () => {
        const bcm = getBlockComponentModel(getFocusedBlockInStaticTab());
        if (bcm.openSwitchConnection != null) {
            bcm.openSwitchConnection();
            return true;
        }
    });
    globalKeyMap.set("Ctrl:Shift:i", () => {
        const curMI = globalStore.get(atoms.isTermMultiInput);
        if (!curMI && countTermBlocks() <= 1) {
            // don't turn on multi-input unless there are 2 or more basic term blocks
            return true;
        }
        globalStore.set(atoms.isTermMultiInput, !curMI);
        return true;
    });
    for (let idx = 1; idx <= 9; idx++) {
        globalKeyMap.set(`Cmd:${idx}`, () => {
            switchTabAbs(idx);
            return true;
        });
        globalKeyMap.set(`Ctrl:Shift:c{Digit${idx}}`, () => {
            switchBlockByBlockNum(idx);
            return true;
        });
        globalKeyMap.set(`Ctrl:Shift:c{Numpad${idx}}`, () => {
            switchBlockByBlockNum(idx);
            return true;
        });
    }
    globalKeyMap.set("Ctrl:Shift:c{Digit0}", () => {
        WaveAIModel.getInstance().focusInput();
        return true;
    });
    globalKeyMap.set("Ctrl:Shift:c{Numpad0}", () => {
        WaveAIModel.getInstance().focusInput();
        return true;
    });
    function activateSearch(event: WaveKeyboardEvent): boolean {
        const bcm = getBlockComponentModel(getFocusedBlockInStaticTab());
        // Ctrl+f is reserved in most shells
        if (event.control && bcm.viewModel.viewType == "term") {
            return false;
        }
        if (bcm.viewModel.searchAtoms) {
            globalStore.set(bcm.viewModel.searchAtoms.isOpen, true);
            return true;
        }
        return false;
    }
    function deactivateSearch(): boolean {
        const bcm = getBlockComponentModel(getFocusedBlockInStaticTab());
        if (bcm.viewModel.searchAtoms && globalStore.get(bcm.viewModel.searchAtoms.isOpen)) {
            globalStore.set(bcm.viewModel.searchAtoms.isOpen, false);
            return true;
        }
        return false;
    }
    globalKeyMap.set("Cmd:f", activateSearch);
    globalKeyMap.set("Escape", () => {
        if (modalsModel.hasOpenModals()) {
            modalsModel.popModal();
            return true;
        }
        if (deactivateSearch()) {
            return true;
        }
        return false;
    });
    globalKeyMap.set("Cmd:Shift:a", () => {
        const currentVisible = WorkspaceLayoutModel.getInstance().getAIPanelVisible();
        WorkspaceLayoutModel.getInstance().setAIPanelVisible(!currentVisible);
        return true;
    });
    const allKeys = Array.from(globalKeyMap.keys());
    // special case keys, handled by web view
    allKeys.push("Cmd:l", "Cmd:r", "Cmd:ArrowRight", "Cmd:ArrowLeft", "Cmd:o");
    getApi().registerGlobalWebviewKeys(allKeys);

    const splitBlockKeys = new Map<string, KeyHandler>();
    splitBlockKeys.set("ArrowUp", () => {
        handleSplitVertical("before");
        return true;
    });
    splitBlockKeys.set("ArrowDown", () => {
        handleSplitVertical("after");
        return true;
    });
    splitBlockKeys.set("ArrowLeft", () => {
        handleSplitHorizontal("before");
        return true;
    });
    splitBlockKeys.set("ArrowRight", () => {
        handleSplitHorizontal("after");
        return true;
    });
    globalChordMap.set("Ctrl:Shift:s", splitBlockKeys);
}

function getAllGlobalKeyBindings(): string[] {
    const allKeys = Array.from(globalKeyMap.keys());
    return allKeys;
}

// these keyboard events happen *anywhere*, even if you have focus in an input or somewhere else.
function handleGlobalWaveKeyboardEvents(waveEvent: WaveKeyboardEvent): boolean {
    for (const key of globalKeyMap.keys()) {
        if (keyutil.checkKeyPressed(waveEvent, key)) {
            const handler = globalKeyMap.get(key);
            if (handler == null) {
                return false;
            }
            return handler(waveEvent);
        }
    }
    return false;
}

export {
    appHandleKeyDown,
    getAllGlobalKeyBindings,
    getSimpleControlShiftAtom,
    globalRefocus,
    globalRefocusWithTimeout,
    registerControlShiftStateUpdateHandler,
    registerElectronReinjectKeyHandler,
    registerGlobalKeys,
    tryReinjectKey,
    unsetControlShift,
};
