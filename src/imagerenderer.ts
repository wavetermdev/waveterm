import * as mobx from "mobx";
import {WindowSize, RendererContext, TermOptsType} from "./types";
import {getPtyData, termWidthFromCols, termHeightFromRows} from "./model";
import {incObs} from "./util";
import {PtyDataBuffer} from "./ptydata";

class ImageRendererModel {
    context : RendererContext;
    isDone : mobx.IObservableValue<boolean>;
    reloading : boolean = false;
    htmlImgDivElem : any;
    htmlImg : any;
    termOpts : TermOptsType;
    dataBuf : PtyDataBuffer;
    fontSize : number;

    constructor(imgDivElem : any, context : RendererContext, termOpts : TermOptsType, isDone : boolean, fontSize : number) {
        this.dataBuf = new PtyDataBuffer();
        this.htmlImgDivElem = imgDivElem;
        this.termOpts = termOpts;
        this.context = context;
        this.isDone = mobx.observable.box(isDone, {name: "isDone"});
        this.fontSize = fontSize;
        this.reload(0);
    }

    dispose() : void {
        this.dataBuf.reset();
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
        let blob = new Blob([this.dataBuf.getData()], {type: "image/jpeg"});
        this.htmlImg = new Image();
        this.htmlImg.src = URL.createObjectURL(blob);
        this.htmlImg.style.maxHeight = termHeightFromRows(this.termOpts.rows, this.fontSize) + "px";
        this.htmlImg.style.maxWidth = termWidthFromCols(this.termOpts.cols, this.fontSize) + "px";
        this.htmlImgDivElem.replaceChildren(this.htmlImg);
    }
    
    reload(delayMs : number) : void {
        if (this.reloading) {
            return;
        }
        this.dataBuf.reset();
        this.reloading = true;
        let rtnp = getPtyData(this.context.sessionId, this.context.cmdId);
        rtnp.then((ptydata) => {
            setTimeout(() => {
                this.reloading = false;
                this.dataBuf.receiveData(ptydata.pos, ptydata.data, "reload");
                this.renderImage();
            }, delayMs);
        }).catch((e) => {
            this.dataBuf.brokenData = true;
            this.reloading = false;
            console.log("error reloading image data", e);
        });
    }

    receiveData(pos : number, data : Uint8Array, reason? : string) : void {
        this.dataBuf.receiveData(pos, data, reason);
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

