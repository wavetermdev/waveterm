// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as mobx from "mobx";
import { sprintf } from "sprintf-js";
import dayjs from "dayjs";
import localizedFormat from "dayjs/plugin/localizedFormat";
import base64 from "base64-js";

dayjs.extend(localizedFormat);

function isBlank(s: string): boolean {
    return s == null || s == "";
}

function handleNotOkResp(resp: any, url: URL): Promise<any> {
    const errMsg = sprintf(
        "Bad status code response from fetch '%s': code=%d %s",
        url.toString(),
        resp.status,
        resp.statusText
    );
    return resp.text().then((textData) => {
        if (textData == null || textData == "") {
            throw new Error(errMsg);
        }
        let rtnData: any = null;
        try {
            rtnData = JSON.parse(textData);
        } catch (err) {
            // nothing (rtnData will be null)
        }
        if (rtnData != null && typeof rtnData == "object" && rtnData["error"] != null) {
            throw new Error(rtnData["error"]);
        }
        throw new Error(errMsg + "\n" + textData);
    });
}

function fetchJsonData(resp: any, ctErr: boolean): Promise<any> {
    const contentType = resp.headers.get("Content-Type");
    if (contentType?.startsWith("application/json")) {
        return resp.text().then((textData) => {
            let rtnData: any = null;
            try {
                rtnData = JSON.parse(textData);
            } catch (err) {
                const errMsg = sprintf("Unparseable JSON: " + err.message);
                const rtnErr = new Error(errMsg);
                throw rtnErr;
            }
            if (rtnData?.error) {
                throw new Error(rtnData.error);
            }
            return rtnData;
        });
    }
    if (ctErr) {
        throw new Error("non-json content-type");
    }
}

function handleJsonFetchResponse(url: URL, resp: any): Promise<any> {
    if (!resp.ok) {
        return handleNotOkResp(resp, url);
    }
    const rtnData = fetchJsonData(resp, true);
    return rtnData;
}

function base64ToString(b64: string): string {
    const stringBytes = base64.toByteArray(b64);
    return new TextDecoder().decode(stringBytes);
}

function stringToBase64(input: string): string {
    const stringBytes = new TextEncoder().encode(input);
    return base64.fromByteArray(stringBytes);
}

function base64ToArray(b64: string): Uint8Array {
    const rawStr = atob(b64);
    const rtnArr = new Uint8Array(new ArrayBuffer(rawStr.length));
    for (let i = 0; i < rawStr.length; i++) {
        rtnArr[i] = rawStr.charCodeAt(i);
    }
    return rtnArr;
}

interface IDataType {
    remove?: boolean;
}

interface IObjType<DataType> {
    dispose: () => void;
    mergeData: (data: DataType) => void;
}

interface ISimpleDataType {
    remove?: boolean;
}

function genMergeSimpleData<T extends ISimpleDataType>(
    objs: mobx.IObservableArray<T>,
    dataArr: T[],
    idFn: (obj: T) => string,
    sortIdxFn: (obj: T) => string
) {
    if (dataArr == null || dataArr.length == 0) {
        return;
    }
    const objMap: Record<string, T> = {};
    for (const obj of objs) {
        const id = idFn(obj);
        objMap[id] = obj;
    }
    for (const dataItem of dataArr) {
        if (dataItem == null) {
            console.log("genMergeSimpleData, null item");
            console.trace();
        }
        const id = idFn(dataItem);
        if (dataItem.remove) {
            delete objMap[id];
        } else {
            objMap[id] = dataItem;
        }
    }
    const newObjs = Object.values(objMap);
    if (sortIdxFn) {
        newObjs.sort((a, b) => {
            const astr = sortIdxFn(a);
            const bstr = sortIdxFn(b);
            return astr.localeCompare(bstr);
        });
    }
    objs.replace(newObjs);
}

function genMergeData<ObjType extends IObjType<DataType>, DataType extends IDataType>(
    objs: mobx.IObservableArray<ObjType>,
    dataArr: DataType[],
    objIdFn: (obj: ObjType) => string,
    dataIdFn: (data: DataType) => string,
    ctorFn: (data: DataType) => ObjType,
    sortIdxFn: (obj: ObjType) => number
) {
    if (dataArr == null || dataArr.length == 0) {
        return;
    }
    const objMap: Record<string, ObjType> = {};
    for (const obj of objs) {
        const id = objIdFn(obj);
        objMap[id] = obj;
    }
    for (const dataItem of dataArr) {
        if (dataItem == null) {
            console.log("genMergeData, null item");
            console.trace();
            continue;
        }
        const id = dataIdFn(dataItem);
        let obj = objMap[id];
        if (dataItem.remove) {
            if (obj != null) {
                obj.dispose();
                delete objMap[id];
            }
            continue;
        }
        if (obj == null) {
            obj = ctorFn(dataItem);
            objMap[id] = obj;
            continue;
        }
        obj.mergeData(dataItem);
    }
    const newObjs = Object.values(objMap);
    if (sortIdxFn) {
        newObjs.sort((a, b) => {
            return sortIdxFn(a) - sortIdxFn(b);
        });
    }
    objs.replace(newObjs);
}

