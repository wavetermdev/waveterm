// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import {
    getLayoutModelForStaticTab,
    LayoutTreeActionType,
    LayoutTreeInsertNodeAction,
    newLayoutNode,
} from "@/layout/index";
import {
    LayoutTreeReplaceNodeAction,
    LayoutTreeSplitHorizontalAction,
    LayoutTreeSplitVerticalAction,
} from "@/layout/lib/types";
import { getWebServerEndpoint } from "@/util/endpoints";
import { fetch } from "@/util/fetchutil";
import { setPlatform } from "@/util/platformutil";
import {
    base64ToString,
    deepCompareReturnPrev,
    fireAndForget,
    getPrefixedSettings,
    isBlank,
    isLocalConnName,
    isWslConnName,
    NullAtom,
} from "@/util/util";
import { atom, Atom, PrimitiveAtom, useAtomValue } from "jotai";
import { setupBadgesSubscription } from "./badge";
import { atoms, blockComponentModelMap, ConnStatusMapAtom, initGlobalAtoms, orefAtomCache } from "./global-atoms";
import { globalStore } from "./jotaiStore";
import { modalsModel } from "./modalmodel";
import { ClientService, ObjectService } from "./services";
import { isPreviewWindow } from "./windowtype";
import * as WOS from "./wos";
import { getFileSubject, waveEventSubscribeSingle } from "./wps";

let globalPrimaryTabStartup: boolean = false;

function initGlobal(initOpts: GlobalInitOptions) {
    globalPrimaryTabStartup = initOpts.primaryTabStartup ?? false;
    setPlatform(initOpts.platform);
    initGlobalAtoms(initOpts);
    try {
        getApi().onMenuItemAbout(() => {
            modalsModel.pushModal("AboutModal");
        });
    } catch (e) {
        console.log("failed to initialize onMenuItemAbout handler", e);
    }
}

function initGlobalWaveEventSubs(initOpts: WaveInitOpts) {
    waveEventSubscribeSingle({
        eventType: "waveobj:update",
        handler: (event) => {
            // console.log("waveobj:update wave event handler", event);
            WOS.updateWaveObject(event.data);
        },
    });
    waveEventSubscribeSingle({
        eventType: "config",
        handler: (event) => {
            // console.log("config wave event handler", event);
            globalStore.set(atoms.fullConfigAtom, event.data.fullconfig);
        },
    });
    waveEventSubscribeSingle({
        eventType: "userinput",
        handler: (event) => {
            const connName = event.data?.connname;
            if (connName) {
                modalsModel.upsertUserInputPrompt(connName, "UserInputPrompt", { ...event.data });
            } else {
                console.log("[PW-EVENT] userinput event has no connName, using empty key", event.data);
                modalsModel.upsertUserInputPrompt("", "UserInputPrompt", { ...event.data });
            }
        },
        scope: initOpts.windowId,
    });
    waveEventSubscribeSingle({
        eventType: "blockfile",
        handler: (event) => {
            // console.log("blockfile event update", event);
            const fileSubject = getFileSubject(event.data.zoneid, event.data.filename);
            if (fileSubject != null) {
                fileSubject.next(event.data);
            }
        },
    });
    setupBadgesSubscription();
}

const blockCache = new Map<string, Map<string, any>>();

function useBlockCache<T>(blockId: string, name: string, makeFn: () => T): T {
    let blockMap = blockCache.get(blockId);
    if (blockMap == null) {
        blockMap = new Map<string, any>();
        blockCache.set(blockId, blockMap);
    }
    let value = blockMap.get(name);
    if (value == null) {
        value = makeFn();
        blockMap.set(name, value);
    }
    return value as T;
}

function getBlockMetaKeyAtom<T extends keyof MetaType>(blockId: string, key: T): Atom<MetaType[T]> {
    const blockCache = getSingleBlockAtomCache(blockId);
    const metaAtomName = "#meta-" + key;
    let metaAtom = blockCache.get(metaAtomName);
    if (metaAtom != null) {
        return metaAtom;
    }
    metaAtom = atom((get) => {
        const blockAtom = WOS.getWaveObjectAtom(WOS.makeORef("block", blockId));
        const blockData = get(blockAtom);
        return blockData?.meta?.[key];
    });
    blockCache.set(metaAtomName, metaAtom);
    return metaAtom;
}

