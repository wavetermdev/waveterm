// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms, createBlock, getApi, getViewModel, globalStore, WOS } from "@/app/store/global";
import * as services from "@/app/store/services";
import {
    deleteLayoutModelForTab,
    getLayoutModelForActiveTab,
    getLayoutModelForTab,
    getLayoutModelForTabById,
    NavigateDirection,
} from "@/layout/index";
import * as keyutil from "@/util/keyutil";
import * as jotai from "jotai";

const simpleControlShiftAtom = jotai.atom(false);
const globalKeyMap = new Map<string, (waveEvent: WaveKeyboardEvent) => boolean>();

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

function shouldDispatchToBlock(): boolean {
    if (globalStore.get(atoms.modalOpen)) {
        return false;
    }
    const activeElem = document.activeElement;
    if (activeElem != null && activeElem instanceof HTMLElement) {
        if (activeElem.tagName == "INPUT" || activeElem.tagName == "TEXTAREA") {
            return false;
        }
        if (activeElem.contentEditable == "true") {
            return false;
        }
    }
    return true;
}

function genericClose(tabId: string) {
    const tabORef = WOS.makeORef("tab", tabId);
    const tabAtom = WOS.getWaveObjectAtom<Tab>(tabORef);
    const tabData = globalStore.get(tabAtom);
    if (tabData == null) {
        return;
    }
    if (tabData.blockids == null || tabData.blockids.length == 0) {
        // close tab
        services.WindowService.CloseTab(tabId);
        deleteLayoutModelForTab(tabId);
        return;
    }
    const layoutModel = getLayoutModelForTab(tabAtom);
    layoutModel.closeFocusedNode();
}

function switchBlockByBlockNum(index: number) {
    const layoutModel = getLayoutModelForActiveTab();
    if (!layoutModel) {
        return;
    }
    layoutModel.switchNodeFocusByBlockNum(index);
}

function switchBlockInDirection(tabId: string, direction: NavigateDirection) {
    const layoutModel = getLayoutModelForTabById(tabId);
    layoutModel.switchNodeFocusInDirection(direction);
}

function switchTabAbs(index: number) {
    const ws = globalStore.get(atoms.workspace);
    const newTabIdx = index - 1;
    if (newTabIdx < 0 || newTabIdx >= ws.tabids.length) {
        return;
    }
    const newActiveTabId = ws.tabids[newTabIdx];
    services.ObjectService.SetActiveTab(newActiveTabId);
}

function switchTab(offset: number) {
    const ws = globalStore.get(atoms.workspace);
    const activeTabId = globalStore.get(atoms.tabAtom).oid;
    let tabIdx = -1;
    for (let i = 0; i < ws.tabids.length; i++) {
        if (ws.tabids[i] == activeTabId) {
            tabIdx = i;
            break;
        }
    }
    if (tabIdx == -1) {
        return;
    }
    const newTabIdx = (tabIdx + offset + ws.tabids.length) % ws.tabids.length;
    const newActiveTabId = ws.tabids[newTabIdx];
    services.ObjectService.SetActiveTab(newActiveTabId);
}

async function handleCmdN() {
    const termBlockDef: BlockDef = {
        meta: {
            view: "term",
            controller: "shell",
        },
    };
    const layoutModel = getLayoutModelForActiveTab();
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
    await createBlock(termBlockDef);
}

function appHandleKeyDown(waveEvent: WaveKeyboardEvent): boolean {
    return handleGlobalWaveKeyboardEvents(waveEvent);
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
        console.log("reinject key event", event);
        const handled = handleGlobalWaveKeyboardEvents(event);
        if (handled) {
            return;
        }
        const layoutModel = getLayoutModelForActiveTab();
        const focusedNode = globalStore.get(layoutModel.focusedNode);
        const blockId = focusedNode?.data?.blockId;
        if (blockId != null && shouldDispatchToBlock()) {
            const viewModel = getViewModel(blockId);
            viewModel?.keyDownHandler?.(event);
        }
    });
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
    globalKeyMap.set("Cmd:i", () => {
        // TODO
        return true;
    });
    globalKeyMap.set("Cmd:t", () => {
        const workspace = globalStore.get(atoms.workspace);
        const newTabName = `T${workspace.tabids.length + 1}`;
        services.ObjectService.AddTabToWorkspace(newTabName, true);
        return true;
    });
    globalKeyMap.set("Cmd:w", () => {
        const tabId = globalStore.get(atoms.activeTabId);
        genericClose(tabId);
        return true;
    });
    globalKeyMap.set("Ctrl:Shift:ArrowUp", () => {
        const tabId = globalStore.get(atoms.activeTabId);
        switchBlockInDirection(tabId, NavigateDirection.Up);
        return true;
    });
    globalKeyMap.set("Ctrl:Shift:ArrowDown", () => {
        const tabId = globalStore.get(atoms.activeTabId);
        switchBlockInDirection(tabId, NavigateDirection.Down);
        return true;
    });
    globalKeyMap.set("Ctrl:Shift:ArrowLeft", () => {
        const tabId = globalStore.get(atoms.activeTabId);
        switchBlockInDirection(tabId, NavigateDirection.Left);
        return true;
    });
    globalKeyMap.set("Ctrl:Shift:ArrowRight", () => {
        const tabId = globalStore.get(atoms.activeTabId);
        switchBlockInDirection(tabId, NavigateDirection.Right);
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
    const allKeys = Array.from(globalKeyMap.keys());
    // special case keys, handled by web view
    allKeys.push("Cmd:l", "Cmd:r", "Cmd:ArrowRight", "Cmd:ArrowLeft");
    getApi().registerGlobalWebviewKeys(allKeys);
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
}

export {
    appHandleKeyDown,
    getSimpleControlShiftAtom,
    registerControlShiftStateUpdateHandler,
    registerElectronReinjectKeyHandler,
    registerGlobalKeys,
    unsetControlShift,
};
