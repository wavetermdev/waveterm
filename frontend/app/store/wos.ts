// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// WaveObjectStore

import * as React from "react";
import * as jotai from "jotai";
import { Events } from "@wailsio/runtime";
import { Call as $Call } from "@wailsio/runtime";
import { globalStore, atoms } from "./global";

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
    let parts = oref.split(":");
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
    let prtn = $Call.ByName(
        "github.com/wavetermdev/thenextwave/pkg/service/objectservice.ObjectService.GetObject",
        oref
    );
    return prtn;
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

function useWaveObject<T>(oref: string): [T, boolean, (T) => void] {
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
    };
    return [atomVal.value, atomVal.loading, simpleSet];
}

function updateWaveObject(update: WaveObjUpdate) {
    if (update == null) {
        return;
    }
    let oref = makeORef(update.otype, update.oid);
    let wov = waveObjectValueCache.get(oref);
    if (wov == null) {
        wov = createWaveValueObject(oref, false);
        waveObjectValueCache.set(oref, wov);
    }
    if (update.updatetype == "delete") {
        globalStore.set(wov.dataAtom, { value: null, loading: false });
    } else {
        if (!isValidWaveObj(update.obj)) {
            console.log("invalid wave object update", update);
            return;
        }
        let curValue: WaveObjectDataItemType<WaveObj> = globalStore.get(wov.dataAtom);
        if (curValue.value != null && curValue.value.version >= update.obj.version) {
            return;
        }
        globalStore.set(wov.dataAtom, { value: update.obj, loading: false });
    }
    wov.holdTime = Date.now() + defaultHoldTime;
    return;
}

function updateWaveObjects(vals: WaveObjUpdate[]) {
    for (let val of vals) {
        updateWaveObject(val);
    }
}

function cleanWaveObjectCache() {
    let now = Date.now();
    for (let [oref, wov] of waveObjectValueCache) {
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
    let prtn = $Call.ByName(
        "github.com/wavetermdev/thenextwave/pkg/service/objectservice.ObjectService." + fnName,
        uiContext,
        ...args
    );
    prtn = prtn.then((val) => {
        if (val.updates) {
            updateWaveObjects(val.updates);
        }
        return val;
    });
    return prtn;
}

function getStaticObjectValue<T>(oref: string, getFn: jotai.Getter): T {
    let wov = waveObjectValueCache.get(oref);
    if (wov == null) {
        return null;
    }
    const atomVal = getFn(wov.dataAtom);
    return atomVal.value;
}

function AddTabToWorkspace(tabName: string, activateTab: boolean): Promise<{ tabId: string }> {
    return wrapObjectServiceCall("AddTabToWorkspace", tabName, activateTab);
}

function SetActiveTab(tabId: string): Promise<void> {
    return wrapObjectServiceCall("SetActiveTab", tabId);
}

function CreateBlock(blockDef: BlockDef, rtOpts: RuntimeOpts): Promise<{ blockId: string }> {
    return wrapObjectServiceCall("CreateBlock", blockDef, rtOpts);
}

export {
    makeORef,
    useWaveObject,
    useWaveObjectValue,
    useWaveObjectValueWithSuspense,
    loadAndPinWaveObject,
    clearWaveObjectCache,
    updateWaveObject,
    updateWaveObjects,
    cleanWaveObjectCache,
    getStaticObjectValue,
    AddTabToWorkspace,
    SetActiveTab,
    CreateBlock,
};
