// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms, createBlock, getViewModel, globalStore, setBlockFocus, WOS } from "@/app/store/global";
import { deleteLayoutModelForTab, getLayoutModelForTab } from "@/layout/index";
import * as services from "@/store/services";
import * as keyutil from "@/util/keyutil";
import * as jotai from "jotai";

const simpleControlShiftAtom = jotai.atom(false);
const transformRegexp = /translate3d\(\s*([0-9.]+)px\s*,\s*([0-9.]+)px,\s*0\)/;

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
    // close block
    const activeBlockId = globalStore.get(atoms.waveWindow)?.activeblockid;
    if (activeBlockId == null) {
        return;
    }
    const layoutModel = getLayoutModelForTab(tabAtom);
    const curBlockLeafId = layoutModel.getNodeByBlockId(activeBlockId)?.id;
    layoutModel.closeNodeById(curBlockLeafId);
}

function switchBlockIdx(index: number) {
    const tabId = globalStore.get(atoms.activeTabId);
    const tabAtom = WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId));
    const layoutModel = getLayoutModelForTab(tabAtom);
    if (!layoutModel) {
        return;
    }
    const leafsOrdered = globalStore.get(layoutModel.leafsOrdered);
    const newLeafIdx = index - 1;
    if (newLeafIdx < 0 || newLeafIdx >= leafsOrdered.length) {
        return;
    }
    const leaf = leafsOrdered[newLeafIdx];
    if (leaf?.data?.blockId == null) {
        return;
    }
    setBlockFocus(leaf.data.blockId);
}

function getCenter(dimensions: Dimensions): Point {
    return {
        x: dimensions.left + dimensions.width / 2,
        y: dimensions.top + dimensions.height / 2,
    };
}

function findBlockAtPoint(m: Map<string, Dimensions>, p: Point): string {
    for (const [blockId, dimension] of m.entries()) {
        if (
            p.x >= dimension.left &&
            p.x <= dimension.left + dimension.width &&
            p.y >= dimension.top &&
            p.y <= dimension.top + dimension.height
        ) {
            return blockId;
        }
    }
    return null;
}

function switchBlock(tabId: string, offsetX: number, offsetY: number) {
    console.log("switch block", offsetX, offsetY);
    if (offsetY == 0 && offsetX == 0) {
        return;
    }
    const tabAtom = WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId));
    const layoutModel = getLayoutModelForTab(tabAtom);
    const curBlockId = globalStore.get(atoms.waveWindow)?.activeblockid;
    const addlProps = globalStore.get(layoutModel.additionalProps);
    const blockPositions: Map<string, Dimensions> = new Map();
    const leafsOrdered = globalStore.get(layoutModel.leafsOrdered);
    for (const leaf of leafsOrdered) {
        const pos = addlProps[leaf.id]?.rect;
        if (pos) {
            blockPositions.set(leaf.data.blockId, pos);
        }
    }
    const curBlockPos = blockPositions.get(curBlockId);
    if (!curBlockPos) {
        return;
    }
    blockPositions.delete(curBlockId);
    const boundingRect = layoutModel.displayContainerRef?.current.getBoundingClientRect();
    if (!boundingRect) {
        return;
    }
    const maxX = boundingRect.left + boundingRect.width;
    const maxY = boundingRect.top + boundingRect.height;
    const moveAmount = 10;
    const curPoint = getCenter(curBlockPos);
    while (true) {
        console.log("nextPoint", curPoint, curBlockPos);
        curPoint.x += offsetX * moveAmount;
        curPoint.y += offsetY * moveAmount;
        if (curPoint.x < 0 || curPoint.x > maxX || curPoint.y < 0 || curPoint.y > maxY) {
            return;
        }
        const blockId = findBlockAtPoint(blockPositions, curPoint);
        if (blockId != null) {
            setBlockFocus(blockId);
            return;
        }
    }
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
    console.log("switching tabs", tabIdx, newTabIdx, activeTabId, newActiveTabId, ws.tabids);
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

async function handleCmdT() {
    const termBlockDef: BlockDef = {
        meta: {
            view: "term",
            controller: "shell",
        },
    };
    const tabId = globalStore.get(atoms.activeTabId);
    const win = globalStore.get(atoms.waveWindow);
    if (win?.activeblockid != null) {
        const blockAtom = WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", win.activeblockid));
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
    const newBlockId = await createBlock(termBlockDef);
    setBlockFocus(newBlockId);
}

function handleCmdI() {
    const waveWindow = globalStore.get(atoms.waveWindow);
    if (waveWindow == null) {
        return;
    }
    let activeBlockId = waveWindow.activeblockid;
    if (activeBlockId == null) {
        // get the first block
        const tabData = globalStore.get(atoms.tabAtom);
        const firstBlockId = tabData.blockids?.length == 0 ? null : tabData.blockids[0];
        if (firstBlockId == null) {
            return;
        }
        activeBlockId = firstBlockId;
    }
    const viewModel = getViewModel(activeBlockId);
    viewModel?.giveFocus?.();
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
        handleCmdT();
        return true;
    }
    if (keyutil.checkKeyPressed(waveEvent, "Cmd:i")) {
        handleCmdI();
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
            switchBlockIdx(idx);
            return true;
        }
    }
    if (keyutil.checkKeyPressed(waveEvent, "Ctrl:Shift:ArrowUp")) {
        switchBlock(tabId, 0, -1);
        return true;
    }
    if (keyutil.checkKeyPressed(waveEvent, "Ctrl:Shift:ArrowDown")) {
        switchBlock(tabId, 0, 1);
        return true;
    }
    if (keyutil.checkKeyPressed(waveEvent, "Ctrl:Shift:ArrowLeft")) {
        switchBlock(tabId, -1, 0);
        return true;
    }
    if (keyutil.checkKeyPressed(waveEvent, "Ctrl:Shift:ArrowRight")) {
        switchBlock(tabId, 1, 0);
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
