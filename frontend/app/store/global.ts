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
} from "@/util/util";
import { atom, Atom, PrimitiveAtom, useAtomValue } from "jotai";
import { globalStore } from "./jotaiStore";
import { modalsModel } from "./modalmodel";
import { ClientService, ObjectService } from "./services";
import * as WOS from "./wos";
import { getFileSubject, waveEventSubscribe } from "./wps";

let atoms: GlobalAtomsType;
let globalEnvironment: "electron" | "renderer";
let globalPrimaryTabStartup: boolean = false;
const blockComponentModelMap = new Map<string, BlockComponentModel>();
const Counters = new Map<string, number>();
const ConnStatusMapAtom = atom(new Map<string, PrimitiveAtom<ConnStatus>>());
const orefAtomCache = new Map<string, Map<string, Atom<any>>>();

type GlobalInitOptions = {
    tabId?: string;
    platform: NodeJS.Platform;
    windowId: string;
    clientId: string;
    environment: "electron" | "renderer";
    primaryTabStartup?: boolean;
    builderId?: string;
};

function initGlobal(initOpts: GlobalInitOptions) {
    globalEnvironment = initOpts.environment;
    globalPrimaryTabStartup = initOpts.primaryTabStartup ?? false;
    setPlatform(initOpts.platform);
    initGlobalAtoms(initOpts);
}

