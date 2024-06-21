// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Workspace } from "@/app/workspace/workspace";
import { getLayoutStateAtomForTab, globalLayoutTransformsMap } from "@/faraday/lib/layoutAtom";
import type { LayoutTreeState } from "@/faraday/lib/model";
import { WOS, atoms, getApi, globalStore, setBlockFocus } from "@/store/global";
import * as services from "@/store/services";
import * as keyutil from "@/util/keyutil";
import * as util from "@/util/util";
import * as jotai from "jotai";
import * as React from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { CenteredDiv } from "./element/quickelems";

import "overlayscrollbars/overlayscrollbars.css";
import "./app.less";

const App = () => {
    let Provider = jotai.Provider;
    return (
        <Provider store={globalStore}>
            <AppInner />
        </Provider>
    );
};

function handleContextMenu(e: React.MouseEvent<HTMLDivElement>) {
    let isInNonTermInput = false;
    const activeElem = document.activeElement;
    if (activeElem != null && activeElem.nodeName == "TEXTAREA") {
        if (!activeElem.classList.contains("xterm-helper-textarea")) {
            isInNonTermInput = true;
        }
    }
    if (activeElem != null && activeElem.nodeName == "INPUT" && activeElem.getAttribute("type") == "text") {
        isInNonTermInput = true;
    }
    const opts: ContextMenuOpts = {};
    if (isInNonTermInput) {
        opts.showCut = true;
    }
    const sel = window.getSelection();
    if (!util.isBlank(sel?.toString()) || isInNonTermInput) {
        getApi().contextEditMenu({ x: e.clientX, y: e.clientY }, opts);
    } else {
        getApi().contextEditMenu({ x: e.clientX, y: e.clientY }, { onlyPaste: true });
    }
}

function switchTab(offset: number) {
    console.log("switch tab!", offset);
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
    tabIdx = (tabIdx + offset) % ws.tabids.length;
    const newActiveTabId = ws.tabids[tabIdx];
    services.ObjectService.SetActiveTab(newActiveTabId);
}

function findLeafIdFromBlockId(layoutTree: LayoutTreeState<TabLayoutData>, blockId: string): string {
    if (layoutTree?.leafs == null) {
        return null;
    }
    for (let leaf of layoutTree.leafs) {
        if (leaf.data.blockId == blockId) {
            return leaf.id;
        }
    }
    return null;
}

var transformRegexp = /translate\(\s*([0-9.]+)px\s*,\s*([0-9.]+)px\)/;

function parseFloatFromCSS(s: string | number): number {
    if (typeof s == "number") {
        return s;
    }
    return parseFloat(s);
}

function readBoundsFromTransform(fullTransform: React.CSSProperties): Bounds {
    const transformProp = fullTransform.transform;
    if (transformProp == null || fullTransform.width == null || fullTransform.height == null) {
        return null;
    }
    const m = transformRegexp.exec(transformProp);
    if (m == null) {
        return null;
    }
    return {
        x: parseFloat(m[1]),
        y: parseFloat(m[2]),
        width: parseFloatFromCSS(fullTransform.width),
        height: parseFloatFromCSS(fullTransform.height),
    };
}

function boundsMapMaxX(m: Map<string, Bounds>): number {
    let max = 0;
    for (let p of m.values()) {
        if (p.x + p.width > max) {
            max = p.x + p.width;
        }
    }
    return max;
}

function boundsMapMaxY(m: Map<string, Bounds>): number {
    let max = 0;
    for (let p of m.values()) {
        if (p.y + p.height > max) {
            max = p.y + p.height;
        }
    }
    return max;
}

