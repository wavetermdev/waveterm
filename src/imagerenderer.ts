import * as mobx from "mobx";
import {WindowSize, RendererContext, TermOptsType} from "./types";
import {getPtyData, termWidthFromCols, termHeightFromRows} from "./model";
import {incObs} from "./util";

const InitialSize = 10*1024;
const IncreaseFactor = 1.5;

class ImageRendererModel {
    context : RendererContext;
    dataSize : number;
    imageData : Uint8Array;
    brokenData : boolean;
    isDone : mobx.IObservableValue<boolean>;
    reloading : boolean = false;
    dataVersion : mobx.IObservableValue<number>;
    htmlImgDivElem : any;
    htmlImg : any;
    termOpts : TermOptsType;

    constructor(imgDivElem : any, context : RendererContext, termOpts : TermOptsType, isDone : boolean) {
        this.htmlImgDivElem = imgDivElem;
        this.termOpts = termOpts;
        this.context = context;
        this._resetData();
        this.isDone = mobx.observable.box(isDone, {name: "isDone"});
        this.dataVersion = mobx.observable.box(0, {name: "dataVersion"});
        this.reload(0);
        console.log("image", this.termOpts);
    }

    _resetData() {
        this.dataSize = 0;
        this.imageData = new Uint8Array(InitialSize);
        this.brokenData = false;
    }

    dispose() : void {
        this._resetData();
        this.removeImage();
    }

    removeImage() : void {
        this.htmlImg = null;
        this.htmlImgDivElem.replaceChildren();
    }

    renderImage() : void {
        if (!this.isDone.get()) {
            return;
        }
        let blob = new Blob([this.imageData.slice(0, this.dataSize)], {type: "image/jpeg"});
        this.htmlImg = new Image();
        this.htmlImg.src = URL.createObjectURL(blob);
        this.htmlImg.style.maxHeight = termHeightFromRows(this.termOpts.rows) + "px";
        this.htmlImg.style.maxWidth = termWidthFromCols(this.termOpts.cols) + "px";
        this.htmlImgDivElem.replaceChildren(this.htmlImg);
    }
    
    reload(delayMs : number) : void {
        if (this.reloading) {
            return;
        }
        this._resetData();
        this.reloading = true;
        let rtnp = getPtyData(this.context.sessionId, this.context.cmdId);
        rtnp.then((ptydata) => {
            setTimeout(() => {
                this.reloading = false;
                this.receiveData(ptydata.pos, ptydata.data, "reload");
                this.renderImage();
            }, delayMs);
        }).catch((e) => {
            this.brokenData = true;
            this.reloading = false;
            console.log("error reloading image data", e);
        });
    }

    _growArray(minSize : number) : void {
        let newSize = Math.round(this.imageData.length * IncreaseFactor);
        if (newSize < minSize) {
            newSize = minSize;
        }
        let newData = new Uint8Array(newSize);
        newData.set(this.imageData);
        this.imageData = newData;
    }

    receiveData(pos : number, data : Uint8Array, reason? : string) : void {
        if (pos != this.dataSize) {
            this.brokenData = true;
            return;
        }
        if (this.dataSize + data.length > this.imageData.length) {
            this._growArray(this.dataSize + data.length);
        }
        this.imageData.set(data, pos);
        this.dataSize += data.length;
        incObs(this.dataVersion);
    }

    cmdDone() : void {
        mobx.action(() => {
            this.isDone.set(true);
        })();
    }

    resizeWindow(size : WindowSize) : void {
        return;
    }
    
    resizeCols(cols : number) : void {
        return;
    }
    
    giveFocus() : void {
        return;
    }
    
    getUsedRows() : number {
        return -1;
    }
}

export {ImageRendererModel};

