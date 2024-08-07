// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    LayoutTreeAction,
    LayoutTreeActionType,
    LayoutTreeInsertNodeAction,
    newLayoutNode,
} from "frontend/layout/index";
import { getLayoutStateAtomForTab } from "frontend/layout/lib/layoutAtom";
import { layoutTreeStateReducer } from "frontend/layout/lib/layoutState";

import { handleIncomingRpcMessage } from "@/app/store/wshrpc";
import { LayoutTreeInsertNodeAtIndexAction } from "@/layout/lib/model";
import { getWSServerEndpoint, getWebServerEndpoint } from "@/util/endpoints";
import * as layoututil from "@/util/layoututil";
import { produce } from "immer";
import * as jotai from "jotai";
import * as rxjs from "rxjs";
import { modalsModel } from "./modalmodel";
import * as services from "./services";
import * as WOS from "./wos";
import { WSControl } from "./ws";

let PLATFORM: NodeJS.Platform = "darwin";
const globalStore = jotai.createStore();
let atoms: GlobalAtomsType;
let globalEnvironment: "electron" | "renderer";

type GlobalInitOptions = {
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
    const windowIdAtom = jotai.atom(initOpts.windowId) as jotai.PrimitiveAtom<string>;
    const clientIdAtom = jotai.atom(initOpts.clientId) as jotai.PrimitiveAtom<string>;
    const uiContextAtom = jotai.atom((get) => {
        const windowData = get(windowDataAtom);
        const uiContext: UIContext = {
            windowid: get(atoms.windowId),
            activetabid: windowData?.activetabid,
        };
        return uiContext;
    }) as jotai.Atom<UIContext>;

    const isFullScreenAtom = jotai.atom(false) as jotai.PrimitiveAtom<boolean>;
    try {
        getApi().onFullScreenChange((isFullScreen) => {
            console.log("fullscreen change", isFullScreen);
            globalStore.set(isFullScreenAtom, isFullScreen);
        });
    } catch (_) {
        // do nothing
    }

    const clientAtom: jotai.Atom<Client> = jotai.atom((get) => {
        const clientId = get(clientIdAtom);
        if (clientId == null) {
            return null;
        }
        return WOS.getObjectValue(WOS.makeORef("client", clientId), get);
    });
    const windowDataAtom: jotai.Atom<WaveWindow> = jotai.atom((get) => {
        const windowId = get(windowIdAtom);
        if (windowId == null) {
            return null;
        }
        const rtn = WOS.getObjectValue<WaveWindow>(WOS.makeORef("window", windowId), get);
        return rtn;
    });
    const workspaceAtom: jotai.Atom<Workspace> = jotai.atom((get) => {
        const windowData = get(windowDataAtom);
        if (windowData == null) {
            return null;
        }
        return WOS.getObjectValue(WOS.makeORef("workspace", windowData.workspaceid), get);
    });
    const settingsConfigAtom = jotai.atom(null) as jotai.PrimitiveAtom<SettingsConfigType>;
    const tabAtom: jotai.Atom<Tab> = jotai.atom((get) => {
        const windowData = get(windowDataAtom);
        if (windowData == null) {
            return null;
        }
        return WOS.getObjectValue(WOS.makeORef("tab", windowData.activetabid), get);
    });
    const activeTabIdAtom: jotai.Atom<string> = jotai.atom((get) => {
        const windowData = get(windowDataAtom);
        if (windowData == null) {
            return null;
        }
        return windowData.activetabid;
    });
    const cmdShiftDelayAtom = jotai.atom(false);
    const updateStatusAtom = jotai.atom<UpdaterStatus>("up-to-date") as jotai.PrimitiveAtom<UpdaterStatus>;
    try {
        globalStore.set(updateStatusAtom, getApi().getUpdaterStatus());
        getApi().onUpdaterStatusChange((status) => {
            console.log("updater status change", status);
            globalStore.set(updateStatusAtom, status);
        });
    } catch (_) {
        // do nothing
    }
    atoms = {
        // initialized in wave.ts (will not be null inside of application)
        windowId: windowIdAtom,
        clientId: clientIdAtom,
        uiContext: uiContextAtom,
        client: clientAtom,
        waveWindow: windowDataAtom,
        workspace: workspaceAtom,
        settingsConfigAtom: settingsConfigAtom,
        tabAtom: tabAtom,
        activeTabId: activeTabIdAtom,
        isFullScreen: isFullScreenAtom,
        cmdShiftDelayAtom: cmdShiftDelayAtom,
        updaterStatusAtom: updateStatusAtom,
    };
}