function getTabMetaKeyAtom<T extends keyof MetaType>(tabId: string, key: T): Atom<MetaType[T]> {
    return getOrefMetaKeyAtom(WOS.makeORef("tab", tabId), key);
}

function getOrefMetaKeyAtom<T extends keyof MetaType>(oref: string, key: T): Atom<MetaType[T]> {
    const orefCache = getSingleOrefAtomCache(oref);
    const metaAtomName = "#meta-" + key;
    let metaAtom = orefCache.get(metaAtomName);
    if (metaAtom != null) {
        return metaAtom;
    }
    metaAtom = atom((get) => {
        const objAtom = WOS.getWaveObjectAtom(oref);
        const objData = get(objAtom);
        return objData?.meta?.[key];
    });
    orefCache.set(metaAtomName, metaAtom);
    return metaAtom;
}

function useOrefMetaKeyAtom<T extends keyof MetaType>(oref: string, key: T): MetaType[T] {
    return useAtomValue(getOrefMetaKeyAtom(oref, key));
}

function getConnConfigKeyAtom<T extends keyof ConnKeywords>(connName: string, key: T): Atom<ConnKeywords[T]> {
    if (isPreviewWindow()) return NullAtom as Atom<ConnKeywords[T]>;
    const connCache = getSingleConnAtomCache(connName);
    const keyAtomName = "#conn-" + key;
    let keyAtom = connCache.get(keyAtomName);
    if (keyAtom != null) {
        return keyAtom;
    }
    keyAtom = atom((get) => {
        const fullConfig = get(atoms.fullConfigAtom);
        return fullConfig.connections?.[connName]?.[key];
    });
    connCache.set(keyAtomName, keyAtom);
    return keyAtom;
}

const settingsAtomCache = new Map<string, Atom<any>>();

function getOverrideConfigAtom<T extends keyof SettingsType>(blockId: string, key: T): Atom<SettingsType[T]> {
    if (isPreviewWindow()) return NullAtom as Atom<SettingsType[T]>;
    const blockCache = getSingleBlockAtomCache(blockId);
    const overrideAtomName = "#settingsoverride-" + key;
    let overrideAtom = blockCache.get(overrideAtomName);
    if (overrideAtom != null) {
        return overrideAtom;
    }
    overrideAtom = atom((get) => {
        const blockMetaKeyAtom = getBlockMetaKeyAtom(blockId, key as any);
        const metaKeyVal = get(blockMetaKeyAtom);
        if (metaKeyVal != null) {
            return metaKeyVal;
        }
        const connNameAtom = getBlockMetaKeyAtom(blockId, "connection");
        const connName = get(connNameAtom);
        const connConfigKeyAtom = getConnConfigKeyAtom(connName, key as any);
        const connConfigKeyVal = get(connConfigKeyAtom);
        if (connConfigKeyVal != null) {
            return connConfigKeyVal;
        }
        const settingsKeyAtom = getSettingsKeyAtom(key);
        const settingsVal = get(settingsKeyAtom);
        if (settingsVal != null) {
            return settingsVal;
        }
        return null;
    });
    blockCache.set(overrideAtomName, overrideAtom);
    return overrideAtom;
}

function useOverrideConfigAtom<T extends keyof SettingsType>(blockId: string | null, key: T): SettingsType[T] {
    if (blockId == null) {
        return useAtomValue(getSettingsKeyAtom(key));
    }
    return useAtomValue(getOverrideConfigAtom(blockId, key));
}

function getSettingsKeyAtom<T extends keyof SettingsType>(key: T): Atom<SettingsType[T]> {
    if (isPreviewWindow()) return NullAtom as Atom<SettingsType[T]>;
    let settingsKeyAtom = settingsAtomCache.get(key) as Atom<SettingsType[T]>;
    if (settingsKeyAtom == null) {
        settingsKeyAtom = atom((get) => {
            const settings = get(atoms.settingsAtom);
            if (settings == null) {
                return null;
            }
            return settings[key];
        });
        settingsAtomCache.set(key, settingsKeyAtom);
    }
    return settingsKeyAtom;
}

