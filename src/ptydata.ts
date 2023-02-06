import * as mobx from "mobx";
import {incObs} from "./util";

const InitialSize = 10*1024;
const IncreaseFactor = 1.5;

class PtyDataBuffer {
    ptyPos : number;
    dataVersion : mobx.IObservableValue<number>;
    brokenData : boolean;
    rawData : Uint8Array;
    dataSize : number;

    constructor() {
        this.ptyPos = 0;
        this.dataVersion = mobx.observable.box(0, {name: "dataVersion"});
        this._resetData();
    }

    _resetData() {
        this.dataSize = 0;
        this.rawData = new Uint8Array(InitialSize);
        this.brokenData = false;
    }

    reset() : void {
        this._resetData();
    }

    getData() : Uint8Array {
        return this.rawData.slice(0, this.dataSize);
    }

    _growArray(minSize : number) : void {
        let newSize = Math.round(this.rawData.length * IncreaseFactor);
        if (newSize < minSize) {
            newSize = minSize;
        }
        let newData = new Uint8Array(newSize);
        newData.set(this.rawData);
        this.rawData = newData;
    }

    receiveData(pos : number, data : Uint8Array, reason? : string) : void {
        if (pos != this.dataSize) {
            this.brokenData = true;
            return;
        }
        if (this.dataSize + data.length > this.rawData.length) {
            this._growArray(this.dataSize + data.length);
        }
        this.rawData.set(data, pos);
        this.dataSize += data.length;
        incObs(this.dataVersion);
    }
}

export {PtyDataBuffer};