// key is "eventType" or "eventType|oref"
const eventSubjects = new Map<string, SubjectWithRef<WSEventType>>();
const fileSubjects = new Map<string, SubjectWithRef<WSFileEventData>>();

function getSubjectInternal(subjectKey: string): SubjectWithRef<WSEventType> {
    let subject = eventSubjects.get(subjectKey);
    if (subject == null) {
        subject = new rxjs.Subject<any>() as any;
        subject.refCount = 0;
        subject.release = () => {
            subject.refCount--;
            if (subject.refCount === 0) {
                subject.complete();
                eventSubjects.delete(subjectKey);
            }
        };
        eventSubjects.set(subjectKey, subject);
    }
    subject.refCount++;
    return subject;
}

function getEventSubject(eventType: string): SubjectWithRef<WSEventType> {
    return getSubjectInternal(eventType);
}

function getEventORefSubject(eventType: string, oref: string): SubjectWithRef<WSEventType> {
    return getSubjectInternal(eventType + "|" + oref);
}

function getFileSubject(zoneId: string, fileName: string): SubjectWithRef<WSFileEventData> {
    const subjectKey = zoneId + "|" + fileName;
    let subject = fileSubjects.get(subjectKey);
    if (subject == null) {
        subject = new rxjs.Subject<any>() as any;
        subject.refCount = 0;
        subject.release = () => {
            subject.refCount--;
            if (subject.refCount === 0) {
                subject.complete();
                fileSubjects.delete(subjectKey);
            }
        };
        fileSubjects.set(subjectKey, subject);
    }
    subject.refCount++;
    return subject;
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

const settingsAtomCache = new Map<string, jotai.Atom<any>>();

function useSettingsAtom<T>(name: string, settingsFn: (settings: SettingsConfigType) => T): jotai.Atom<T> {
    let atom = settingsAtomCache.get(name);
    if (atom == null) {
        atom = jotai.atom((get) => {
            const settings = get(atoms.settingsConfigAtom);
            if (settings == null) {
                return null;
            }
            return settingsFn(settings);
        }) as jotai.Atom<T>;
        settingsAtomCache.set(name, atom);
    }
    return atom as jotai.Atom<T>;
}

const blockAtomCache = new Map<string, Map<string, jotai.Atom<any>>>();

function useBlockAtom<T>(blockId: string, name: string, makeFn: () => jotai.Atom<T>): jotai.Atom<T> {
    let blockCache = blockAtomCache.get(blockId);
    if (blockCache == null) {
        blockCache = new Map<string, jotai.Atom<any>>();
        blockAtomCache.set(blockId, blockCache);
    }
    let atom = blockCache.get(name);
    if (atom == null) {
        atom = makeFn();
        blockCache.set(name, atom);
        console.log("New BlockAtom", blockId, name);
    }
    return atom as jotai.Atom<T>;
}

let globalWS: WSControl = null;

function handleWSEventMessage(msg: WSEventType) {
    if (msg.eventtype == null) {
        console.log("unsupported event", msg);
        return;
    }
    if (msg.eventtype == "config") {
        globalStore.set(atoms.settingsConfigAtom, msg.data.settings);
        return;
    }
    if (msg.eventtype == "userinput") {
        const data: UserInputRequest = msg.data;
        modalsModel.pushModal("UserInputModal", { ...data });
        return;
    }
    if (msg.eventtype == "blockfile") {
        const fileData: WSFileEventData = msg.data;
        const fileSubject = getFileSubject(fileData.zoneid, fileData.filename);
        if (fileSubject != null) {
            fileSubject.next(fileData);
        }
        return;
    }
    if (msg.eventtype == "rpc") {
        const rpcMsg: RpcMessage = msg.data;
        handleIncomingRpcMessage(rpcMsg);
        return;
    }
    if (msg.eventtype == "layoutaction") {
        const layoutAction: WSLayoutActionData = msg.data;
        switch (layoutAction.actiontype) {
            case LayoutTreeActionType.InsertNode: {
                const insertNodeAction: LayoutTreeInsertNodeAction<TabLayoutData> = {
                    type: LayoutTreeActionType.InsertNode,
                    node: newLayoutNode<TabLayoutData>(undefined, undefined, undefined, {
                        blockId: layoutAction.blockid,
                    }),
                };
                runLayoutAction(layoutAction.tabid, insertNodeAction);
                break;
            }
            case LayoutTreeActionType.DeleteNode: {
                const layoutStateAtom = getLayoutStateAtomForTab(
                    layoutAction.tabid,
                    WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", layoutAction.tabid))
                );
                const curState = globalStore.get(layoutStateAtom);
                const leafId = layoututil.findLeafIdFromBlockId(curState, layoutAction.blockid);
                const deleteNodeAction = {
                    type: LayoutTreeActionType.DeleteNode,
                    nodeId: leafId,
                };
                runLayoutAction(layoutAction.tabid, deleteNodeAction);
                break;
            }
            case LayoutTreeActionType.InsertNodeAtIndex: {
                if (!layoutAction.indexarr) {
                    console.error("Cannot apply eventbus layout action InsertNodeAtIndex, indexarr field is missing.");
                    break;
                }
                const insertAction: LayoutTreeInsertNodeAtIndexAction<TabLayoutData> = {
                    type: LayoutTreeActionType.InsertNodeAtIndex,
                    node: newLayoutNode<TabLayoutData>(undefined, layoutAction.nodesize, undefined, {
                        blockId: layoutAction.blockid,
                    }),
                    indexArr: layoutAction.indexarr,
                };
                runLayoutAction(layoutAction.tabid, insertAction);
                break;
            }
            default:
                console.log("unsupported layout action", layoutAction);
                break;
        }
        return;
    }
    // we send to two subjects just eventType and eventType|oref
    // we don't use getORefSubject here because we don't want to create a new subject
    const eventSubject = eventSubjects.get(msg.eventtype);
    if (eventSubject != null) {
        eventSubject.next(msg);
    }
    const eventOrefSubject = eventSubjects.get(msg.eventtype + "|" + msg.oref);
    if (eventOrefSubject != null) {
        eventOrefSubject.next(msg);
    }
}

function handleWSMessage(msg: any) {
    if (msg == null) {
        return;
    }
    if (msg.eventtype != null) {
        handleWSEventMessage(msg);
    }
}

function initWS() {
    const windowId = globalStore.get(atoms.windowId);
    globalWS = new WSControl(getWSServerEndpoint(), globalStore, windowId, "", (msg) => {
        handleWSMessage(msg);
    });
    globalWS.connectNow("initWS");
}

function sendWSCommand(command: WSCommandType) {
    globalWS.pushMessage(command);
}

// more code that could be moved into an init
// here we want to set up a "waveobj:update" handler
const waveobjUpdateSubject = getEventSubject("waveobj:update");
waveobjUpdateSubject.subscribe((msg: WSEventType) => {
    const update: WaveObjUpdate = msg.data;
    WOS.updateWaveObject(update);
});

/**
 * Get the preload api.
 */
function getApi(): ElectronApi {
    return (window as any).api;
}

function runLayoutAction(tabId: string, action: LayoutTreeAction) {
    const layoutStateAtom = getLayoutStateAtomForTab(tabId, WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId)));
    const curState = globalStore.get(layoutStateAtom);
    globalStore.set(layoutStateAtom, layoutTreeStateReducer(curState, action));
}