function useSettingsKeyAtom<T extends keyof SettingsType>(key: T): SettingsType[T] {
    return useAtomValue(getSettingsKeyAtom(key));
}

const configBackgroundAtomCache = new Map<string, Atom<BackgroundConfigType>>();

function getConfigBackgroundAtom(bgKey: string | null): Atom<BackgroundConfigType> {
    if (isPreviewWindow() || bgKey == null) return NullAtom as Atom<BackgroundConfigType>;
    let bgAtom = configBackgroundAtomCache.get(bgKey);
    if (bgAtom == null) {
        bgAtom = atom((get) => {
            const fullConfig = get(atoms.fullConfigAtom);
            return fullConfig.backgrounds?.[bgKey];
        });
        configBackgroundAtomCache.set(bgKey, bgAtom);
    }
    return bgAtom;
}

function getSettingsPrefixAtom(prefix: string): Atom<SettingsType> {
    if (isPreviewWindow()) return NullAtom as Atom<SettingsType>;
    let settingsPrefixAtom = settingsAtomCache.get(prefix + ":");
    if (settingsPrefixAtom == null) {
        // create a stable, closured reference to use as the deepCompareReturnPrev key
        const cacheKey = {};
        settingsPrefixAtom = atom((get) => {
            const settings = get(atoms.settingsAtom);
            const newValue = getPrefixedSettings(settings, prefix);
            return deepCompareReturnPrev(cacheKey, newValue);
        });
        settingsAtomCache.set(prefix + ":", settingsPrefixAtom);
    }
    return settingsPrefixAtom;
}

function getSingleBlockAtomCache(blockId: string): Map<string, Atom<any>> {
    const blockORef = WOS.makeORef("block", blockId);
    return getSingleOrefAtomCache(blockORef);
}

function getSingleConnAtomCache(connName: string): Map<string, Atom<any>> {
    // this is not a real "oref", but it will work for the cache.
    const connORef = WOS.makeORef("conn", connName);
    return getSingleOrefAtomCache(connORef);
}

function getSingleOrefAtomCache(oref: string): Map<string, Atom<any>> {
    let orefCache = orefAtomCache.get(oref);
    if (orefCache == null) {
        orefCache = new Map<string, Atom<any>>();
        orefAtomCache.set(oref, orefCache);
    }
    return orefCache;
}

// this function should be kept up to date with IsBlockTermDurable in pkg/jobcontroller/jobcontroller.go
// Note: null/false both map to false in the Go code, but this returns a special null value
// to indicate when the block is not even eligible to be durable
function getBlockTermDurableAtom(blockId: string): Atom<null | boolean> {
    const blockCache = getSingleBlockAtomCache(blockId);
    const durableAtomName = "#termdurable";
    let durableAtom = blockCache.get(durableAtomName);
    if (durableAtom != null) {
        return durableAtom;
    }
    durableAtom = atom((get) => {
        const blockAtom = WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId));
        const block = get(blockAtom);

        if (block == null) {
            return null;
        }

        // Check if view is "term", and controller is "shell"
        if (block.meta?.view != "term" || block.meta?.controller != "shell") {
            return null;
        }

        // 1. Check if block has a JobId
        if (block.jobid != null && block.jobid != "") {
            return true;
        }

        // 2. Check if connection is local or WSL (not eligible for durability)
        const connName = block.meta?.connection ?? "";
        if (isLocalConnName(connName) || isWslConnName(connName)) {
            return null;
        }

        // 3. Check config hierarchy: blockmeta → connection → global (default true)
        const durableConfigAtom = getOverrideConfigAtom(blockId, "term:durable");
        const durableConfig = get(durableConfigAtom);
        if (durableConfig != null) {
            return durableConfig;
        }

        // Default to true for non-local connections
        return true;
    });
    blockCache.set(durableAtomName, durableAtom);
    return durableAtom;
}