function initGlobalAtoms(initOpts: GlobalInitOptions) {
    const windowIdAtom = atom(initOpts.windowId) as PrimitiveAtom<string>;
    const clientIdAtom = atom(initOpts.clientId) as PrimitiveAtom<string>;
    const builderIdAtom = atom(initOpts.builderId) as PrimitiveAtom<string>;
    const builderAppIdAtom = atom<string>(null) as PrimitiveAtom<string>;
    const waveWindowTypeAtom = atom((get) => {
        const builderId = get(builderIdAtom);
        return builderId != null ? "builder" : "tab";
    }) as Atom<"tab" | "builder">;
    const uiContextAtom = atom((get) => {
        const uiContext: UIContext = {
            windowid: initOpts.windowId,
            activetabid: initOpts.tabId,
        };
        return uiContext;
    }) as Atom<UIContext>;

    const isFullScreenAtom = atom(false) as PrimitiveAtom<boolean>;
    try {
        getApi().onFullScreenChange((isFullScreen) => {
            globalStore.set(isFullScreenAtom, isFullScreen);
        });
    } catch (e) {
        console.log("failed to initialize isFullScreenAtom", e);
    }

    const zoomFactorAtom = atom(1.0) as PrimitiveAtom<number>;
    try {
        globalStore.set(zoomFactorAtom, getApi().getZoomFactor());
        getApi().onZoomFactorChange((zoomFactor) => {
            globalStore.set(zoomFactorAtom, zoomFactor);
        });
    } catch (e) {
        console.log("failed to initialize zoomFactorAtom", e);
    }

    try {
        getApi().onMenuItemAbout(() => {
            modalsModel.pushModal("AboutModal");
        });
    } catch (e) {
        console.log("failed to initialize onMenuItemAbout handler", e);
    }

    const clientAtom: Atom<Client> = atom((get) => {
        const clientId = get(clientIdAtom);
        if (clientId == null) {
            return null;
        }
        return WOS.getObjectValue(WOS.makeORef("client", clientId), get);
    });
    const windowDataAtom: Atom<WaveWindow> = atom((get) => {
        const windowId = get(windowIdAtom);
        if (windowId == null) {
            return null;
        }
        const rtn = WOS.getObjectValue<WaveWindow>(WOS.makeORef("window", windowId), get);
        return rtn;
    });
    const workspaceAtom: Atom<Workspace> = atom((get) => {
        const windowData = get(windowDataAtom);
        if (windowData == null) {
            return null;
        }
        return WOS.getObjectValue(WOS.makeORef("workspace", windowData.workspaceid), get);
    });
    const fullConfigAtom = atom(null) as PrimitiveAtom<FullConfigType>;
    const waveaiModeConfigAtom = atom(null) as PrimitiveAtom<Record<string, AIModeConfigType>>;
    const settingsAtom = atom((get) => {
        return get(fullConfigAtom)?.settings ?? {};
    }) as Atom<SettingsType>;
    const hasCustomAIPresetsAtom = atom((get) => {
        const fullConfig = get(fullConfigAtom);
        if (!fullConfig?.presets) {
            return false;
        }
        for (const presetId in fullConfig.presets) {
            if (presetId.startsWith("ai@") && presetId !== "ai@global" && presetId !== "ai@wave") {
                return true;
            }
        }
        return false;
    }) as Atom<boolean>;
    // this is *the* tab that this tabview represents.  it should never change.
    const staticTabIdAtom: Atom<string> = atom(initOpts.tabId);
    const controlShiftDelayAtom = atom(false);
    const updaterStatusAtom = atom<UpdaterStatus>("up-to-date") as PrimitiveAtom<UpdaterStatus>;
    try {
        globalStore.set(updaterStatusAtom, getApi().getUpdaterStatus());
        getApi().onUpdaterStatusChange((status) => {
            globalStore.set(updaterStatusAtom, status);
        });
    } catch (e) {
        console.log("failed to initialize updaterStatusAtom", e);
    }

    const reducedMotionSettingAtom = atom((get) => get(settingsAtom)?.["window:reducedmotion"]);
    const reducedMotionSystemPreferenceAtom = atom(false);

    // Composite of the prefers-reduced-motion media query and the window:reducedmotion user setting.
    const prefersReducedMotionAtom = atom((get) => {
        const reducedMotionSetting = get(reducedMotionSettingAtom);
        const reducedMotionSystemPreference = get(reducedMotionSystemPreferenceAtom);
        return reducedMotionSetting || reducedMotionSystemPreference;
    });

    // Set up a handler for changes to the prefers-reduced-motion media query.
    if (globalThis.window != null) {
        const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
        globalStore.set(reducedMotionSystemPreferenceAtom, !reducedMotionQuery || reducedMotionQuery.matches);
        reducedMotionQuery?.addEventListener("change", () => {
            globalStore.set(reducedMotionSystemPreferenceAtom, reducedMotionQuery.matches);
        });
    }

    const modalOpen = atom(false);
    const allConnStatusAtom = atom<ConnStatus[]>((get) => {
        const connStatusMap = get(ConnStatusMapAtom);
        const connStatuses = Array.from(connStatusMap.values()).map((atom) => get(atom));
        return connStatuses;
    });
    const flashErrorsAtom = atom<FlashErrorType[]>([]);
    const notificationsAtom = atom<NotificationType[]>([]);
    const notificationPopoverModeAtom = atom<boolean>(false);
    const reinitVersion = atom(0);
    const rateLimitInfoAtom = atom(null) as PrimitiveAtom<RateLimitInfo>;
    atoms = {
        // initialized in wave.ts (will not be null inside of application)
        clientId: clientIdAtom,
        builderId: builderIdAtom,
        builderAppId: builderAppIdAtom,
        waveWindowType: waveWindowTypeAtom,
        uiContext: uiContextAtom,
        client: clientAtom,
        waveWindow: windowDataAtom,
        workspace: workspaceAtom,
        fullConfigAtom,
        waveaiModeConfigAtom,
        settingsAtom,
        hasCustomAIPresetsAtom,
        staticTabId: staticTabIdAtom,
        isFullScreen: isFullScreenAtom,
        zoomFactorAtom,
        controlShiftDelayAtom,
        updaterStatusAtom,
        prefersReducedMotionAtom,
        modalOpen,
        allConnStatus: allConnStatusAtom,
        flashErrors: flashErrorsAtom,
        notifications: notificationsAtom,
        notificationPopoverMode: notificationPopoverModeAtom,
        reinitVersion,
        waveAIRateLimitInfoAtom: rateLimitInfoAtom,
    } as GlobalAtomsType;
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

function countersClear() {
    Counters.clear();
}

function counterInc(name: string, incAmt: number = 1) {
    let count = Counters.get(name) ?? 0;
    count += incAmt;
    Counters.set(name, count);
}

function countersPrint() {
    let outStr = "";
    for (const [name, count] of Counters.entries()) {
        outStr += `${name}: ${count}\n`;
    }
    console.log(outStr);
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
        } else if (conn.startsWith("aws:")) {
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

export {
    atoms,
    counterInc,
    countersClear,
    countersPrint,
    createBlock,
    createBlockSplitHorizontally,
    createBlockSplitVertically,
    createTab,
    fetchWaveFile,
    getAllBlockComponentModels,
    getApi,
    getBlockComponentModel,
    getBlockMetaKeyAtom,
    getConnStatusAtom,
    getFocusedBlockId,
    getHostName,
    getObjectId,
    getOrefMetaKeyAtom,
    getOverrideConfigAtom,
    getSettingsKeyAtom,
    getSettingsPrefixAtom,
    getUserName,
    globalPrimaryTabStartup,
    globalStore,
    initGlobal,
    initGlobalWaveEventSubs,
    isDev,
    loadConnStatus,
    openLink,
    pushFlashError,
    pushNotification,
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