async function createBlock(blockDef: BlockDef) {
    const rtOpts: RuntimeOpts = { termsize: { rows: 25, cols: 80 } };
    const blockId = await services.ObjectService.CreateBlock(blockDef, rtOpts);
    const insertNodeAction: LayoutTreeInsertNodeAction<TabLayoutData> = {
        type: LayoutTreeActionType.InsertNode,
        node: newLayoutNode<TabLayoutData>(undefined, undefined, undefined, { blockId }),
    };
    const activeTabId = globalStore.get(atoms.uiContext).activetabid;
    runLayoutAction(activeTabId, insertNodeAction);
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

function setBlockFocus(blockId: string) {
    let winData = globalStore.get(atoms.waveWindow);
    if (winData == null) {
        return;
    }
    if (winData.activeblockid === blockId) {
        return;
    }
    winData = produce(winData, (draft) => {
        draft.activeblockid = blockId;
    });
    WOS.setObjectValue(winData, globalStore.set, true);
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

async function openLink(uri: string) {
    if (globalStore.get(atoms.settingsConfigAtom)?.web?.openlinksinternally) {
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

export {
    PLATFORM,
    WOS,
    atoms,
    createBlock,
    fetchWaveFile,
    getApi,
    getEventORefSubject,
    getEventSubject,
    getFileSubject,
    getObjectId,
    globalStore,
    globalWS,
    initGlobal,
    initWS,
    isDev,
    openLink,
    sendWSCommand,
    setBlockFocus,
    setPlatform,
    useBlockAtom,
    useBlockCache,
    useSettingsAtom,
};