export interface BlockUploadState {
    active: boolean;
    fileName: string;
    fileSize: number;
    // Bytes sent so far. When present, the overlay renders a determinate
    // percentage (sent/fileSize); when absent it shows an indeterminate spinner.
    sent?: number;
    // A terminal upload error, shown in the overlay in place of progress.
    // Auto-cleared by the caller after a short delay.
    error?: string;
}

const uploadStateAtoms = new Map<string, PrimitiveAtom<BlockUploadState | null>>();

function getBlockUploadStateAtom(blockId: string): PrimitiveAtom<BlockUploadState | null> {
    let uploadAtom = uploadStateAtoms.get(blockId);
    if (uploadAtom == null) {
        uploadAtom = atom<BlockUploadState | null>(null) as PrimitiveAtom<BlockUploadState | null>;
        uploadStateAtoms.set(blockId, uploadAtom);
    }
    return uploadAtom;
}

function setBlockUploadState(blockId: string, state: BlockUploadState | null) {
    const uploadAtom = getBlockUploadStateAtom(blockId);
    globalStore.set(uploadAtom, state);
}

function useBlockAtom<T>(blockId: string, name: string, makeFn: () => Atom<T>): Atom<T> {
    const blockCache = getSingleBlockAtomCache(blockId);
    let atom = blockCache.get(name);
    if (atom == null) {
        atom = makeFn();
        blockCache.set(name, atom);
    }
    return atom as Atom<T>;
}

/**
 * Safely read an atom value, returning null if the atom is null.
 */
function readAtom<T>(atom: Atom<T>): T {
    if (atom == null) {
        return null;
    }
    return globalStore.get(atom);
}

/**
 * Get the preload api.
 */
function getApi(): ElectronApi {
    return (window as any).api;
}

async function createBlockSplitHorizontally(
    blockDef: BlockDef,
    targetBlockId: string,
    position: "before" | "after"
): Promise<string> {
    const layoutModel = getLayoutModelForStaticTab();
    const rtOpts: RuntimeOpts = { termsize: { rows: 25, cols: 80 } };
    const newBlockId = await ObjectService.CreateBlock(blockDef, rtOpts);
    const targetNodeId = layoutModel.getNodeByBlockId(targetBlockId)?.id;
    if (targetNodeId == null) {
        throw new Error(`targetNodeId not found for blockId: ${targetBlockId}`);
    }
    const splitAction: LayoutTreeSplitHorizontalAction = {
        type: LayoutTreeActionType.SplitHorizontal,
        targetNodeId: targetNodeId,
        newNode: newLayoutNode(undefined, undefined, undefined, { blockId: newBlockId }),
        position: position,
        focused: true,
    };
    layoutModel.treeReducer(splitAction);
    return newBlockId;
}

async function createBlockSplitVertically(
    blockDef: BlockDef,
    targetBlockId: string,
    position: "before" | "after"
): Promise<string> {
    const layoutModel = getLayoutModelForStaticTab();
    const rtOpts: RuntimeOpts = { termsize: { rows: 25, cols: 80 } };
    const newBlockId = await ObjectService.CreateBlock(blockDef, rtOpts);
    const targetNodeId = layoutModel.getNodeByBlockId(targetBlockId)?.id;
    if (targetNodeId == null) {
        throw new Error(`targetNodeId not found for blockId: ${targetBlockId}`);
    }
    const splitAction: LayoutTreeSplitVerticalAction = {
        type: LayoutTreeActionType.SplitVertical,
        targetNodeId: targetNodeId,
        newNode: newLayoutNode(undefined, undefined, undefined, { blockId: newBlockId }),
        position: position,
        focused: true,
    };
    layoutModel.treeReducer(splitAction);
    return newBlockId;
}

async function createBlock(blockDef: BlockDef, magnified = false, ephemeral = false): Promise<string> {
    const layoutModel = getLayoutModelForStaticTab();
    const rtOpts: RuntimeOpts = { termsize: { rows: 25, cols: 80 } };
    const blockId = await ObjectService.CreateBlock(blockDef, rtOpts);
    if (ephemeral) {
        layoutModel.newEphemeralNode(blockId);
        return blockId;
    }
    const insertNodeAction: LayoutTreeInsertNodeAction = {
        type: LayoutTreeActionType.InsertNode,
        node: newLayoutNode(undefined, undefined, undefined, { blockId }),
        magnified,
        focused: true,
    };
    layoutModel.treeReducer(insertNodeAction);
    return blockId;
}