function genMergeDataMap<ObjType extends IObjType<DataType>, DataType extends IDataType>(
    objMap: mobx.ObservableMap<string, ObjType>,
    dataArr: DataType[],
    objIdFn: (obj: ObjType) => string,
    dataIdFn: (data: DataType) => string,
    ctorFn: (data: DataType) => ObjType
): { added: string[]; removed: string[] } {
    const rtn: { added: string[]; removed: string[] } = { added: [], removed: [] };
    if (dataArr == null || dataArr.length == 0) {
        return rtn;
    }
    for (const dataItem of dataArr) {
        if (dataItem == null) {
            console.log("genMergeDataMap, null item");
            console.trace();
            continue;
        }
        const id = dataIdFn(dataItem);
        let obj = objMap.get(id);
        if (dataItem.remove) {
            if (obj != null) {
                obj.dispose();
                objMap.delete(id);
                rtn.removed.push(id);
            }
            continue;
        }
        if (obj == null) {
            obj = ctorFn(dataItem);
            objMap.set(id, obj);
            rtn.added.push(id);
            continue;
        }
        obj.mergeData(dataItem);
    }
    return rtn;
}

function boundInt(ival: number, minVal: number, maxVal: number): number {
    if (ival < minVal) {
        return minVal;
    }
    if (ival > maxVal) {
        return maxVal;
    }
    return ival;
}

function isModKeyPress(e: any) {
    return e.code.match(/^(Control|Meta|Alt|Shift)(Left|Right)$/);
}

function incObs(inum: mobx.IObservableValue<number>) {
    mobx.action(() => {
        inum.set(inum.get() + 1);
    })();
}

const DOW_STRS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getTodayStr(): string {
    return getDateStr(new Date());
}

function getYesterdayStr(): string {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return getDateStr(d);
}

function getDateStr(d: Date): string {
    const yearStr = String(d.getFullYear());
    let monthStr = String(d.getMonth() + 1);
    if (monthStr.length == 1) {
        monthStr = "0" + monthStr;
    }
    let dayStr = String(d.getDate());
    if (dayStr.length == 1) {
        dayStr = "0" + dayStr;
    }
    const dowStr = DOW_STRS[d.getDay()];
    return dowStr + " " + yearStr + "-" + monthStr + "-" + dayStr;
}

function formatDuration(ms: number): string {
    if (ms < 1000) {
        return ms + "ms";
    }
    if (ms < 10000) {
        return (ms / 1000).toFixed(2) + "s";
    }
    if (ms < 100000) {
        return (ms / 1000).toFixed(1) + "s";
    }
    if (ms < 60 * 60 * 1000) {
        let mins = Math.floor(ms / 60000);
        let secs = Math.floor((ms % 60000) / 1000);
        return mins + "m" + secs + "s";
    }
    let hours = Math.floor(ms / (60 * 60 * 1000));
    let mins = Math.floor((ms % (60 * 60 * 1000)) / 60000);
    return hours + "h" + mins + "m";
}

function getRemoteConnVal(r: RemoteType): number {
    switch (r.status) {
        case "connected":
            return 1;
        case "connecting":
            return 2;
        case "disconnected":
            return 3;
        case "error":
            return 4;
        default:
            return 5;
    }
}

function sortAndFilterRemotes(origRemotes: RemoteType[]): RemoteType[] {
    const remotes = origRemotes.filter((r) => !r.archived);
    remotes.sort((a, b) => {
        const connValA = getRemoteConnVal(a);
        const connValB = getRemoteConnVal(b);
        if (connValA != connValB) {
            return connValA - connValB;
        }
        return a.remoteidx - b.remoteidx;
    });
    return remotes;
}

function makeExternLink(url: string): string {
    return "https://extern?" + encodeURIComponent(url);
}

function isStrEq(s1: string, s2: string) {
    if (isBlank(s1) && isBlank(s2)) {
        return true;
    }
    return s1 == s2;
}

function isBoolEq(b1: boolean, b2: boolean) {
    return !!b1 == !!b2;
}

function hasNoModifiers(e: any): boolean {
    return (
        !e.getModifierState("Shift") &&
        !e.getModifierState("Control") &&
        !e.getModifierState("Meta") &&
        !e.getModifierState("Alt")
    );
}

function openLink(url: string): void {
    window.open(url, "_blank");
}

function getColorRGB(colorInput: string) {
    const tempElement = document.createElement("div");
    tempElement.style.color = colorInput;
    document.body.appendChild(tempElement);
    const computedColorStyle = window.getComputedStyle(tempElement).color;
    document.body.removeChild(tempElement);
    return computedColorStyle;
}

function commandRtnHandler(prtn: Promise<CommandRtnType>, errorMessage: OV<string>, onSuccess?: () => void) {
    prtn.then((crtn) => {
        if (crtn.success) {
            if (onSuccess) {
                onSuccess();
            }
            return;
        }
        mobx.action(() => {
            errorMessage.set(crtn.error);
        })();
    });
}

function getRemoteName(remote: RemoteType): string {
    if (remote == null) {
        return "";
    }
    const { remotealias, remotecanonicalname } = remote;
    return remotealias ? `${remotealias} [${remotecanonicalname}]` : remotecanonicalname;
}

// clean empty string
function ces(s: string) {
    if (s == "") {
        return null;
    }
    return s;
}

/**
 * A wrapper function for running a promise and catching any errors
 * @param f The promise to run
 */
function fireAndForget(f: () => Promise<any>) {
    f().catch((e) => {
        console.log("fireAndForget error", e);
    });
}

export {
    handleJsonFetchResponse,
    base64ToString,
    stringToBase64,
    base64ToArray,
    genMergeData,
    genMergeDataMap,
    genMergeSimpleData,
    boundInt,
    isModKeyPress,
    incObs,
    isBlank,
    getTodayStr,
    getYesterdayStr,
    getDateStr,
    sortAndFilterRemotes,
    makeExternLink,
    isStrEq,
    isBoolEq,
    hasNoModifiers,
    openLink,
    getColorRGB,
    commandRtnHandler,
    getRemoteConnVal,
    getRemoteName,
    ces,
    fireAndForget,
    formatDuration,
};
