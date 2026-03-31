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
import { isWindows } from "@/util/platformutil";
import { CHORD_TIMEOUT } from "@/util/sharedconst";
import { fireAndForget } from "@/util/util";
import * as jotai from "jotai";
import { modalsModel } from "./modalmodel";
import { isBuilderWindow, isTabWindow } from "./windowtype";

type KeyHandler = (event: WaveKeyboardEvent) => boolean;

type KeybindingEntry = {
    key: string | null;
    command: string;
};

type ActionDef = {
    id: string;
    defaultKeys: string[];
    handler: KeyHandler;
};

type ChordActionDef = {
    id: string;
    parentId: string;
    defaultKey: string;
    handler: KeyHandler;
};

type KeyMapEntry<T = KeyHandler> = { key: string; handler: T | null };
type ChordEntry = { key: string; subKeys: KeyMapEntry[] };

const simpleControlShiftAtom = jotai.atom(false);
let globalKeyBindings: KeyMapEntry[] = [];
let globalChordBindings: ChordEntry[] = [];
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

function cycleBlockFocus(delta: 1 | -1) {
    const layoutModel = getLayoutModelForStaticTab();
    if (!layoutModel) {
        return;
    }
    const leafOrder = globalStore.get(layoutModel.leafOrder);
    if (leafOrder.length === 0) {
        return;
    }
    const focusedNodeId = layoutModel.focusedNodeId;
    const curIdx = leafOrder.findIndex((e) => e.nodeid === focusedNodeId);
    const nextIdx = (curIdx + delta + leafOrder.length) % leafOrder.length;
    layoutModel.focusNode(leafOrder[nextIdx].nodeid);
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

// returns [keymatch, T] — iterates in reverse so later entries (user overrides) win
// a null handler means the key was explicitly unbound (via -command)
function checkKeyArray<T>(waveEvent: WaveKeyboardEvent, entries: KeyMapEntry<T>[]): [string, T] {
    for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        if (keyutil.checkKeyPressed(waveEvent, entry.key)) {
            if (entry.handler == null) {
                return [null, null]; // unbound
            }
            return [entry.key, entry.handler];
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
        // If we're in chord mode, look for the second key in the matching chord's sub-keys.
        const chordEntry = globalChordBindings.find((c) => c.key === activeChord);
        if (chordEntry) {
            const [, handler] = checkKeyArray(waveEvent, chordEntry.subKeys);
            if (handler) {
                resetChord();
                return handler(waveEvent);
            }
        }
        // invalid chord; reset state and consume key
        resetChord();
        return true;
    }
    // Check if this key initiates a chord
    for (const chord of globalChordBindings) {
        if (keyutil.checkKeyPressed(waveEvent, chord.key)) {
            setActiveChord(chord.key);
            return true;
        }
    }

    const [, globalHandler] = checkKeyArray(waveEvent, globalKeyBindings);
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

function activateSearch(event: WaveKeyboardEvent): boolean {
    const bcm = getBlockComponentModel(getFocusedBlockInStaticTab());
    // Ctrl+f is reserved in most shells
    if (event.control && bcm.viewModel.viewType == "term") {
        return false;
    }
    if (bcm.viewModel.searchAtoms) {
        if (globalStore.get(bcm.viewModel.searchAtoms.isOpen)) {
            // Already open — increment the focusInput counter so this block's
            // SearchComponent focuses its own input (avoids a global DOM query
            // that could target the wrong block when multiple searches are open).
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
    if (bcm.viewModel.searchAtoms && globalStore.get(bcm.viewModel.searchAtoms.isOpen)) {
        globalStore.set(bcm.viewModel.searchAtoms.isOpen, false);
        return true;
    }
    return false;
}

function makeBlockNavHandler(direction: NavigateDirection): KeyHandler {
    return () => {
        const disableCtrlShiftArrows = globalStore.get(getSettingsKeyAtom("app:disablectrlshiftarrows"));
        if (disableCtrlShiftArrows) {
            return false;
        }
        switchBlockInDirection(direction);
        return true;
    };
}

const defaultActions: ActionDef[] = [
    {
        id: "tab:next",
        defaultKeys: ["Cmd:]", "Shift:Cmd:]"],
        handler: () => {
            switchTab(1);
            return true;
        },
    },
    {
        id: "tab:prev",
        defaultKeys: ["Cmd:[", "Shift:Cmd:["],
        handler: () => {
            switchTab(-1);
            return true;
        },
    },
    {
        id: "block:new",
        defaultKeys: ["Cmd:n"],
        handler: () => {
            handleCmdN();
            return true;
        },
    },
    {
        id: "block:splitright",
        defaultKeys: ["Cmd:d"],
        handler: () => {
            handleSplitHorizontal("after");
            return true;
        },
    },
    {
        id: "block:splitdown",
        defaultKeys: ["Shift:Cmd:d"],
        handler: () => {
            handleSplitVertical("after");
            return true;
        },
    },
    {
        id: "block:refocus",
        defaultKeys: ["Cmd:i"],
        handler: () => {
            handleCmdI();
            return true;
        },
    },
    {
        id: "tab:new",
        defaultKeys: ["Cmd:t"],
        handler: () => {
            createTab();
            return true;
        },
    },
    {
        id: "block:close",
        defaultKeys: ["Cmd:w"],
        handler: () => {
            genericClose();
            return true;
        },
    },
    {
        id: "tab:close",
        defaultKeys: ["Cmd:Shift:w"],
        handler: () => {
            simpleCloseStaticTab();
            return true;
        },
    },
    {
        id: "block:magnify",
        defaultKeys: ["Cmd:m"],
        handler: () => {
            const layoutModel = getLayoutModelForStaticTab();
            const focusedNode = globalStore.get(layoutModel.focusedNode);
            if (focusedNode != null) {
                layoutModel.magnifyNodeToggle(focusedNode.id);
            }
            return true;
        },
    },
    {
        id: "block:navup",
        defaultKeys: ["Ctrl:Shift:ArrowUp", "Ctrl:Shift:k"],
        handler: makeBlockNavHandler(NavigateDirection.Up),
    },
    {
        id: "block:navdown",
        defaultKeys: ["Ctrl:Shift:ArrowDown", "Ctrl:Shift:j"],
        handler: makeBlockNavHandler(NavigateDirection.Down),
    },
    {
        id: "block:navleft",
        defaultKeys: ["Ctrl:Shift:ArrowLeft", "Ctrl:Shift:h"],
        handler: makeBlockNavHandler(NavigateDirection.Left),
    },
    {
        id: "block:navright",
        defaultKeys: ["Ctrl:Shift:ArrowRight", "Ctrl:Shift:l"],
        handler: makeBlockNavHandler(NavigateDirection.Right),
    },
    {
        id: "block:navcw",
        defaultKeys: ["Ctrl:Shift:]"],
        handler: () => {
            cycleBlockFocus(1);
            return true;
        },
    },
    {
        id: "block:navccw",
        defaultKeys: ["Ctrl:Shift:["],
        handler: () => {
            cycleBlockFocus(-1);
            return true;
        },
    },
    {
        id: "block:replacewithlauncher",
        defaultKeys: ["Ctrl:Shift:x"],
        handler: () => {
            const blockId = getFocusedBlockId();
            if (blockId == null) {
                return true;
            }
            replaceBlock(
                blockId,
                {
                    meta: {
                        view: "launcher",
                    },
                },
                true
            );
            return true;
        },
    },
    {
        id: "app:openconnection",
        defaultKeys: ["Cmd:g"],
        handler: () => {
            const bcm = getBlockComponentModel(getFocusedBlockInStaticTab());
            if (bcm.openSwitchConnection != null) {
                recordTEvent("action:other", { "action:type": "conndropdown", "action:initiator": "keyboard" });
                bcm.openSwitchConnection();
                return true;
            }
            return false;
        },
    },
    {
        id: "term:togglemultiinput",
        defaultKeys: ["Ctrl:Shift:i"],
        handler: () => {
            const tabModel = getActiveTabModel();
            if (tabModel == null) {
                return true;
            }
            const curMI = globalStore.get(tabModel.isTermMultiInput);
            if (!curMI && countTermBlocks() <= 1) {
                // don't turn on multi-input unless there are 2 or more basic term blocks
                return true;
            }
            globalStore.set(tabModel.isTermMultiInput, !curMI);
            return true;
        },
    },
    {
        id: "app:search",
        defaultKeys: ["Cmd:f"],
        handler: activateSearch,
    },
    {
        id: "generic:cancel",
        defaultKeys: ["Escape"],
        handler: () => {
            if (modalsModel.hasOpenModals()) {
                modalsModel.popModal();
                return true;
            }
            if (deactivateSearch()) {
                return true;
            }
            return false;
        },
    },
    {
        id: "app:toggleaipanel",
        defaultKeys: ["Cmd:Shift:a"],
        handler: () => {
            const currentVisible = WorkspaceLayoutModel.getInstance().getAIPanelVisible();
            WorkspaceLayoutModel.getInstance().setAIPanelVisible(!currentVisible);
            return true;
        },
    },
    {
        id: "app:togglewidgetssidebar",
        defaultKeys: ["Cmd:b"],
        handler: () => {
            const current = WorkspaceLayoutModel.getInstance().getWidgetsSidebarVisible();
            WorkspaceLayoutModel.getInstance().setWidgetsSidebarVisible(!current);
            return true;
        },
    },
    {
        id: "app:settings",
        defaultKeys: ["Cmd:,"],
        handler: () => {
            fireAndForget(async () => {
                await createBlock({ meta: { view: "waveconfig" } }, false, true);
            });
            return true;
        },
    },
    // Numbered tab/block switch keys (1-9)
    ...Array.from({ length: 9 }, (_, i) => {
        const idx = i + 1;
        return [
            {
                id: `tab:switchto${idx}`,
                defaultKeys: [`Cmd:${idx}`],
                handler: () => {
                    switchTabAbs(idx);
                    return true;
                },
            } as ActionDef,
            {
                id: `block:switchto${idx}`,
                defaultKeys: [`Ctrl:Shift:c{Digit${idx}}`, `Ctrl:Shift:c{Numpad${idx}}`],
                handler: () => {
                    switchBlockByBlockNum(idx);
                    return true;
                },
            } as ActionDef,
        ];
    }).flat(),
    // AI focus (block 0) — platform-dependent keys
    {
        id: "block:switchtoai",
        defaultKeys: isWindows()
            ? ["Alt:c{Digit0}", "Alt:c{Numpad0}"]
            : ["Ctrl:Shift:c{Digit0}", "Ctrl:Shift:c{Numpad0}"],
        handler: () => {
            WaveAIModel.getInstance().focusInput();
            return true;
        },
    },
    // Chord initiator for block splitting
    {
        id: "block:splitchord",
        defaultKeys: ["Ctrl:Shift:s"],
        handler: () => true,
    },
];

const defaultChordActions: ChordActionDef[] = [
    {
        id: "block:splitchordup",
        parentId: "block:splitchord",
        defaultKey: "ArrowUp",
        handler: () => {
            handleSplitVertical("before");
            return true;
        },
    },
    {
        id: "block:splitchorddown",
        parentId: "block:splitchord",
        defaultKey: "ArrowDown",
        handler: () => {
            handleSplitVertical("after");
            return true;
        },
    },
    {
        id: "block:splitchordleft",
        parentId: "block:splitchord",
        defaultKey: "ArrowLeft",
        handler: () => {
            handleSplitHorizontal("before");
            return true;
        },
    },
    {
        id: "block:splitchordright",
        parentId: "block:splitchord",
        defaultKey: "ArrowRight",
        handler: () => {
            handleSplitHorizontal("after");
            return true;
        },
    },
];

function buildKeyMaps(userOverrides: KeybindingEntry[]): void {
    // 1. Start with default bindings as array entries (key -> handler)
    const bindings: KeyMapEntry[] = [];
    const chordBindings: ChordEntry[] = [];

    // Track which action IDs map to which handler (for user overrides)
    const actionHandlers = new Map<string, KeyHandler>();
    for (const action of defaultActions) {
        actionHandlers.set(action.id, action.handler);
        for (const key of action.defaultKeys) {
            bindings.push({ key, handler: action.handler });
        }
    }

    // 2. Build chord bindings from defaults
    const chordInitiatorAction = defaultActions.find((a) => a.id === "block:splitchord");
    if (chordInitiatorAction) {
        const subKeys: KeyMapEntry[] = [];
        for (const chordDef of defaultChordActions) {
            if (chordDef.parentId === "block:splitchord") {
                actionHandlers.set(chordDef.id, chordDef.handler);
                subKeys.push({ key: chordDef.defaultKey, handler: chordDef.handler });
            }
        }
        for (const key of chordInitiatorAction.defaultKeys) {
            chordBindings.push({ key, subKeys: [...subKeys] });
        }
    }

    // 3. Apply user overrides — append to array (last wins via reverse iteration)
    for (const override of userOverrides) {
        if (!override.command || typeof override.command !== "string") {
            console.warn("Skipping keybinding entry with missing/invalid command");
            continue;
        }
        if (override.key != null && typeof override.key !== "string") {
            console.warn(`Skipping keybinding entry with invalid key type for command: ${override.command}`);
            continue;
        }
        // Handle -command unbinding (VSCode convention)
        if (override.command.startsWith("-")) {
            const commandId = override.command.substring(1);
            const action = defaultActions.find((a) => a.id === commandId);
            if (action) {
                // Append null-handler entries for all default keys to shadow them
                for (const key of action.defaultKeys) {
                    bindings.push({ key, handler: null });
                }
            }
            continue;
        }
        const commandId = override.command;
        if (override.key == null) {
            // null key = unbind all default keys for this command
            const action = defaultActions.find((a) => a.id === commandId);
            if (action) {
                for (const key of action.defaultKeys) {
                    bindings.push({ key, handler: null });
                }
            }
            continue;
        }
        const handler = actionHandlers.get(commandId);
        if (handler) {
            bindings.push({ key: override.key, handler });
        } else {
            console.warn(`Unknown keybinding action: ${commandId}`);
        }
    }

    // 4. Assign to globals
    globalKeyBindings = bindings;
    globalChordBindings = chordBindings;

    // 5. Re-register with Electron
    const allKeys = globalKeyBindings.map((e) => e.key);
    for (const chord of globalChordBindings) {
        allKeys.push(chord.key);
    }
    // Special web view keys
    allKeys.push("Cmd:l", "Cmd:r", "Cmd:ArrowRight", "Cmd:ArrowLeft", "Cmd:o");
    getApi().registerGlobalWebviewKeys(allKeys);
}

function registerGlobalKeys() {
    buildKeyMaps([]);
}

function initKeybindingsWatcher() {
    globalStore.sub(atoms.keybindingsAtom, () => {
        buildKeyMaps(globalStore.get(atoms.keybindingsAtom));
    });
}

function registerBuilderGlobalKeys() {
    globalKeyBindings.push({
        key: "Cmd:w",
        handler: () => {
            getApi().closeBuilderWindow();
            return true;
        },
    });
    const allKeys = globalKeyBindings.map((e) => e.key);
    getApi().registerGlobalWebviewKeys(allKeys);
}

function getAllGlobalKeyBindings(): string[] {
    return globalKeyBindings.map((e) => e.key);
}

export {
    appHandleKeyDown,
    buildKeyMaps,
    disableGlobalKeybindings,
    enableGlobalKeybindings,
    getSimpleControlShiftAtom,
    globalRefocus,
    globalRefocusWithTimeout,
    initKeybindingsWatcher,
    registerBuilderGlobalKeys,
    registerControlShiftStateUpdateHandler,
    registerElectronReinjectKeyHandler,
    registerGlobalKeys,
    tryReinjectKey,
    unsetControlShift,
    uxCloseBlock,
};
