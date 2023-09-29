import * as mobx from "mobx";
import { sprintf } from "sprintf-js";
import dayjs from "dayjs";
import localizedFormat from "dayjs/plugin/localizedFormat";
import type { RemoteType } from "../types/types";

dayjs.extend(localizedFormat);

function isBlank(s: string): boolean {
    return s == null || s == "";
}

function handleNotOkResp(resp: any, url: URL): Promise<any> {
    let errMsg = sprintf(
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
    let contentType = resp.headers.get("Content-Type");
    if (contentType != null && contentType.startsWith("application/json")) {
        return resp.text().then((textData) => {
            let rtnData: any = null;
            try {
                rtnData = JSON.parse(textData);
            } catch (err) {
                let errMsg = sprintf("Unparseable JSON: " + err.message);
                let rtnErr = new Error(errMsg);
                throw rtnErr;
            }
            if (rtnData != null && rtnData.error) {
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
    let rtnData = fetchJsonData(resp, true);
    return rtnData;
}

function base64ToArray(b64: string): Uint8Array {
    let rawStr = atob(b64);
    let rtnArr = new Uint8Array(new ArrayBuffer(rawStr.length));
    for (let i = 0; i < rawStr.length; i++) {
        rtnArr[i] = rawStr.charCodeAt(i);
    }
    return rtnArr;
}

interface IDataType {
    remove?: boolean;
    full?: boolean;
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
    let objMap: Record<string, T> = {};
    for (let i = 0; i < objs.length; i++) {
        let obj = objs[i];
        let id = idFn(obj);
        objMap[id] = obj;
    }
    for (let i = 0; i < dataArr.length; i++) {
        let dataItem = dataArr[i];
        if (dataItem == null) {
            console.log("genMergeSimpleData, null item");
            console.trace();
        }
        let id = idFn(dataItem);
        if (dataItem.remove) {
            delete objMap[id];
            continue;
        } else {
            objMap[id] = dataItem;
        }
    }
    let newObjs = Object.values(objMap);
    if (sortIdxFn) {
        newObjs.sort((a, b) => {
            let astr = sortIdxFn(a);
            let bstr = sortIdxFn(b);
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
    let objMap: Record<string, ObjType> = {};
    for (let i = 0; i < objs.length; i++) {
        let obj = objs[i];
        let id = objIdFn(obj);
        objMap[id] = obj;
    }
    for (let i = 0; i < dataArr.length; i++) {
        let dataItem = dataArr[i];
        if (dataItem == null) {
            console.log("genMergeData, null item");
            console.trace();
            continue;
        }
        let id = dataIdFn(dataItem);
        let obj = objMap[id];
        if (dataItem.remove) {
            if (obj != null) {
                obj.dispose();
                delete objMap[id];
            }
            continue;
        }
        if (obj == null) {
            if (!dataItem.full) {
                console.log("cannot create object, dataitem is not full", objs, dataItem);
                continue;
            }
            obj = ctorFn(dataItem);
            objMap[id] = obj;
            continue;
        }
        obj.mergeData(dataItem);
    }
    let newObjs = Object.values(objMap);
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
    let rtn: { added: string[]; removed: string[] } = { added: [], removed: [] };
    if (dataArr == null || dataArr.length == 0) {
        return rtn;
    }
    for (let i = 0; i < dataArr.length; i++) {
        let dataItem = dataArr[i];
        if (dataItem == null) {
            console.log("genMergeDataMap, null item");
            console.trace();
            continue;
        }
        let id = dataIdFn(dataItem);
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
            if (!dataItem.full) {
                console.log("cannot create object, dataitem is not full", dataItem);
                continue;
            }
            obj = ctorFn(dataItem);
            objMap.set(id, obj);
            rtn.added.push(id);
            continue;
        }
        obj.mergeData(dataItem);
    }
    return rtn;
}

function parseEnv0(envStr64: string): Map<string, string> {
    let envStr = atob(envStr64);
    let parts = envStr.split("\x00");
    let rtn: Map<string, string> = new Map();
    for (let i = 0; i < parts.length; i++) {
        let part = parts[i];
        if (part == "") {
            continue;
        }
        let eqIdx = part.indexOf("=");
        if (eqIdx == -1) {
            continue;
        }
        let varName = part.substr(0, eqIdx);
        let varVal = part.substr(eqIdx + 1);
        rtn.set(varName, varVal);
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

// @check:font
function loadFonts() {
    let jbmFontNormal = new FontFace("JetBrains Mono", "url('static/fonts/jetbrains-mono-v13-latin-regular.woff2')", {
        style: "normal",
        weight: "400",
    });
    let jbmFont200 = new FontFace("JetBrains Mono", "url('static/fonts/jetbrains-mono-v13-latin-200.woff2')", {
        style: "normal",
        weight: "200",
    });
    let jbmFont700 = new FontFace("JetBrains Mono", "url('static/fonts/jetbrains-mono-v13-latin-700.woff2')", {
        style: "normal",
        weight: "700",
    });
    let faFont = new FontFace("FontAwesome", "url(static/fonts/fontawesome-webfont-4.7.woff2)", {
        style: "normal",
        weight: "normal",
    });
    let docFonts: any = document.fonts; // work around ts typing issue
    docFonts.add(jbmFontNormal);
    docFonts.add(jbmFont200);
    docFonts.add(jbmFont700);
    docFonts.add(faFont);
    jbmFontNormal.load();
    jbmFont200.load();
    jbmFont700.load();
    faFont.load();
}

const DOW_STRS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getTodayStr(): string {
    return getDateStr(new Date());
}

function getYesterdayStr(): string {
    let d = new Date();
    d.setDate(d.getDate() - 1);
    return getDateStr(d);
}

function getDateStr(d: Date): string {
    let yearStr = String(d.getFullYear());
    let monthStr = String(d.getMonth() + 1);
    if (monthStr.length == 1) {
        monthStr = "0" + monthStr;
    }
    let dayStr = String(d.getDate());
    if (dayStr.length == 1) {
        dayStr = "0" + dayStr;
    }
    let dowStr = DOW_STRS[d.getDay()];
    return dowStr + " " + yearStr + "-" + monthStr + "-" + dayStr;
}

function getRemoteConnVal(r: RemoteType): number {
    if (r.status == "connected") {
        return 1;
    }
    if (r.status == "connecting") {
        return 2;
    }
    if (r.status == "disconnected") {
        return 3;
    }
    if (r.status == "error") {
        return 4;
    }
    return 5;
}

function sortAndFilterRemotes(origRemotes: RemoteType[]): RemoteType[] {
    let remotes = origRemotes.filter((r) => !r.archived);
    remotes.sort((a, b) => {
        let connValA = getRemoteConnVal(a);
        let connValB = getRemoteConnVal(b);
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

export {
    handleJsonFetchResponse,
    base64ToArray,
    genMergeData,
    genMergeDataMap,
    genMergeSimpleData,
    parseEnv0,
    boundInt,
    isModKeyPress,
    incObs,
    isBlank,
    loadFonts,
    getTodayStr,
    getYesterdayStr,
    getDateStr,
    sortAndFilterRemotes,
    makeExternLink,
    isStrEq,
    isBoolEq,
    hasNoModifiers,
    openLink,
};
