import * as mobx from "mobx";
import {sprintf} from "sprintf-js";

function fetchJsonData(resp : any, ctErr : boolean) : Promise<any> {
    let contentType = resp.headers.get("Content-Type");
    if (contentType != null && contentType.startsWith("application/json")) {
        return resp.text().then((textData) => {
            let rtnData : any = null;
            try {
                rtnData = JSON.parse(textData);
            }
            catch (err) {
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

function handleJsonFetchResponse(url : URL, resp : any) : Promise<any> {
    if (!resp.ok) {
        let errData = fetchJsonData(resp, false);
        if (errData && errData["error"]) {
            throw new Error(errData["error"])
        }
        let errMsg = sprintf("Bad status code response from fetch '%s': %d %s", url.toString(), resp.status, resp.statusText);
        let rtnErr = new Error(errMsg);
        throw rtnErr;
    }
    let rtnData = fetchJsonData(resp, true);
    return rtnData;
}

function base64ToArray(b64 : string) : Uint8Array {
    let rawStr = atob(b64);
    let rtnArr = new Uint8Array(new ArrayBuffer(rawStr.length));
    for (let i=0; i<rawStr.length; i++) {
        rtnArr[i] = rawStr.charCodeAt(i);
    }
    return rtnArr;
}

interface IDataType {
    remove? : boolean;
    full? : boolean;
}

interface IObjType<DataType> {
    dispose : () => void;
    mergeData : (data : DataType) => void,
}

function genMergeData<ObjType extends IObjType<DataType>, DataType extends IDataType>(
    objs : mobx.IObservableArray<ObjType>,
    dataArr : DataType[],
    objIdFn : (obj : ObjType) => string,
    dataIdFn : (data : DataType) => string,
    ctorFn : (data : DataType) => ObjType,
    sortIdxFn : (obj : ObjType) => number,
) {
    if (dataArr == null || dataArr.length == 0) {
        return;
    }
    let objMap : Record<string, ObjType> = {};
    for (let i=0; i<objs.length; i++) {
        let obj = objs[i];
        let id = objIdFn(obj);
        objMap[id] = obj;
    }
    for (let i=0; i<dataArr.length; i++) {
        let dataItem = dataArr[i];
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
                continue
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

export {handleJsonFetchResponse, base64ToArray, genMergeData};
