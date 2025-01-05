// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    getLayoutModelForTabById,
    LayoutTreeActionType,
    LayoutTreeInsertNodeAction,
    newLayoutNode,
} from "@/layout/index";
import { getLayoutModelForStaticTab } from "@/layout/lib/layoutModelHooks";
import { getWebServerEndpoint } from "@/util/endpoints";
import { fetch } from "@/util/fetchutil";
import { deepCompareReturnPrev, getPrefixedSettings, isBlank } from "@/util/util";
import { atom, Atom, PrimitiveAtom, useAtomValue } from "jotai";
import { globalStore } from "./jotaiStore";
import { modalsModel } from "./modalmodel";
import { ClientService, ObjectService } from "./services";
import * as WOS from "./wos";
import { getFileSubject, waveEventSubscribe } from "./wps";

let PLATFORM: NodeJS.Platform = "darwin";
let atoms: GlobalAtomsType;
let globalEnvironment: "electron" | "renderer";
const blockComponentModelMap = new Map<string, BlockComponentModel>();
const Counters = new Map<string, number>();
const ConnStatusMap = new Map<string, PrimitiveAtom<ConnStatus>>();

type GlobalInitOptions = {
    tabId: string;
    platform: NodeJS.Platform;
    windowId: string;
    clientId: string;
    environment: "electron" | "renderer";
};

function initGlobal(initOpts: GlobalInitOptions) {
    globalEnvironment = initOpts.environment;
    setPlatform(initOpts.platform);
    initGlobalAtoms(initOpts);
}

function setPlatform(platform: NodeJS.Platform) {
    PLATFORM = platform;
}

function initGlobalAtoms(initOpts: GlobalInitOptions) {
    const windowIdAtom = atom(initOpts.windowId) as PrimitiveAtom<string>;
    const clientIdAtom = atom(initOpts.clientId) as PrimitiveAtom<string>;
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
    } catch (_) {
        // do nothing
    }

    try {
        getApi().onMenuItemAbout(() => {
            modalsModel.pushModal("AboutModal");
        });
    } catch (_) {
        // do nothing
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
    const settingsAtom = atom((get) => {
        return get(fullConfigAtom)?.settings ?? {};
    }) as Atom<SettingsType>;
    const tabAtom: Atom<Tab> = atom((get) => {
        return WOS.getObjectValue(WOS.makeORef("tab", initOpts.tabId), get);
    });
    // this is *the* tab that this tabview represents.  it should never change.
    const staticTabIdAtom: Atom<string> = atom(initOpts.tabId);
    const controlShiftDelayAtom = atom(false);
    const updaterStatusAtom = atom<UpdaterStatus>("up-to-date") as PrimitiveAtom<UpdaterStatus>;
    try {
        globalStore.set(updaterStatusAtom, getApi().getUpdaterStatus());
        getApi().onUpdaterStatusChange((status) => {
            globalStore.set(updaterStatusAtom, status);
        });
    } catch (_) {
        // do nothing
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

    const typeAheadModalAtom = atom({});
    const modalOpen = atom(false);
    const allConnStatusAtom = atom<ConnStatus[]>((get) => {
        const connStatuses = Array.from(ConnStatusMap.values()).map((atom) => get(atom));
        return connStatuses;
    });
    const flashErrorsAtom = atom<FlashErrorType[]>([]);
    const notificationsAtom = atom<NotificationType[]>([]);
    const notificationPopoverModeAtom = atom<boolean>(false);
    const reinitVersion = atom(0);
    atoms = {
        // initialized in wave.ts (will not be null inside of application)
        clientId: clientIdAtom,
        uiContext: uiContextAtom,
        client: clientAtom,
        waveWindow: windowDataAtom,
        workspace: workspaceAtom,
        fullConfigAtom,
        settingsAtom,
        tabAtom,
        staticTabId: staticTabIdAtom,
        isFullScreen: isFullScreenAtom,
        controlShiftDelayAtom,
        updaterStatusAtom,
        prefersReducedMotionAtom,
        typeAheadModalAtom,
        modalOpen,
        allConnStatus: allConnStatusAtom,
        flashErrors: flashErrorsAtom,
        notifications: notificationsAtom,
        notificationPopoverMode: notificationPopoverModeAtom,
        reinitVersion,
        isTermMultiInput: atom(false),
    };
}

function initGlobalWaveEventSubs() {
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
            eventType: "userinput",
            handler: (event) => {
                // console.log("userinput event handler", event);
                const data: UserInputRequest = event.data;
                modalsModel.pushModal("UserInputModal", { ...data });
            },
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

function useOverrideConfigAtom<T extends keyof SettingsType>(blockId: string, key: T): SettingsType[T] {
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

const blockAtomCache = new Map<string, Map<string, Atom<any>>>();

function getSingleBlockAtomCache(blockId: string): Map<string, Atom<any>> {
    let blockCache = blockAtomCache.get(blockId);
    if (blockCache == null) {
        blockCache = new Map<string, Atom<any>>();
        blockAtomCache.set(blockId, blockCache);
    }
    return blockCache;
}

function getSingleConnAtomCache(connName: string): Map<string, Atom<any>> {
    let blockCache = blockAtomCache.get(connName);
    if (blockCache == null) {
        blockCache = new Map<string, Atom<any>>();
        blockAtomCache.set(connName, blockCache);
    }
    return blockCache;
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

async function createBlock(blockDef: BlockDef, magnified = false, ephemeral = false): Promise<string> {
    const tabId = globalStore.get(atoms.staticTabId);
    const layoutModel = getLayoutModelForTabById(tabId);
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
    const fileInfo = JSON.parse(atob(fileInfo64));
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
    let rtn = ConnStatusMap.get(conn);
    if (rtn == null) {
        if (isBlank(conn)) {
            // create a fake "local" status atom that's always connected
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
        ConnStatusMap.set(conn, rtn);
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

export {
    atoms,
    counterInc,
    countersClear,
    countersPrint,
    createBlock,
    createTab,
    fetchWaveFile,
    getAllBlockComponentModels,
    getApi,
    getBlockComponentModel,
    getBlockMetaKeyAtom,
    getConnStatusAtom,
    getHostName,
    getObjectId,
    getOverrideConfigAtom,
    getSettingsKeyAtom,
    getSettingsPrefixAtom,
    getUserName,
    globalStore,
    initGlobal,
    initGlobalWaveEventSubs,
    isDev,
    loadConnStatus,
    openLink,
    PLATFORM,
    pushFlashError,
    pushNotification,
    refocusNode,
    registerBlockComponentModel,
    removeFlashError,
    removeNotification,
    removeNotificationById,
    setActiveTab,
    setNodeFocus,
    setPlatform,
    subscribeToConnEvents,
    unregisterBlockComponentModel,
    useBlockAtom,
    useBlockCache,
    useBlockDataLoaded,
    useBlockMetaKeyAtom,
    useOverrideConfigAtom,
    useSettingsKeyAtom,
    WOS,
};
