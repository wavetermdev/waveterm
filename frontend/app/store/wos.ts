// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// WaveObjectStore

import { sendRpcCommand } from "@/app/store/wshrpc";
import { getWebServerEndpoint } from "@/util/endpoints";
import * as jotai from "jotai";
import * as React from "react";
import { atoms, globalStore } from "./global";
import * as services from "./services";

const IsElectron = true;

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

type WritableWaveObjectAtom<T extends WaveObj> = jotai.WritableAtom<T, [value: T], void>;

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
    return callBackendService("object", "GetObject", [oref], true);
}

function callBackendService(service: string, method: string, args: any[], noUIContext?: boolean): Promise<any> {
    const startTs = Date.now();
    let uiContext: UIContext = null;
    if (!noUIContext) {
        uiContext = globalStore.get(atoms.uiContext);
    }
    const waveCall: WebCallType = {
        service: service,
        method: method,
        args: args,
        uicontext: uiContext,
    };
    // usp is just for debugging (easier to filter URLs)
    const methodName = `${service}.${method}`;
    const usp = new URLSearchParams();
    usp.set("service", service);
    usp.set("method", method);
    const url = getWebServerEndpoint() + "/wave/service?" + usp.toString();
    const fetchPromise = fetch(url, {
        method: "POST",
        body: JSON.stringify(waveCall),
    });
    const prtn = fetchPromise
        .then((resp) => {
            if (!resp.ok) {
                throw new Error(`call ${methodName} failed: ${resp.status} ${resp.statusText}`);
            }
            return resp.json();
        })
        .then((respData: WebReturnType) => {
            if (respData == null) {
                return null;
            }
            if (respData.updates != null) {
                updateWaveObjects(respData.updates);
            }
            if (respData.error != null) {
                throw new Error(`call ${methodName} error: ${respData.error}`);
            }
            console.log("Call", methodName, Date.now() - startTs + "ms");
            return respData.data;
        });
    return prtn;
}

function wshServerRpcHelper_responsestream(
    command: string,
    data: any,
    opts: RpcOpts
): AsyncGenerator<any, void, boolean> {
    if (opts?.noresponse) {
        throw new Error("noresponse not supported for responsestream calls");
    }
    const msg: RpcMessage = {
        command: command,
        data: data,
        reqid: crypto.randomUUID(),
    };
    if (opts?.timeout) {
        msg.timeout = opts.timeout;
    }
    if (opts?.route) {
        msg.route = opts.route;
    }
    const rpcGen = sendRpcCommand(msg);
    return rpcGen;
}

function wshServerRpcHelper_call(command: string, data: any, opts: RpcOpts): Promise<any> {
    const msg: RpcMessage = {
        command: command,
        data: data,
    };
    if (!opts?.noresponse) {
        msg.reqid = crypto.randomUUID();
    }
    if (opts?.timeout) {
        msg.timeout = opts.timeout;
    }
    if (opts?.route) {
        msg.route = opts.route;
    }
    const rpcGen = sendRpcCommand(msg);
    if (rpcGen == null) {
        return null;
    }
    const respMsgPromise = rpcGen.next(true); // pass true to force termination of rpc after 1 response (not streaming)
    return respMsgPromise.then((msg: IteratorResult<any, void>) => {
        return msg.value;
    });
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

function getWaveObjectValue<T extends WaveObj>(oref: string, createIfMissing = true): WaveObjectValue<T> {
    let wov = waveObjectValueCache.get(oref);
    if (wov === undefined && createIfMissing) {
        wov = createWaveValueObject(oref, true);
        waveObjectValueCache.set(oref, wov);
    }
    return wov;
}

function loadAndPinWaveObject<T extends WaveObj>(oref: string): Promise<T> {
    const wov = getWaveObjectValue<T>(oref);
    wov.refCount++;
    if (wov.pendingPromise == null) {
        const dataValue = globalStore.get(wov.dataAtom);
        return Promise.resolve(dataValue.value);
    }
    return wov.pendingPromise;
}

function getWaveObjectAtom<T extends WaveObj>(oref: string): WritableWaveObjectAtom<T> {
    const wov = getWaveObjectValue<T>(oref);
    return jotai.atom(
        (get) => get(wov.dataAtom).value,
        (_get, set, value: T) => {
            setObjectValue(value, set, true);
        }
    );
}

function getWaveObjectLoadingAtom(oref: string): jotai.Atom<boolean> {
    const wov = getWaveObjectValue(oref);
    return jotai.atom((get) => {
        const dataValue = get(wov.dataAtom);
        if (dataValue.loading) {
            return null;
        }
        return dataValue.loading;
    });
}

function useWaveObjectValue<T extends WaveObj>(oref: string): [T, boolean] {
    const wov = getWaveObjectValue<T>(oref);
    React.useEffect(() => {
        wov.refCount++;
        return () => {
            wov.refCount--;
        };
    }, [oref]);
    const atomVal = jotai.useAtomValue(wov.dataAtom);
    return [atomVal.value, atomVal.loading];
}

function updateWaveObject(update: WaveObjUpdate) {
    if (update == null) {
        return;
    }
    const oref = makeORef(update.otype, update.oid);
    const wov = getWaveObjectValue(oref);
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

// gets the value of a WaveObject from the cache.
// should provide getFn if it is available (e.g. inside of a jotai atom)
// otherwise it will use the globalStore.get function
function getObjectValue<T extends WaveObj>(oref: string, getFn?: jotai.Getter): T {
    const wov = getWaveObjectValue<T>(oref);
    if (getFn == null) {
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
    const wov = getWaveObjectValue(oref, false);
    if (wov === undefined) {
        return;
    }
    if (setFn === undefined) {
        setFn = globalStore.set;
    }
    setFn(wov.dataAtom, { value: value, loading: false });
    if (pushToServer) {
        services.ObjectService.UpdateObject(value, false);
    }
}

export {
    callBackendService,
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
    useWaveObjectValue,
    wshServerRpcHelper_call,
    wshServerRpcHelper_responsestream,
};
