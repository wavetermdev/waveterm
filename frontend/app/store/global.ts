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
} from "@/util/util";
import { atom, Atom, PrimitiveAtom, useAtomValue } from "jotai";
import {
    atoms,
    blockComponentModelMap,
    ConnStatusMapAtom,
    initGlobalAtoms,
    orefAtomCache,
    TabIndicatorMap,
} from "./global-atoms";
import { globalStore } from "./jotaiStore";
import { modalsModel } from "./modalmodel";
import { ClientService, ObjectService } from "./services";
import * as WOS from "./wos";
import { getFileSubject, waveEventSubscribe } from "./wps";

let globalEnvironment: "electron" | "renderer";
let globalPrimaryTabStartup: boolean = false;

function initGlobal(initOpts: GlobalInitOptions) {
    globalEnvironment = initOpts.environment;
    globalPrimaryTabStartup = initOpts.primaryTabStartup ?? false;
    setPlatform(initOpts.platform);
    initGlobalAtoms(initOpts);
}

function initGlobalWaveEventSubs(initOpts: WaveInitOpts) {
    waveEventSubscribe(
        {
            eventType: "waveobj:update",
            handler: (event) => {
                // console.log("waveobj:update wave event handler", event);
                const update: WaveObjUpdate = event.data;
                WOS.updateWaveObject(update);
            },
        },
        {
            eventType: "config",
            handler: (event) => {
                // console.log("config wave event handler", event);
                const fullConfig = (event.data as WatcherUpdate).fullconfig;
                globalStore.set(atoms.fullConfigAtom, fullConfig);
            },
        },
        {
            eventType: "waveai:modeconfig",
            handler: (event) => {
                const modeConfigs = (event.data as AIModeConfigUpdate).configs;
                globalStore.set(atoms.waveaiModeConfigAtom, modeConfigs);
            },
        },
        {
            eventType: "userinput",
            handler: (event) => {
                // console.log("userinput event handler", event);
                const data: UserInputRequest = event.data;
                modalsModel.pushModal("UserInputModal", { ...data });
            },
            scope: initOpts.windowId,
        },
        {
            eventType: "blockfile",
            handler: (event) => {
                // console.log("blockfile event update", event);
                const fileData: WSFileEventData = event.data;
                const fileSubject = getFileSubject(fileData.zoneid, fileData.filename);
                if (fileSubject != null) {
                    fileSubject.next(fileData);
                }
            },
        },
        {
            eventType: "waveai:ratelimit",
            handler: (event) => {
                const rateLimitInfo: RateLimitInfo = event.data;
                globalStore.set(atoms.waveAIRateLimitInfoAtom, rateLimitInfo);
            },
        },
        {
            eventType: "tab:indicator",
            handler: (event) => {
                const data: TabIndicatorEventData = event.data;
                setTabIndicatorInternal(data.tabid, data.indicator);
            },
        }
    );
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
        let blockAtom = WOS.getWaveObjectAtom(WOS.makeORef("block", blockId));
        let blockData = get(blockAtom);
        return blockData?.meta?.[key];
    });
    blockCache.set(metaAtomName, metaAtom);
    return metaAtom;
}

function useBlockMetaKeyAtom<T extends keyof MetaType>(blockId: string, key: T): MetaType[T] {
    return useAtomValue(getBlockMetaKeyAtom(blockId, key));
}

function getOrefMetaKeyAtom<T extends keyof MetaType>(oref: string, key: T): Atom<MetaType[T]> {
    const orefCache = getSingleOrefAtomCache(oref);
    const metaAtomName = "#meta-" + key;
    let metaAtom = orefCache.get(metaAtomName);
    if (metaAtom != null) {
        return metaAtom;
    }
    metaAtom = atom((get) => {
        let objAtom = WOS.getWaveObjectAtom(oref);
        let objData = get(objAtom);
        return objData?.meta?.[key];
    });
    orefCache.set(metaAtomName, metaAtom);
    return metaAtom;
}

function useOrefMetaKeyAtom<T extends keyof MetaType>(oref: string, key: T): MetaType[T] {
    return useAtomValue(getOrefMetaKeyAtom(oref, key));
}

function getConnConfigKeyAtom<T extends keyof ConnKeywords>(connName: string, key: T): Atom<ConnKeywords[T]> {
    let connCache = getSingleConnAtomCache(connName);
    const keyAtomName = "#conn-" + key;
    let keyAtom = connCache.get(keyAtomName);
    if (keyAtom != null) {
        return keyAtom;
    }
    keyAtom = atom((get) => {
        let fullConfig = get(atoms.fullConfigAtom);
        return fullConfig.connections?.[connName]?.[key];
    });
    connCache.set(keyAtomName, keyAtom);
    return keyAtom;
}