async function replaceBlock(blockId: string, blockDef: BlockDef, focus: boolean): Promise<string> {
    const layoutModel = getLayoutModelForStaticTab();
    const rtOpts: RuntimeOpts = { termsize: { rows: 25, cols: 80 } };
    const newBlockId = await ObjectService.CreateBlock(blockDef, rtOpts);
    setTimeout(() => {
        fireAndForget(() => ObjectService.DeleteBlock(blockId));
    }, 300);
    const targetNodeId = layoutModel.getNodeByBlockId(blockId)?.id;
    if (targetNodeId == null) {
        throw new Error(`targetNodeId not found for blockId: ${blockId}`);
    }
    const replaceNodeAction: LayoutTreeReplaceNodeAction = {
        type: LayoutTreeActionType.ReplaceNode,
        targetNodeId: targetNodeId,
        newNode: newLayoutNode(undefined, undefined, undefined, { blockId: newBlockId }),
        focused: focus,
    };
    layoutModel.treeReducer(replaceNodeAction);
    return newBlockId;
}

// when file is not found, returns {data: null, fileInfo: null}
async function fetchWaveFile(
    zoneId: string,
    fileName: string,
    offset?: number
): Promise<{ data: Uint8Array; fileInfo: WaveFile }> {
    const usp = new URLSearchParams();
    usp.set("zoneid", zoneId);
    usp.set("name", fileName);
    if (offset != null) {
        usp.set("offset", offset.toString());
    }
    const resp = await fetch(getWebServerEndpoint() + "/wave/file?" + usp.toString());
    if (!resp.ok) {
        if (resp.status === 404) {
            return { data: null, fileInfo: null };
        }
        throw new Error("error getting wave file: " + resp.statusText);
    }
    if (resp.status == 204) {
        return { data: null, fileInfo: null };
    }
    const fileInfo64 = resp.headers.get("X-ZoneFileInfo");
    if (fileInfo64 == null) {
        throw new Error(`missing zone file info for ${zoneId}:${fileName}`);
    }
    const fileInfo = JSON.parse(base64ToString(fileInfo64));
    const data = await resp.arrayBuffer();
    return { data: new Uint8Array(data), fileInfo };
}

function setNodeFocus(nodeId: string) {
    const layoutModel = getLayoutModelForStaticTab();
    layoutModel.focusNode(nodeId);
}

const objectIdWeakMap = new WeakMap();
let objectIdCounter = 0;
function getObjectId(obj: any): number {
    if (!objectIdWeakMap.has(obj)) {
        objectIdWeakMap.set(obj, objectIdCounter++);
    }
    return objectIdWeakMap.get(obj);
}

let cachedIsDev: boolean = null;

function isDev() {
    if (cachedIsDev == null) {
        cachedIsDev = getApi().getIsDev();
    }
    return cachedIsDev;
}

let cachedUserName: string = null;

function getUserName(): string {
    if (cachedUserName == null) {
        cachedUserName = getApi().getUserName();
    }
    return cachedUserName;
}

let cachedHostName: string = null;

function getHostName(): string {
    if (cachedHostName == null) {
        cachedHostName = getApi().getHostName();
    }
    return cachedHostName;
}

const LocalHostDisplayNameAtom: Atom<string> = atom((get) => {
    const configValue = get(getSettingsKeyAtom("conn:localhostdisplayname"));
    if (configValue != null) {
        return configValue;
    }
    return getUserName() + "@" + getHostName();
});

function getLocalHostDisplayNameAtom(): Atom<string> {
    return LocalHostDisplayNameAtom;
}

/**
 * Open a link in a new window, or in a new web widget. The user can set all links to open in a new web widget using the `web:openlinksinternally` setting.
 * @param uri The link to open.
 * @param forceOpenInternally Force the link to open in a new web widget.
 */
async function openLink(uri: string, forceOpenInternally = false) {
    if (forceOpenInternally || globalStore.get(atoms.settingsAtom)?.["web:openlinksinternally"]) {
        const blockDef: BlockDef = {
            meta: {
                view: "web",
                url: uri,
            },
        };
        await createBlock(blockDef);
    } else {
        getApi().openExternal(uri);
    }
}

