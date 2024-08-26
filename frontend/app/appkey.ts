// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms, createBlock, globalStore, WOS } from "@/app/store/global";
import {
    deleteLayoutModelForTab,
    getLayoutModelForActiveTab,
    getLayoutModelForTab,
    getLayoutModelForTabById,
    NavigateDirection,
} from "@/layout/index";
import * as services from "@/store/services";
import * as keyutil from "@/util/keyutil";
import * as jotai from "jotai";

const simpleControlShiftAtom = jotai.atom(false);

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

function appHandleKeyUp(event: KeyboardEvent) {
    const waveEvent = keyutil.adaptFromReactOrNativeKeyEvent(event);
    if (waveEvent.key === "Control" || waveEvent.key === "Shift") {
        unsetControlShift();
    }
    if (waveEvent.key == "Meta") {
        if (waveEvent.control && waveEvent.shift) {
            setControlShift();
        }
    }
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
    if (waveEvent.key === "Control" || waveEvent.key === "Shift" || waveEvent.key === "Meta") {
        if (waveEvent.control && waveEvent.shift && !waveEvent.meta) {
            // Set the control and shift without the Meta key
            setControlShift();
        } else {
            // Unset if Meta is pressed
            unsetControlShift();
        }
        return false;
    }
    const tabId = globalStore.get(atoms.activeTabId);

    // global key handler for now (refactor later)
    if (keyutil.checkKeyPressed(waveEvent, "Cmd:]") || keyutil.checkKeyPressed(waveEvent, "Shift:Cmd:]")) {
        switchTab(1);
        return true;
    }
    if (keyutil.checkKeyPressed(waveEvent, "Cmd:[") || keyutil.checkKeyPressed(waveEvent, "Shift:Cmd:[")) {
        switchTab(-1);
        return true;
    }
    if (keyutil.checkKeyPressed(waveEvent, "Cmd:n")) {
        handleCmdN();
        return true;
    }
    if (keyutil.checkKeyPressed(waveEvent, "Cmd:t")) {
        const workspace = globalStore.get(atoms.workspace);
        const newTabName = `T${workspace.tabids.length + 1}`;
        services.ObjectService.AddTabToWorkspace(newTabName, true);
        return true;
    }
    for (let idx = 1; idx <= 9; idx++) {
        if (keyutil.checkKeyPressed(waveEvent, `Cmd:${idx}`)) {
            switchTabAbs(idx);
            return true;
        }
    }
    for (let idx = 1; idx <= 9; idx++) {
        if (
            keyutil.checkKeyPressed(waveEvent, `Ctrl:Shift:c{Digit${idx}}`) ||
            keyutil.checkKeyPressed(waveEvent, `Ctrl:Shift:c{Numpad${idx}}`)
        ) {
            switchBlockByBlockNum(idx);
            return true;
        }
    }
    if (keyutil.checkKeyPressed(waveEvent, "Ctrl:Shift:ArrowUp")) {
        switchBlockInDirection(tabId, NavigateDirection.Up);
        return true;
    }
    if (keyutil.checkKeyPressed(waveEvent, "Ctrl:Shift:ArrowDown")) {
        switchBlockInDirection(tabId, NavigateDirection.Down);
        return true;
    }
    if (keyutil.checkKeyPressed(waveEvent, "Ctrl:Shift:ArrowLeft")) {
        switchBlockInDirection(tabId, NavigateDirection.Left);
        return true;
    }
    if (keyutil.checkKeyPressed(waveEvent, "Ctrl:Shift:ArrowRight")) {
        switchBlockInDirection(tabId, NavigateDirection.Right);
        return true;
    }
    if (keyutil.checkKeyPressed(waveEvent, "Cmd:w")) {
        // close block, if no more blocks, close tab
        genericClose(tabId);
        return true;
    }
    return false;
}

export { appHandleKeyDown, appHandleKeyUp };
