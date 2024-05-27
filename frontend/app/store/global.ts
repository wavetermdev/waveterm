// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as jotai from "jotai";
import * as rxjs from "rxjs";
import { Events } from "@wailsio/runtime";
import * as WOS from "./wos";

const globalStore = jotai.createStore();
const urlParams = new URLSearchParams(window.location.search);
const globalWindowId = urlParams.get("windowid");
const globalClientId = urlParams.get("clientid");
const windowIdAtom = jotai.atom(null) as jotai.PrimitiveAtom<string>;
const clientIdAtom = jotai.atom(null) as jotai.PrimitiveAtom<string>;
globalStore.set(windowIdAtom, globalWindowId);
globalStore.set(clientIdAtom, globalClientId);
const uiContextAtom = jotai.atom((get) => {
    const windowData = get(windowDataAtom);
    const uiContext: UIContext = {
        windowid: get(atoms.windowId),
        activetabid: windowData.activetabid,
    };
    return uiContext;
}) as jotai.Atom<UIContext>;
const clientAtom: jotai.Atom<Client> = jotai.atom((get) => {
    const clientId = get(clientIdAtom);
    if (clientId == null) {
        return null;
    }
    return WOS.getStaticObjectValue(WOS.makeORef("client", clientId), get);
});
const windowDataAtom: jotai.Atom<WaveWindow> = jotai.atom((get) => {
    const windowId = get(windowIdAtom);
    if (windowId == null) {
        return null;
    }
    return WOS.getStaticObjectValue(WOS.makeORef("window", windowId), get);
});
const workspaceAtom: jotai.Atom<Workspace> = jotai.atom((get) => {
    const windowData = get(windowDataAtom);
    if (windowData == null) {
        return null;
    }
    return WOS.getStaticObjectValue(WOS.makeORef("workspace", windowData.workspaceid), get);
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

const blockSubjects = new Map<string, SubjectWithRef<any>>();

function getBlockSubject(blockId: string): SubjectWithRef<any> {
    let subject = blockSubjects.get(blockId);
    if (subject == null) {
        subject = new rxjs.Subject<any>() as any;
        subject.refCount = 0;
        subject.release = () => {
            subject.refCount--;
            if (subject.refCount === 0) {
                subject.complete();
                blockSubjects.delete(blockId);
            }
        };
        blockSubjects.set(blockId, subject);
    }
    subject.refCount++;
    return subject;
}

Events.On("block:ptydata", (event: any) => {
    const data = event?.data;
    if (data?.blockid == null) {
        console.log("block:ptydata with null blockid");
        return;
    }
    // we don't use getBlockSubject here because we don't want to create a new subject
    const subject = blockSubjects.get(data.blockid);
    if (subject == null) {
        return;
    }
    subject.next(data);
});

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

export { globalStore, atoms, getBlockSubject, useBlockAtom, WOS };
