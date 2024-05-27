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
const blockDataMap = new Map<string, jotai.Atom<wstore.Block>>();

const atoms = {
    blockDataMap: blockDataMap,
    clientAtom: jotai.atom(null) as jotai.PrimitiveAtom<wstore.Client>,

    // initialized in wave.ts (will not be null inside of application)
    windowId: jotai.atom<string>(null) as jotai.PrimitiveAtom<string>,
    windowData: jotai.atom<WaveWindow>(null) as jotai.PrimitiveAtom<WaveWindow>,
};

type SubjectWithRef<T> = rxjs.Subject<T> & { refCount: number; release: () => void };

const blockSubjects = new Map<string, SubjectWithRef<any>>();

function isBlank(str: string): boolean {
    return str == null || str == "";
}

function makeORef(otype: string, oid: string): string {
    if (isBlank(otype) || isBlank(oid)) {
        return null;
    }
    return `${otype}:${oid}`;
}

function splitORef(oref: string): [string, string] {
    let parts = oref.split(":");
    if (parts.length != 2) {
        throw new Error("invalid oref");
    }
    return [parts[0], parts[1]];
}

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

function GetObject<T>(oref: string): Promise<T> {
    let prtn = $Call.ByName(
        "github.com/wavetermdev/thenextwave/pkg/service/objectservice.ObjectService.GetObject",
        oref
    );
    return prtn;
}

function GetClientObject(): Promise<Client> {
    let prtn = $Call.ByName(
        "github.com/wavetermdev/thenextwave/pkg/service/objectservice.ObjectService.GetClientObject"
    );
    return prtn;
}

type WaveObjectValue<T> = {
    pendingPromise: Promise<any>;
    dataAtom: jotai.PrimitiveAtom<{ value: T; loading: boolean }>;
};

const waveObjectValueCache = new Map<string, WaveObjectValue<any>>();

function clearWaveObjectCache() {
    waveObjectValueCache.clear();
}

function createWaveValueObject<T>(oref: string): WaveObjectValue<T> {
    const wov = { pendingPromise: null, dataAtom: null };
    wov.dataAtom = jotai.atom({ value: null, loading: true });
    let startTs = Date.now();
    let localPromise = GetObject<T>(oref);
    wov.pendingPromise = localPromise;
    localPromise.then((val) => {
        if (wov.pendingPromise != localPromise) {
            return;
        }
        const [otype, oid] = splitORef(oref);
        if (val != null) {
            if (val["otype"] != otype) {
                throw new Error("GetObject returned wrong type");
            }
            if (val["oid"] != oid) {
                throw new Error("GetObject returned wrong id");
            }
        }
        wov.pendingPromise = null;
        globalStore.set(wov.dataAtom, { value: val, loading: false });
        console.log("GetObject resolved", oref, val, Date.now() - startTs + "ms");
    });
    return wov;
}

function useWaveObjectValue<T>(oref: string): [T, boolean] {
    console.log("useWaveObjectValue", oref);
    let wov = waveObjectValueCache.get(oref);
    if (wov == null) {
        console.log("creating new wov", oref);
        wov = createWaveValueObject(oref);
        waveObjectValueCache.set(oref, wov);
    }
    const atomVal = jotai.useAtomValue(wov.dataAtom);
    return [atomVal.value, atomVal.loading];
}

function useWaveObject<T>(oref: string): [T, boolean, (T) => void] {
    console.log("useWaveObject", oref);
    let wov = waveObjectValueCache.get(oref);
    if (wov == null) {
        wov = createWaveValueObject(oref);
        waveObjectValueCache.set(oref, wov);
    }
    const [atomVal, setAtomVal] = jotai.useAtom(wov.dataAtom);
    const simpleSet = (val: T) => {
        setAtomVal({ value: val, loading: false });
    };
    return [atomVal.value, atomVal.loading, simpleSet];
}

export {
    globalStore,
    makeORef,
    atoms,
    getBlockSubject,
    blockDataMap,
    useBlockAtom,
    GetObject,
    GetClientObject,
    useWaveObject,
    useWaveObjectValue,
    clearWaveObjectCache,
};
