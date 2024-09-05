// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { handleIncomingRpcMessage, sendRawRpcMessage } from "@/app/store/wshrpc";
import {
    getLayoutModelForActiveTab,
    getLayoutModelForTabById,
    LayoutTreeActionType,
    LayoutTreeInsertNodeAction,
    newLayoutNode,
} from "@/layout/index";
import { getWebServerEndpoint, getWSServerEndpoint } from "@/util/endpoints";
import { fetch } from "@/util/fetchutil";
import * as util from "@/util/util";
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
const blockComponentModelMap = new Map<string, BlockComponentModel>();
const Counters = new Map<string, number>();
const ConnStatusMap = new Map<string, jotai.PrimitiveAtom<ConnStatus>>();

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
            globalStore.set(isFullScreenAtom, isFullScreen);
        });
    } catch (_) {
        // do nothing
    }

    const showAboutModalAtom = jotai.atom(false) as jotai.PrimitiveAtom<boolean>;
    try {
        getApi().onMenuItemAbout(() => {
            modalsModel.pushModal("AboutModal");
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
    const fullConfigAtom = jotai.atom(null) as jotai.PrimitiveAtom<FullConfigType>;
    const settingsAtom = jotai.atom((get) => {
        return get(fullConfigAtom)?.settings ?? {};
    }) as jotai.Atom<SettingsType>;
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
    const controlShiftDelayAtom = jotai.atom(false);
    const updaterStatusAtom = jotai.atom<UpdaterStatus>("up-to-date") as jotai.PrimitiveAtom<UpdaterStatus>;
    try {
        globalStore.set(updaterStatusAtom, getApi().getUpdaterStatus());
        getApi().onUpdaterStatusChange((status) => {
            globalStore.set(updaterStatusAtom, status);
        });
    } catch (_) {
        // do nothing
    }
    const reducedMotionPreferenceAtom = jotai.atom((get) => get(settingsAtom)?.["window:reducedmotion"]);
    const typeAheadModalAtom = jotai.atom({});
    const modalOpen = jotai.atom(false);
    atoms = {
        // initialized in wave.ts (will not be null inside of application)
        windowId: windowIdAtom,
        clientId: clientIdAtom,
        uiContext: uiContextAtom,
        client: clientAtom,
        waveWindow: windowDataAtom,
        workspace: workspaceAtom,
        fullConfigAtom,
        settingsAtom,
        tabAtom,
        activeTabId: activeTabIdAtom,
        isFullScreen: isFullScreenAtom,
        controlShiftDelayAtom,
        updaterStatusAtom,
        reducedMotionPreferenceAtom,
        typeAheadModalAtom,
        modalOpen,
    };
}

type WaveEventSubjectContainer = {
    id: string;
    handler: (event: WaveEvent) => void;
    scope: string;
};

// key is "eventType" or "eventType|oref"
const eventSubjects = new Map<string, SubjectWithRef<WSEventType>>();
const fileSubjects = new Map<string, SubjectWithRef<WSFileEventData>>();
const waveEventSubjects = new Map<string, WaveEventSubjectContainer[]>();

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

function makeWaveReSubCommand(eventType: string): RpcMessage {
    let subjects = waveEventSubjects.get(eventType);
    if (subjects == null) {
        return { command: "eventunsub", data: eventType };
    }
    let subreq: SubscriptionRequest = { event: eventType, scopes: [], allscopes: false };
    for (const scont of subjects) {
        if (util.isBlank(scont.scope)) {
            subreq.allscopes = true;
            subreq.scopes = [];
            break;
        }
        subreq.scopes.push(scont.scope);
    }
    return { command: "eventsub", data: subreq };
}

function updateWaveEventSub(eventType: string) {
    const command = makeWaveReSubCommand(eventType);
    sendRawRpcMessage(command);
}

function waveEventSubscribe(eventType: string, scope: string, handler: (event: WaveEvent) => void): () => void {
    if (handler == null) {
        return;
    }
    const id = crypto.randomUUID();
    const subject = new rxjs.Subject() as any;
    const scont: WaveEventSubjectContainer = { id, scope, handler };
    let subjects = waveEventSubjects.get(eventType);
    if (subjects == null) {
        subjects = [];
        waveEventSubjects.set(eventType, subjects);
    }
    subjects.push(scont);
    updateWaveEventSub(eventType);
    return () => waveEventUnsubscribe(eventType, id);
}

function waveEventUnsubscribe(eventType: string, id: string) {
    let subjects = waveEventSubjects.get(eventType);
    if (subjects == null) {
        return;
    }
    const idx = subjects.findIndex((s) => s.id === id);
    if (idx === -1) {
        return;
    }
    subjects.splice(idx, 1);
    if (subjects.length === 0) {
        waveEventSubjects.delete(eventType);
    }
    updateWaveEventSub(eventType);
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

function useSettingsKeyAtom<T extends keyof SettingsType>(key: T): jotai.Atom<SettingsType[T]> {
    let atom = settingsAtomCache.get(key) as jotai.Atom<SettingsType[T]>;
    if (atom == null) {
        atom = jotai.atom((get) => {
            const settings = get(atoms.settingsAtom);
            if (settings == null) {
                return null;
            }
            return settings[key];
        });
        settingsAtomCache.set(key, atom);
    }
    return atom;
}

function useSettingsPrefixAtom(prefix: string): jotai.Atom<SettingsType> {
    // TODO: use a shallow equal here to make this more efficient
    let atom = settingsAtomCache.get(prefix + ":");
    if (atom == null) {
        atom = jotai.atom((get) => {
            const settings = get(atoms.settingsAtom);
            if (settings == null) {
                return {};
            }
            return util.getPrefixedSettings(settings, prefix);
        });
        settingsAtomCache.set(prefix + ":", atom);
    }
    return atom;
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

function useBlockDataLoaded(blockId: string): boolean {
    const loadedAtom = useBlockAtom<boolean>(blockId, "block-loaded", () => {
        return WOS.getWaveObjectLoadingAtom(WOS.makeORef("block", blockId));
    });
    return jotai.useAtomValue(loadedAtom);
}

let globalWS: WSControl = null;

function handleWaveEvent(event: WaveEvent) {
    const subjects = waveEventSubjects.get(event.event);
    if (subjects == null) {
        return;
    }
    for (const scont of subjects) {
        if (util.isBlank(scont.scope)) {
            scont.handler(event);
            continue;
        }
        if (event.scopes == null) {
            continue;
        }
        if (event.scopes.includes(scont.scope)) {
            scont.handler(event);
        }
    }
}

function handleWSEventMessage(msg: WSEventType) {
    if (msg.eventtype == null) {
        console.warn("unsupported WSEvent", msg);
        return;
    }
    if (msg.eventtype == "config") {
        const fullConfig = (msg.data as WatcherUpdate).fullconfig;
        globalStore.set(atoms.fullConfigAtom, fullConfig);
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
        handleIncomingRpcMessage(rpcMsg, handleWaveEvent);
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

async function createBlock(blockDef: BlockDef, magnified = false): Promise<string> {
    const rtOpts: RuntimeOpts = { termsize: { rows: 25, cols: 80 } };
    const blockId = await services.ObjectService.CreateBlock(blockDef, rtOpts);
    const insertNodeAction: LayoutTreeInsertNodeAction = {
        type: LayoutTreeActionType.InsertNode,
        node: newLayoutNode(undefined, undefined, undefined, { blockId }),
        magnified,
        focused: true,
    };
    const activeTabId = globalStore.get(atoms.uiContext).activetabid;
    const layoutModel = getLayoutModelForTabById(activeTabId);
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
    const layoutModel = getLayoutModelForActiveTab();
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

function refocusNode(blockId: string) {
    if (blockId == null) {
        return;
    }
    const layoutModel = getLayoutModelForActiveTab();
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
    const connStatusArr = await services.ClientService.GetAllConnStatus();
    if (connStatusArr == null) {
        return;
    }
    for (const connStatus of connStatusArr) {
        const curAtom = getConnStatusAtom(connStatus.connection);
        globalStore.set(curAtom, connStatus);
    }
}

function subscribeToConnEvents() {
    waveEventSubscribe("connchange", null, (event: WaveEvent) => {
        try {
            const connStatus = event.data as ConnStatus;
            if (connStatus == null || util.isBlank(connStatus.connection)) {
                return;
            }
            console.log("connstatus update", connStatus);
            let curAtom = getConnStatusAtom(connStatus.connection);
            globalStore.set(curAtom, connStatus);
        } catch (e) {
            console.log("connchange error", e);
        }
    });
}

function getConnStatusAtom(conn: string): jotai.PrimitiveAtom<ConnStatus> {
    let rtn = ConnStatusMap.get(conn);
    if (rtn == null) {
        if (util.isBlank(conn)) {
            // create a fake "local" status atom that's always connected
            const connStatus: ConnStatus = {
                connection: conn,
                connected: true,
                error: null,
                status: "connected",
                hasconnected: true,
            };
            rtn = jotai.atom(connStatus);
        } else {
            const connStatus: ConnStatus = {
                connection: conn,
                connected: false,
                error: null,
                status: "disconnected",
                hasconnected: false,
            };
            rtn = jotai.atom(connStatus);
        }
        ConnStatusMap.set(conn, rtn);
    }
    return rtn;
}

export {
    atoms,
    counterInc,
    countersClear,
    countersPrint,
    createBlock,
    fetchWaveFile,
    getApi,
    getBlockComponentModel,
    getConnStatusAtom,
    getEventORefSubject,
    getEventSubject,
    getFileSubject,
    getObjectId,
    getUserName,
    globalStore,
    globalWS,
    initGlobal,
    initWS,
    isDev,
    loadConnStatus,
    openLink,
    PLATFORM,
    refocusNode,
    registerBlockComponentModel,
    sendWSCommand,
    setNodeFocus,
    setPlatform,
    subscribeToConnEvents,
    unregisterBlockComponentModel,
    useBlockAtom,
    useBlockCache,
    useBlockDataLoaded,
    useSettingsKeyAtom,
    useSettingsPrefixAtom,
    waveEventSubscribe,
    waveEventUnsubscribe,
    WOS,
};
