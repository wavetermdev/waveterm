import * as mobx from "mobx";
import {WindowSize} from "./types";

const InitialSize = 10*1024;
const IncreaseFactor = 1.5;

class ImageRenderer {
    dataSize : number;
    imageData : Uint8Array;
    brokenData : boolean;
    isDone : mobx.IObservableValue<boolean>;

    constructor() {
        this._resetData();
        this.isDone = mobx.observable.box(false, {name: "isDone"});
    }

    _resetData() {
        this.dataSize = 0;
        this.imageData = new Uint8Array(InitialSize);
        this.brokenData = false;
    }

    dispose() : void {
        this._resetData();
    }
    
    reload(delayMs : number) : void {
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
    }

    cmdDone() : void {
    }

    resizeWindow(size : WindowSize) : void {
    }
    
    resizeCols(cols : number) : void {
    }
    
    giveFocus() : void {
    }
    
    getUsedRows() : number {
        return -1;
    }
}

export {ImageRenderer};