const settingsAtomCache = new Map<string, Atom<any>>();

function getOverrideConfigAtom<T extends keyof SettingsType>(blockId: string, key: T): Atom<SettingsType[T]> {
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

function getSettingsPrefixAtom(prefix: string): Atom<SettingsType> {
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

function useBlockAtom<T>(blockId: string, name: string, makeFn: () => Atom<T>): Atom<T> {
    const blockCache = getSingleBlockAtomCache(blockId);
    let atom = blockCache.get(name);
    if (atom == null) {
        atom = makeFn();
        blockCache.set(name, atom);
        console.log("New BlockAtom", blockId, name);
    }
    return atom as Atom<T>;
}

function useBlockDataLoaded(blockId: string): boolean {
    const loadedAtom = useBlockAtom<boolean>(blockId, "block-loaded", () => {
        return WOS.getWaveObjectLoadingAtom(WOS.makeORef("block", blockId));
    });
    return useAtomValue(loadedAtom);
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

function getAllBlockComponentModels(): BlockComponentModel[] {
    return Array.from(blockComponentModelMap.values());
}

function getFocusedBlockId(): string {
    const layoutModel = getLayoutModelForStaticTab();
    const focusedLayoutNode = globalStore.get(layoutModel.focusedNode);
    return focusedLayoutNode?.data?.blockId;
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

async function loadTabIndicators() {
    const tabIndicators = await RpcApi.GetAllTabIndicatorsCommand(TabRpcClient);
    if (tabIndicators == null) {
        return;
    }
    for (const [tabId, indicator] of Object.entries(tabIndicators)) {
        const curAtom = getTabIndicatorAtom(tabId);
        globalStore.set(curAtom, indicator);
    }
}

function subscribeToConnEvents() {
    waveEventSubscribe({
        eventType: "connchange",
        handler: (event: WaveEvent) => {
            try {
                const connStatus = event.data as ConnStatus;
                if (connStatus == null || isBlank(connStatus.connection)) {
                    return;
                }
                console.log("connstatus update", connStatus);
                let curAtom = getConnStatusAtom(connStatus.connection);
                globalStore.set(curAtom, connStatus);
            } catch (e) {
                console.log("connchange error", e);
            }
        },
    });
}

function getConnStatusAtom(conn: string): PrimitiveAtom<ConnStatus> {
    const connStatusMap = globalStore.get(ConnStatusMapAtom);
    let rtn = connStatusMap.get(conn);
    if (rtn == null) {
        if (isLocalConnName(conn)) {
            const connStatus: ConnStatus = {
                connection: conn,
                connected: true,
                error: null,
                status: "connected",
                hasconnected: true,
                activeconnnum: 0,
                wshenabled: false,
            };
            rtn = atom(connStatus);
        } else {
            const connStatus: ConnStatus = {
                connection: conn,
                connected: false,
                error: null,
                status: "disconnected",
                hasconnected: false,
                activeconnnum: 0,
                wshenabled: false,
            };
            rtn = atom(connStatus);
        }
        const newConnStatusMap = new Map(connStatusMap);
        newConnStatusMap.set(conn, rtn);
        globalStore.set(ConnStatusMapAtom, newConnStatusMap);
    }
    return rtn;
}

function getTabIndicatorAtom(tabId: string): PrimitiveAtom<TabIndicator> {
    let rtn = TabIndicatorMap.get(tabId);
    if (rtn == null) {
        rtn = atom(null) as PrimitiveAtom<TabIndicator>;
        TabIndicatorMap.set(tabId, rtn);
    }
    return rtn;
}

function setTabIndicatorInternal(tabId: string, indicator: TabIndicator) {
    if (indicator == null) {
        const indicatorAtom = getTabIndicatorAtom(tabId);
        globalStore.set(indicatorAtom, null);
        return;
    }
    const indicatorAtom = getTabIndicatorAtom(tabId);
    const currentIndicator = globalStore.get(indicatorAtom);
    if (currentIndicator == null) {
        globalStore.set(indicatorAtom, indicator);
        return;
    }
    if (indicator.priority >= currentIndicator.priority) {
        if (indicator.clearonfocus && !currentIndicator.clearonfocus) {
            indicator.persistentindicator = currentIndicator;
        }
        globalStore.set(indicatorAtom, indicator);
    }
}

function setTabIndicator(tabId: string, indicator: TabIndicator) {
    setTabIndicatorInternal(tabId, indicator);

    const eventData: WaveEvent = {
        event: "tab:indicator",
        scopes: [WOS.makeORef("tab", tabId)],
        data: {
            tabid: tabId,
            indicator: indicator,
        } as TabIndicatorEventData,
    };
    fireAndForget(() => RpcApi.EventPublishCommand(TabRpcClient, eventData));
}

function clearTabIndicatorFromFocus(tabId: string) {
    const indicatorAtom = getTabIndicatorAtom(tabId);
    const currentIndicator = globalStore.get(indicatorAtom);
    if (currentIndicator == null) {
        return;
    }
    const persistentIndicator = currentIndicator.persistentindicator;
    const eventData: WaveEvent = {
        event: "tab:indicator",
        scopes: [WOS.makeORef("tab", tabId)],
        data: {
            tabid: tabId,
            indicator: persistentIndicator ?? null,
        } as TabIndicatorEventData,
    };
    fireAndForget(() => RpcApi.EventPublishCommand(TabRpcClient, eventData));
}

function clearAllTabIndicators() {
    for (const [tabId, indicatorAtom] of TabIndicatorMap.entries()) {
        const indicator = globalStore.get(indicatorAtom);
        if (indicator != null) {
            setTabIndicator(tabId, null);
        }
    }
}

function pushFlashError(ferr: FlashErrorType) {
    if (ferr.expiration == null) {
        ferr.expiration = Date.now() + 5000;
    }
    ferr.id = crypto.randomUUID();
    globalStore.set(atoms.flashErrors, (prev) => {
        return [...prev, ferr];
    });
}

function addOrUpdateNotification(notif: NotificationType) {
    globalStore.set(atoms.notifications, (prevNotifications) => {
        // Remove any existing notification with the same ID
        const notificationsWithoutThisId = prevNotifications.filter((n) => n.id !== notif.id);
        // Add the new notification
        return [...notificationsWithoutThisId, notif];
    });
}

function pushNotification(notif: NotificationType) {
    if (!notif.id && notif.persistent) {
        return;
    }
    notif.id = notif.id ?? crypto.randomUUID();
    addOrUpdateNotification(notif);
}

function removeNotificationById(id: string) {
    globalStore.set(atoms.notifications, (prev) => {
        return prev.filter((notif) => notif.id !== id);
    });
}

function removeFlashError(id: string) {
    globalStore.set(atoms.flashErrors, (prev) => {
        return prev.filter((ferr) => ferr.id !== id);
    });
}

function removeNotification(id: string) {
    globalStore.set(atoms.notifications, (prev) => {
        return prev.filter((notif) => notif.id !== id);
    });
}

function createTab() {
    getApi().createTab();
}

function setActiveTab(tabId: string) {
    getApi().setActiveTab(tabId);
}

function recordTEvent(event: string, props?: TEventProps) {
    if (props == null) {
        props = {};
    }
    RpcApi.RecordTEventCommand(TabRpcClient, { event, props }, { noresponse: true });
}

export { ConnStatusMapAtom, getAtoms, initGlobalAtoms, orefAtomCache, TabIndicatorMap, blockComponentModelMap } from "./global-atoms";

export {
    atoms,
    clearAllTabIndicators,
    clearTabIndicatorFromFocus,
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
    getConnStatusAtom,
    getFocusedBlockId,
    getHostName,
    getLocalHostDisplayNameAtom,
    getObjectId,
    getOrefMetaKeyAtom,
    getOverrideConfigAtom,
    getSettingsKeyAtom,
    getSettingsPrefixAtom,
    getTabIndicatorAtom,
    getUserName,
    globalPrimaryTabStartup,
    globalStore,
    initGlobal,
    initGlobalWaveEventSubs,
    isDev,
    loadConnStatus,
    loadTabIndicators,
    openLink,
    pushFlashError,
    pushNotification,
    readAtom,
    recordTEvent,
    refocusNode,
    registerBlockComponentModel,
    removeFlashError,
    removeNotification,
    removeNotificationById,
    replaceBlock,
    setActiveTab,
    setNodeFocus,
    setPlatform,
    setTabIndicator,
    subscribeToConnEvents,
    unregisterBlockComponentModel,
    useBlockAtom,
    useBlockCache,
    useBlockDataLoaded,
    useBlockMetaKeyAtom,
    useOrefMetaKeyAtom,
    useOverrideConfigAtom,
    useSettingsKeyAtom,
    WOS,
};