function registerBlockComponentModel(blockId: string, bcm: BlockComponentModel) {
    blockComponentModelMap.set(blockId, bcm);
}

function unregisterBlockComponentModel(blockId: string) {
    blockComponentModelMap.delete(blockId);
}

function getBlockComponentModel(blockId: string): BlockComponentModel {
    return blockComponentModelMap.get(blockId);
}

// --- Hidden block registry ---
// Blocks that are hidden (toggled closed but kept alive).
// Keyed by viewType + ":" + connection, so toggling the same widget type for the same
// connection reuses the hidden block instead of creating a new one.
const hiddenBlockModels = new Map<string, BlockComponentModel>();
// Set of hidden block IDs, used by cleanupOrphanedBlocks to skip hidden blocks.
const hiddenBlockIds = new Set<string>();

function getHiddenBlockKey(viewType: string, connection: string | undefined): string {
    return `${viewType}:${connection ?? "local"}`;
}

function hideBlockModel(viewType: string, connection: string | undefined, bcm: BlockComponentModel) {
    hiddenBlockModels.set(getHiddenBlockKey(viewType, connection), bcm);
    if (bcm.viewModel?.blockId) {
        hiddenBlockIds.add(bcm.viewModel.blockId);
    }
}

function getHiddenBlockModel(viewType: string, connection: string | undefined): BlockComponentModel | undefined {
    return hiddenBlockModels.get(getHiddenBlockKey(viewType, connection));
}

function removeHiddenBlockModel(viewType: string, connection: string | undefined): BlockComponentModel | undefined {
    const bcm = hiddenBlockModels.get(getHiddenBlockKey(viewType, connection));
    hiddenBlockModels.delete(getHiddenBlockKey(viewType, connection));
    if (bcm?.viewModel?.blockId) {
        hiddenBlockIds.delete(bcm.viewModel.blockId);
    }
    return bcm;
}

function isHiddenBlock(blockId: string): boolean {
    return hiddenBlockIds.has(blockId);
}

// View types whose blocks are kept alive (hidden, not deleted) when toggled closed via
// the widget sidebar button or the block header close ("x") button. Used by the widget
// keep-alive toggle in widgets.tsx and by hideBlockKeepAlive below. Must stay in sync with
// the sidebar toggle behavior in app/workspace/widgets.tsx.
const keepAliveWidgetViews = new Set(["preview", "sourcecontrol", "sysinfo", "processviewer"]);

function isKeepAliveWidgetView(viewType: string | undefined | null): viewType is string {
    return !!viewType && keepAliveWidgetViews.has(viewType);
}

// Hide a block from the layout without deleting it, stashing its ViewModel in the hidden
// block registry so it can be restored later (e.g. by clicking the widget sidebar button).
// Returns true if the block was hidden (keep-alive), false if the block's view type is not a
// keep-alive widget view (caller should fall back to a normal close).
function hideBlockKeepAlive(blockId: string): boolean {
    const layoutModel = getLayoutModelForStaticTab();
    if (!layoutModel) return false;
    const node = layoutModel.getNodeByBlockId(blockId);
    if (!node) return false;
    const blockAtom = WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId));
    const blockData = globalStore.get(blockAtom);
    const viewType = blockData?.meta?.view;
    if (!isKeepAliveWidgetView(viewType)) return false;
    const connection = blockData?.meta?.connection;
    const bcm = getBlockComponentModel(blockId);
    const viewModel = bcm?.viewModel;
    viewModel?.onHide?.();
    if (viewModel) {
        hideBlockModel(viewType, connection, { viewModel });
    }
    layoutModel.hideNode(node.id);
    return true;
}

function getAllBlockComponentModels(): BlockComponentModel[] {
    return Array.from(blockComponentModelMap.values());
}

function getFocusedBlockId(): string {
    const layoutModel = getLayoutModelForStaticTab();
    if (layoutModel?.focusedNode == null) return null;
    const focusedLayoutNode = globalStore.get(layoutModel.focusedNode);
    return focusedLayoutNode?.data?.blockId;
}

