// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as jotai from "jotai";
import * as rxjs from "rxjs";
import * as WOS from "./wos";
import { WSControl } from "./ws";

// TODO remove the window dependency completely
//   we should have the initialization be more orderly -- proceed directly from wave.ts instead of on its own.
const globalStore = jotai.createStore();
let globalWindowId: string = null;
let globalClientId: string = null;
if (typeof window !== "undefined") {
    // this if statement allows us to use the code in nodejs as well
    const urlParams = new URLSearchParams(window.location.search);
    globalWindowId = urlParams.get("windowid") || "74eba2d0-22fc-4221-82ad-d028dd496342";
    globalClientId = urlParams.get("clientid") || "f4bc1713-a364-41b3-a5c4-b000ba10d622";
}
const windowIdAtom = jotai.atom(null) as jotai.PrimitiveAtom<string>;
const clientIdAtom = jotai.atom(null) as jotai.PrimitiveAtom<string>;
globalStore.set(windowIdAtom, globalWindowId);
globalStore.set(clientIdAtom, globalClientId);
const uiContextAtom = jotai.atom((get) => {
    const windowData = get(windowDataAtom);
    const uiContext: UIContext = {
        windowid: get(atoms.windowId),
        activetabid: windowData?.activetabid,
    };
    return uiContext;
}) as jotai.Atom<UIContext>;
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

const atoms = {
    // initialized in wave.ts (will not be null inside of application)
    windowId: windowIdAtom,
    clientId: clientIdAtom,
    uiContext: uiContextAtom,
    client: clientAtom,
    waveWindow: windowDataAtom,
    workspace: workspaceAtom,
};

type SubjectWithRef<T> = rxjs.Subject<T> & { refCount: number; release: () => void };

const orefSubjects = new Map<string, SubjectWithRef<any>>();

function getORefSubject(oref: string): SubjectWithRef<any> {
    let subject = orefSubjects.get(oref);
    if (subject == null) {
        subject = new rxjs.Subject<any>() as any;
        subject.refCount = 0;
        subject.release = () => {
            subject.refCount--;
            if (subject.refCount === 0) {
                subject.complete();
                orefSubjects.delete(oref);
            }
        };
        orefSubjects.set(oref, subject);
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

function getBackendHostPort(): string {
    // TODO deal with dev/production
    return "http://localhost:8190";
}

function getBackendWSHostPort(): string {
    return "ws://localhost:8191";
}

let globalWS: WSControl = null;

function handleWSEventMessage(msg: WSEventType) {
    if (msg.oref == null) {
        console.log("unsupported event", msg);
        return;
    }
    // we don't use getORefSubject here because we don't want to create a new subject
    const subject = orefSubjects.get(msg.oref);
    if (subject == null) {
        return;
    }
    subject.next(msg.data);
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
    globalWS = new WSControl(getBackendWSHostPort(), globalStore, globalWindowId, "", (msg) => {
        handleWSMessage(msg);
    });
    globalWS.connectNow("initWS");
}

function sendWSCommand(command: WSCommandType) {
    globalWS.pushMessage(command);
}

export {
    WOS,
    atoms,
    getBackendHostPort,
    getORefSubject,
    globalStore,
    globalWS,
    initWS,
    sendWSCommand,
    useBlockAtom,
    useBlockCache,
};
