// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// WaveObjectStore

import { Call as $Call, Events } from "@wailsio/runtime";
import * as jotai from "jotai";
import * as React from "react";
import { atoms, globalStore } from "./global";

type WaveObjectDataItemType<T extends WaveObj> = {
    value: T;
    loading: boolean;
};

type WaveObjectValue<T extends WaveObj> = {
    pendingPromise: Promise<T>;
    dataAtom: jotai.PrimitiveAtom<WaveObjectDataItemType<T>>;
    refCount: number;
    holdTime: number;
};

function splitORef(oref: string): [string, string] {
    const parts = oref.split(":");
    if (parts.length != 2) {
        throw new Error("invalid oref");
    }
    return [parts[0], parts[1]];
}

function isBlank(str: string): boolean {
    return str == null || str == "";
}

function isBlankNum(num: number): boolean {
    return num == null || isNaN(num) || num == 0;
}

function isValidWaveObj(val: WaveObj): boolean {
    if (val == null) {
        return false;
    }
    if (isBlank(val.otype) || isBlank(val.oid) || isBlankNum(val.version)) {
        return false;
    }
    return true;
}

function makeORef(otype: string, oid: string): string {
    if (isBlank(otype) || isBlank(oid)) {
        return null;
    }
    return `${otype}:${oid}`;
}

function GetObject<T>(oref: string): Promise<T> {
    return $Call.ByName("github.com/wavetermdev/thenextwave/pkg/service/objectservice.ObjectService.GetObject", oref);
}

const waveObjectValueCache = new Map<string, WaveObjectValue<any>>();

function clearWaveObjectCache() {
    waveObjectValueCache.clear();
}

const defaultHoldTime = 5000; // 5-seconds

function createWaveValueObject<T extends WaveObj>(oref: string, shouldFetch: boolean): WaveObjectValue<T> {
    const wov = { pendingPromise: null, dataAtom: null, refCount: 0, holdTime: Date.now() + 5000 };
    wov.dataAtom = jotai.atom({ value: null, loading: true });
    if (!shouldFetch) {
        return wov;
    }
    const startTs = Date.now();
    const localPromise = GetObject<T>(oref);
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
        console.log("WaveObj resolved", oref, Date.now() - startTs + "ms");
    });
    return wov;
}

function loadAndPinWaveObject<T>(oref: string): Promise<T> {
    let wov = waveObjectValueCache.get(oref);
    if (wov == null) {
        wov = createWaveValueObject(oref, true);
        waveObjectValueCache.set(oref, wov);
    }
    wov.refCount++;
    if (wov.pendingPromise == null) {
        const dataValue = globalStore.get(wov.dataAtom);
        return Promise.resolve(dataValue.value);
    }
    return wov.pendingPromise;
}

function useWaveObjectValueWithSuspense<T>(oref: string): T {
    let wov = waveObjectValueCache.get(oref);
    if (wov == null) {
        wov = createWaveValueObject(oref, true);
        waveObjectValueCache.set(oref, wov);
    }
    React.useEffect(() => {
        wov.refCount++;
        return () => {
            wov.refCount--;
        };
    }, [oref]);
    const dataValue = jotai.useAtomValue(wov.dataAtom);
    if (dataValue.loading) {
        throw wov.pendingPromise;
    }
    return dataValue.value;
}

function getWaveObjectAtom<T extends WaveObj>(oref: string): jotai.WritableAtom<T, [value: T], void> {
    let wov = waveObjectValueCache.get(oref);
    if (wov == null) {
        wov = createWaveValueObject(oref, true);
        waveObjectValueCache.set(oref, wov);
    }
    return jotai.atom(
        (get) => get(wov.dataAtom).value,
        (_get, set, value: T) => {
            setObjectValue(value, set, true);
        }
    );
}

function getWaveObjectLoadingAtom(oref: string): jotai.Atom<boolean> {
    let wov = waveObjectValueCache.get(oref);
    if (wov == null) {
        wov = createWaveValueObject(oref, true);
        waveObjectValueCache.set(oref, wov);
    }
    return jotai.atom((get) => {
        const dataValue = get(wov.dataAtom);
        if (dataValue.loading) {
            return null;
        }
        return dataValue.loading;
    });
}

function useWaveObjectValue<T>(oref: string): [T, boolean] {
    let wov = waveObjectValueCache.get(oref);
    if (wov == null) {
        wov = createWaveValueObject(oref, true);
        waveObjectValueCache.set(oref, wov);
    }
    React.useEffect(() => {
        wov.refCount++;
        return () => {
            wov.refCount--;
        };
    }, [oref]);
    const atomVal = jotai.useAtomValue(wov.dataAtom);
    return [atomVal.value, atomVal.loading];
}

function useWaveObject<T extends WaveObj>(oref: string): [T, boolean, (val: T) => void] {
    let wov = waveObjectValueCache.get(oref);
    if (wov == null) {
        wov = createWaveValueObject(oref, true);
        waveObjectValueCache.set(oref, wov);
    }
    React.useEffect(() => {
        wov.refCount++;
        return () => {
            wov.refCount--;
        };
    }, [oref]);
    const [atomVal, setAtomVal] = jotai.useAtom(wov.dataAtom);
    const simpleSet = (val: T) => {
        setAtomVal({ value: val, loading: false });
        UpdateObject(val, false);
    };
    return [atomVal.value, atomVal.loading, simpleSet];
}