function getFocusedTerminalConnection(): string | null {
    const layoutModel = getLayoutModelForStaticTab();
    if (layoutModel == null) {
        return null;
    }
    const focusedNode = globalStore.get(layoutModel.focusedNode);
    if (focusedNode != null) {
        const blockId = focusedNode.data?.blockId;
        if (blockId) {
            const blockData = globalStore.get(WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId)));
            if (blockData?.meta?.connection) {
                return blockData.meta.connection;
            }
        }
    }
    // Fallback: find most recently focused terminal using focus history
    const focusHistory = layoutModel.focusHistory;
    for (const nodeId of focusHistory) {
        const node = layoutModel.getNodeById(nodeId);
        if (node == null) continue;
        const blockId = node.data?.blockId;
        if (blockId) {
            const blockData = globalStore.get(WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId)));
            if (blockData?.meta?.view === "term" && blockData?.meta?.connection) {
                return blockData.meta.connection;
            }
        }
    }
    return null;
}

function getFocusedTerminalCwd(): string | null {
    const layoutModel = getLayoutModelForStaticTab();
    if (layoutModel == null) {
        return null;
    }
    const focusedNode = globalStore.get(layoutModel.focusedNode);
    if (focusedNode != null) {
        const blockId = focusedNode.data?.blockId;
        if (blockId) {
            const blockData = globalStore.get(WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId)));
            if (blockData?.meta?.["cmd:cwd"]) {
                return blockData.meta["cmd:cwd"];
            }
        }
    }
    // Fallback: find most recently focused terminal using focus history
    const focusHistory = layoutModel.focusHistory;
    for (const nodeId of focusHistory) {
        const node = layoutModel.getNodeById(nodeId);
        if (node == null) continue;
        const blockId = node.data?.blockId;
        if (blockId) {
            const blockData = globalStore.get(WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId)));
            if (blockData?.meta?.view === "term" && blockData?.meta?.["cmd:cwd"]) {
                return blockData.meta["cmd:cwd"];
            }
        }
    }
    return null;
}

// pass null to refocus the currently focused block
function refocusNode(blockId: string) {
    if (blockId == null) {
        blockId = getFocusedBlockId();
        if (blockId == null) {
            return;
        }
    }
    const layoutModel = getLayoutModelForStaticTab();
    const layoutNodeId = layoutModel.getNodeByBlockId(blockId);
    if (layoutNodeId?.id == null) {
        return;
    }
    layoutModel.focusNode(layoutNodeId.id);
    const bcm = getBlockComponentModel(blockId);
    const ok = bcm?.viewModel?.giveFocus?.();
    if (!ok) {
        const inputElem = document.getElementById(`${blockId}-dummy-focus`);
        inputElem?.focus();
    }
}

async function loadConnStatus() {
    const connStatusArr = await ClientService.GetAllConnStatus();
    if (connStatusArr == null) {
        return;
    }
    for (const connStatus of connStatusArr) {
        const curAtom = getConnStatusAtom(connStatus.connection);
        globalStore.set(curAtom, connStatus);
    }
}

function subscribeToConnEvents() {
    waveEventSubscribeSingle({
        eventType: "connchange",
        handler: (event) => {
            try {
                const connStatus = event.data;
                if (connStatus == null || isBlank(connStatus.connection)) {
                    return;
                }
                if (connStatus.connected) {
                    // Auto-dismiss user input prompts for this connection on successful connect
                    const userInputPrompts = globalStore.get(modalsModel.activeUserInputPromptsAtom);
                    const promptEntry = userInputPrompts[connStatus.connection];
                    console.log(`[PW-CONN] connected: conn=${connStatus.connection} hasPrompt=${!!promptEntry}`);
                    if (promptEntry) {
                        modalsModel.dismissUserInputPrompt(connStatus.connection);
                    }
                } else if (connStatus.status === "error") {
                    // On auth failure, DON'T dismiss the prompt — keep it visible for retry.
                    // Clear per-tab dismissed state so all tabs re-show the prompt.
                    if (connStatus.errorcode === "auth-failed") {
                        modalsModel.resetDismissedUserInputPrompts(connStatus.connection);
                    }
                    // Non-auth errors (timeout, dial-error): keep the prompt visible.
                    // The password buffer is independent of connection lifecycle.
                }
                const curAtom = getConnStatusAtom(connStatus.connection);
                globalStore.set(curAtom, connStatus);
            } catch (e) {
                console.log("connchange error", e);
            }
        },
    });
    // Secondary defense: on startup, dismiss stale password prompts for connections
    // that are already connected. This handles the race where a buffered userinput
    // event arrives before the corresponding connchange(connected) event is replayed.
    cleanupStaleUserInputPrompts();
}

