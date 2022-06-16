function fetchJsonData(resp : any, ctErr : boolean) : Promise<any> {
    let contentType = resp.headers.get("Content-Type");
    if (contentType != null && contentType.startsWith("application/json")) {
        return resp.text().then((textData) => {
            try {
                return JSON.parse(textData);
            }
            catch (err) {
                let errMsg = sprintf("Unparseable JSON: " + err.message);
                let rtnErr = new Error(errMsg);
                throw rtnErr;
            }
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

export {handleJsonFetchResponse};