function updateWaveObject(update: WaveObjUpdate) {
    if (update == null) {
        return;
    }
    const oref = makeORef(update.otype, update.oid);
    let wov = waveObjectValueCache.get(oref);
    if (wov == null) {
        wov = createWaveValueObject(oref, false);
        waveObjectValueCache.set(oref, wov);
    }
    if (update.updatetype == "delete") {
        console.log("WaveObj deleted", oref);
        globalStore.set(wov.dataAtom, { value: null, loading: false });
    } else {
        if (!isValidWaveObj(update.obj)) {
            console.log("invalid wave object update", update);
            return;
        }
        const curValue: WaveObjectDataItemType<WaveObj> = globalStore.get(wov.dataAtom);
        if (curValue.value != null && curValue.value.version >= update.obj.version) {
            return;
        }
        console.log("WaveObj updated", oref);
        globalStore.set(wov.dataAtom, { value: update.obj, loading: false });
    }
    wov.holdTime = Date.now() + defaultHoldTime;
    return;
}

function updateWaveObjects(vals: WaveObjUpdate[]) {
    for (const val of vals) {
        updateWaveObject(val);
    }
}

function cleanWaveObjectCache() {
    const now = Date.now();
    for (const [oref, wov] of waveObjectValueCache) {
        if (wov.refCount == 0 && wov.holdTime < now) {
            waveObjectValueCache.delete(oref);
        }
    }
}

Events.On("waveobj:update", (event: any) => {
    const data: WaveObjUpdate[] = event?.data;
    if (data == null) {
        return;
    }
    if (!Array.isArray(data)) {
        console.log("invalid waveobj:update, not an array", data);
        return;
    }
    if (data.length == 0) {
        return;
    }
    updateWaveObjects(data);
});

function wrapObjectServiceCall<T>(fnName: string, ...args: any[]): Promise<T> {
    const uiContext = globalStore.get(atoms.uiContext);
    const startTs = Date.now();
    let prtn = $Call.ByName(
        "github.com/wavetermdev/thenextwave/pkg/service/objectservice.ObjectService." + fnName,
        uiContext,
        ...args
    );
    prtn = prtn.then((val) => {
        console.log("Call", fnName, Date.now() - startTs + "ms");
        if (val.updates) {
            updateWaveObjects(val.updates);
        }
        return val;
    });
    return prtn;
}

// gets the value of a WaveObject from the cache.
// should provide getFn if it is available (e.g. inside of a jotai atom)
// otherwise it will use the globalStore.get function
function getObjectValue<T>(oref: string, getFn?: jotai.Getter): T {
    const wov = waveObjectValueCache.get(oref);
    if (wov === undefined) {
        return null;
    }
    if (getFn === undefined) {
        getFn = globalStore.get;
    }
    const atomVal = getFn(wov.dataAtom);
    return atomVal.value;
}

// sets the value of a WaveObject in the cache.
// should provide setFn if it is available (e.g. inside of a jotai atom)
// otherwise it will use the globalStore.set function
function setObjectValue<T extends WaveObj>(value: T, setFn?: jotai.Setter, pushToServer?: boolean) {
    const oref = makeORef(value.otype, value.oid);
    const wov = waveObjectValueCache.get(oref);
    if (wov === undefined) {
        return;
    }
    if (setFn === undefined) {
        setFn = globalStore.set;
    }
    setFn(wov.dataAtom, { value: value, loading: false });
    if (pushToServer) {
        UpdateObject(value, false);
    }
}

export function AddTabToWorkspace(tabName: string, activateTab: boolean): Promise<{ tabId: string }> {
    return wrapObjectServiceCall("AddTabToWorkspace", tabName, activateTab);
}

export function SetActiveTab(tabId: string): Promise<void> {
    return wrapObjectServiceCall("SetActiveTab", tabId);
}

export function CreateBlock(blockDef: BlockDef, rtOpts: RuntimeOpts): Promise<{ blockId: string }> {
    return wrapObjectServiceCall("CreateBlock", blockDef, rtOpts);
}

export function DeleteBlock(blockId: string): Promise<void> {
    return wrapObjectServiceCall("DeleteBlock", blockId);
}

export function CloseTab(tabId: string): Promise<void> {
    return wrapObjectServiceCall("CloseTab", tabId);
}

export function UpdateObjectMeta(blockId: string, meta: MetadataType): Promise<void> {
    return wrapObjectServiceCall("UpdateObjectMeta", blockId, meta);
}

export function UpdateObject(waveObj: WaveObj, returnUpdates: boolean): Promise<WaveObjUpdate[]> {
    return wrapObjectServiceCall("UpdateObject", waveObj, returnUpdates);
}
export {
    cleanWaveObjectCache,
    clearWaveObjectCache,
    getObjectValue,
    getWaveObjectAtom,
    getWaveObjectLoadingAtom,
    loadAndPinWaveObject,
    makeORef,
    setObjectValue,
    updateWaveObject,
    updateWaveObjects,
    useWaveObject,
    useWaveObjectValue,
    useWaveObjectValueWithSuspense,
    waveObjectValueCache,
};