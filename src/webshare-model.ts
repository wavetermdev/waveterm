import * as mobx from "mobx";
import {boundMethod} from "autobind-decorator";
import {handleJsonFetchResponse} from "./util";
import * as T from "./types";

type OV<V> = mobx.IObservableValue<V>;
type OArr<V> = mobx.IObservableArray<V>;
type OMap<K,V> = mobx.ObservableMap<K,V>;
type CV<V> = mobx.IComputedValue<V>;

function isBlank(s : string) {
    return (s == null || s == "");
}

function getBaseUrl() {
    return "https://ot2e112zx5.execute-api.us-west-2.amazonaws.com/dev";
}

class WebShareModelClass {
    viewKey : string;
    screenId : string;
    errMessage : OV<string> = mobx.observable.box(null, {name: "errMessage"});
    screen : OV<T.WebFullScreen> = mobx.observable.box(null, {name: "webScreen"});
    
    constructor() {
        let urlParams = new URLSearchParams(window.location.search);
        this.viewKey = urlParams.get("viewkey");
        this.screenId = urlParams.get("screenid");
        setTimeout(() => this.loadFullScreenData(), 10);
        
    }

    setErrMessage(msg : string) : void {
        mobx.action(() => {
            this.errMessage.set(msg);
        })();
    }

    getSelectedLine() : number {
        return 10;
    }

    loadFullScreenData() : void {
        if (isBlank(this.screenId)) {
            this.setErrMessage("No ScreenId Specified, Cannot Load.");
            return;
        }
        if (isBlank(this.viewKey)) {
            this.setErrMessage("No ViewKey Specified, Cannot Load.");
            return;
        }
        let usp = new URLSearchParams({screenid: this.screenId, viewkey: this.viewKey});
        let url = new URL(getBaseUrl() + "/webshare/screen?" + usp.toString());
        fetch(url, {method: "GET", mode: "cors", cache: "no-cache"}).then((resp) => handleJsonFetchResponse(url, resp)).then((data) => {
            mobx.action(() => this.screen.set(data))();
        }).catch((err) => {
            this.errMessage.set("Cannot get screen: " + err.message);
        });
        
    }
}

let WebShareModel : WebShareModelClass = null;
if ((window as any).WebShareModel == null) {
    WebShareModel = new WebShareModelClass();
    (window as any).WebShareModel = WebShareModel;
}

export {WebShareModel};
