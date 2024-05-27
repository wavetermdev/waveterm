// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as jotai from "jotai";
import * as jotaiUtils from "jotai/utils";
import { v4 as uuidv4 } from "uuid";
import * as rxjs from "rxjs";
import type { WailsEvent } from "@wailsio/runtime/types/events";
import { Events } from "@wailsio/runtime";
import { produce } from "immer";
import { BlockService } from "@/bindings/blockservice";
import { ObjectService } from "@/bindings/objectservice";
import * as wstore from "@/gopkg/wstore";
import { Call as $Call } from "@wailsio/runtime";

const globalStore = jotai.createStore();

const tabId1 = uuidv4();

const tabArr: wstore.Tab[] = [new wstore.Tab({ name: "Tab 1", tabid: tabId1, blockids: [] })];
const blockDataMap = new Map<string, jotai.Atom<wstore.Block>>();
const blockAtomCache = new Map<string, Map<string, jotai.Atom<any>>>();

const atoms = {
    activeTabId: jotai.atom<string>(tabId1),
    tabsAtom: jotai.atom<wstore.Tab[]>(tabArr),
    blockDataMap: blockDataMap,
    clientAtom: jotai.atom(null) as jotai.PrimitiveAtom<wstore.Client>,

    // initialized in wave.ts (will not be null inside of application)
    windowId: jotai.atom<string>(null) as jotai.PrimitiveAtom<string>,
    windowData: jotai.atom<wstore.Window>(null) as jotai.PrimitiveAtom<wstore.Window>,
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

function addBlockIdToTab(tabId: string, blockId: string) {
    let tabArr = globalStore.get(atoms.tabsAtom);
    const newTabArr = produce(tabArr, (draft) => {
        const tab = draft.find((tab) => tab.tabid == tabId);
        tab.blockids.push(blockId);
    });
    globalStore.set(atoms.tabsAtom, newTabArr);
}

function removeBlock(blockId: string) {
    blockDataMap.delete(blockId);
    blockAtomCache.delete(blockId);
}

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
    }
    return atom as jotai.Atom<T>;
}

function removeBlockFromTab(tabId: string, blockId: string) {
    let tabArr = globalStore.get(atoms.tabsAtom);
    const newTabArr = produce(tabArr, (draft) => {
        const tab = draft.find((tab) => tab.tabid == tabId);
        tab.blockids = tab.blockids.filter((id) => id !== blockId);
    });
    globalStore.set(atoms.tabsAtom, newTabArr);
    removeBlock(blockId);
    BlockService.CloseBlock(blockId);
}

function GetObject(oref: string): Promise<any> {
    let prtn = $Call.ByName(
        "github.com/wavetermdev/thenextwave/pkg/service/objectservice.ObjectService.GetObject",
        oref
    );
    return prtn;
}

type WaveObjectHookData = {
    oref: string;
};

type WaveObjectValue<T> = {
    pendingPromise: Promise<any>;
    value: T;
    loading: boolean;
};

const waveObjectValueCache = new Map<string, WaveObjectValue<any>>();
let waveObjectAtomCache = new WeakMap<WaveObjectHookData, jotai.Atom<any>>();

function clearWaveObjectCache() {
    waveObjectValueCache.clear();
    waveObjectAtomCache = new WeakMap<WaveObjectHookData, jotai.Atom<any>>();
}

function createWaveObjectAtom<T>(oref: string): jotai.Atom<[T, boolean]> {
    let cacheVal: WaveObjectValue<T> = waveObjectValueCache.get(oref);
    if (cacheVal == null) {
        cacheVal = { pendingPromise: null, value: null, loading: true };
        cacheVal.pendingPromise = GetObject(oref).then((val) => {
            cacheVal.value = val;
            cacheVal.loading = false;
            cacheVal.pendingPromise = null;
        });
        waveObjectValueCache.set(oref, cacheVal);
    }
    return jotai.atom(
        (get) => {
            return [cacheVal.value, cacheVal.loading];
        },
        (get, set, newVal: T) => {
            cacheVal.value = newVal;
        }
    );
}

function useWaveObjectValue<T>(oref: string): [T, boolean] {
    const objRef = React.useRef<WaveObjectHookData>(null);
    if (objRef.current == null) {
        objRef.current = { oref: oref };
    }
    const objHookData = objRef.current;
    let objAtom = waveObjectAtomCache.get(objHookData);
    if (objAtom == null) {
        objAtom = createWaveObjectAtom(oref);
        waveObjectAtomCache.set(objHookData, objAtom);
    }
    const atomVal = jotai.useAtomValue(objAtom);
    return [atomVal[0], atomVal[1]];
}

function useWaveObject<T>(oref: string): [T, boolean, (T) => void] {
    const objRef = React.useRef<WaveObjectHookData>(null);
    if (objRef.current == null) {
        objRef.current = { oref: oref };
    }
    const objHookData = objRef.current;
    let objAtom = waveObjectAtomCache.get(objHookData);
    if (objAtom == null) {
        objAtom = createWaveObjectAtom(oref);
        waveObjectAtomCache.set(objHookData, objAtom);
    }
    const [atomVal, setAtomVal] = jotai.useAtom(objAtom);
    return [atomVal[0], atomVal[1], setAtomVal];
}

export {
    globalStore,
    atoms,
    getBlockSubject,
    addBlockIdToTab,
    blockDataMap,
    useBlockAtom,
    removeBlockFromTab,
    GetObject,
    useWaveObject,
    useWaveObjectValue,
    clearWaveObjectCache,
};