function cleanupStaleUserInputPrompts() {
    const activePrompts = globalStore.get(modalsModel.activeUserInputPromptsAtom);
    for (const connName of Object.keys(activePrompts)) {
        const statusAtom = getConnStatusAtom(connName);
        const status = globalStore.get(statusAtom);
        if (status?.connected) {
            console.log(`[PW-CLEANUP] dismissing stale prompt for connected conn=${connName}`);
            modalsModel.dismissUserInputPrompt(connName);
        }
    }
}

function makeDefaultConnStatus(conn: string): ConnStatus {
    if (isLocalConnName(conn)) {
        return {
            connection: conn,
            connected: true,
            error: null,
            status: "connected",
            hasconnected: true,
            activeconnnum: 0,
            connectcount: 0,
            lastconnecttime: 0,
            wshenabled: false,
            canautoreconnect: false,
        };
    }
    return {
        connection: conn,
        connected: false,
        error: null,
        status: "disconnected",
        hasconnected: false,
        activeconnnum: 0,
        connectcount: 0,
        lastconnecttime: 0,
        wshenabled: false,
        canautoreconnect: false,
    };
}

function getConnStatusAtom(conn: string): PrimitiveAtom<ConnStatus> {
    const connStatusMap = globalStore.get(ConnStatusMapAtom);
    let rtn = connStatusMap.get(conn);
    if (rtn == null) {
        rtn = atom(makeDefaultConnStatus(conn));
        const newConnStatusMap = new Map(connStatusMap);
        newConnStatusMap.set(conn, rtn);
        globalStore.set(ConnStatusMapAtom, newConnStatusMap);
    }
    return rtn;
}

function createTab() {
    getApi().createTab();
}

function setActiveTab(tabId: string) {
    getApi().setActiveTab(tabId);
}

export {
    atoms,
    createBlock,
    createBlockSplitHorizontally,
    createBlockSplitVertically,
    createTab,
    fetchWaveFile,
    getAllBlockComponentModels,
    getApi,
    getBlockComponentModel,
    getBlockMetaKeyAtom,
    getBlockTermDurableAtom,
    getBlockUploadStateAtom,
    setBlockUploadState,
    getTabMetaKeyAtom,
    hideBlockModel,
    getConfigBackgroundAtom,
    getConnConfigKeyAtom,
    getConnStatusAtom,
    getFocusedBlockId,
    getFocusedTerminalConnection,
    getFocusedTerminalCwd,
    getHiddenBlockModel,
    getHiddenBlockKey,
    getHostName,
    getLocalHostDisplayNameAtom,
    hideBlockKeepAlive,
    getObjectId,
    getOrefMetaKeyAtom,
    getOverrideConfigAtom,
    getSettingsKeyAtom,
    getSettingsPrefixAtom,
    getUserName,
    globalPrimaryTabStartup,
    globalStore,
    isHiddenBlock,
    initGlobal,
    initGlobalWaveEventSubs,
    isDev,
    isKeepAliveWidgetView,
    loadConnStatus,
    makeDefaultConnStatus,
    openLink,
    readAtom,
    refocusNode,
    registerBlockComponentModel,
    removeHiddenBlockModel,
    replaceBlock,
    setActiveTab,
    setNodeFocus,
    setPlatform,
    subscribeToConnEvents,
    unregisterBlockComponentModel,
    useBlockAtom,
    useBlockCache,
    useOrefMetaKeyAtom,
    useOverrideConfigAtom,
    useSettingsKeyAtom,
    WOS,
};