function findBlockAtPoint(m: Map<string, Bounds>, p: Point): string {
    for (let [blockId, bounds] of m.entries()) {
        if (p.x >= bounds.x && p.x <= bounds.x + bounds.width && p.y >= bounds.y && p.y <= bounds.y + bounds.height) {
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
    const transforms = globalLayoutTransformsMap.get(tabId);
    if (transforms == null) {
        return;
    }
    const layoutTreeState = globalStore.get(getLayoutStateAtomForTab(tabId, tabAtom));
    const curBlockId = globalStore.get(atoms.waveWindow).activeblockid;
    const curBlockLeafId = findLeafIdFromBlockId(layoutTreeState, curBlockId);
    if (curBlockLeafId == null) {
        return;
    }
    const blockPos = readBoundsFromTransform(transforms[curBlockLeafId]);
    if (blockPos == null) {
        return;
    }
    var blockPositions: Map<string, Bounds> = new Map();
    for (let leaf of layoutTreeState.leafs) {
        if (leaf.id == curBlockLeafId) {
            continue;
        }
        const pos = readBoundsFromTransform(transforms[leaf.id]);
        if (pos != null) {
            blockPositions.set(leaf.data.blockId, pos);
        }
    }
    const maxX = boundsMapMaxX(blockPositions);
    const maxY = boundsMapMaxY(blockPositions);
    const moveAmount = 10;
    let curX = blockPos.x + 1;
    let curY = blockPos.y + 1;
    while (true) {
        curX += offsetX * moveAmount;
        curY += offsetY * moveAmount;
        if (curX < 0 || curX > maxX || curY < 0 || curY > maxY) {
            return;
        }
        const blockId = findBlockAtPoint(blockPositions, { x: curX, y: curY });
        if (blockId != null) {
            setBlockFocus(blockId);
            return;
        }
    }
}

const AppInner = () => {
    const client = jotai.useAtomValue(atoms.client);
    const windowData = jotai.useAtomValue(atoms.waveWindow);
    const tabId = jotai.useAtomValue(atoms.activeTabId);
    if (client == null || windowData == null) {
        return (
            <div className="mainapp">
                <div className="titlebar"></div>
                <CenteredDiv>invalid configuration, client or window was not loaded</CenteredDiv>
            </div>
        );
    }
    function handleKeyDown(ev: KeyboardEvent) {
        let waveEvent = keyutil.adaptFromReactOrNativeKeyEvent(ev);
        const rtn = handleKeyDownInternal(waveEvent);
        if (rtn) {
            ev.preventDefault();
            ev.stopPropagation();
        }
    }
    function handleKeyDownInternal(waveEvent: WaveKeyboardEvent): boolean {
        // global key handler for now (refactor later)
        if (keyutil.checkKeyPressed(waveEvent, "Cmd:]")) {
            switchTab(1);
            return true;
        }
        if (keyutil.checkKeyPressed(waveEvent, "Cmd:[")) {
            switchTab(-1);
            return true;
        }
        if (keyutil.checkKeyPressed(waveEvent, "Cmd:ArrowUp")) {
            switchBlock(tabId, 0, -1);
            return true;
        }
        if (keyutil.checkKeyPressed(waveEvent, "Cmd:ArrowDown")) {
            switchBlock(tabId, 0, 1);
            return true;
        }
        if (keyutil.checkKeyPressed(waveEvent, "Cmd:ArrowLeft")) {
            switchBlock(tabId, -1, 0);
            return true;
        }
        if (keyutil.checkKeyPressed(waveEvent, "Cmd:ArrowRight")) {
            switchBlock(tabId, 1, 0);
            return true;
        }
        return false;
    }
    React.useEffect(() => {
        const staticKeyDownHandler = handleKeyDown;
        document.addEventListener("keydown", staticKeyDownHandler);
        return () => {
            document.removeEventListener("keydown", staticKeyDownHandler);
        };
    }, []);
    return (
        <div className="mainapp" onContextMenu={handleContextMenu}>
            <DndProvider backend={HTML5Backend}>
                <div className="titlebar"></div>
                <Workspace />
            </DndProvider>
        </div>
    );
};

export { App };
