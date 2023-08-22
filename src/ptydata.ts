import * as mobx from "mobx";
import { incObs } from "./util";

type OV<V> = mobx.IObservableValue<V>;
type OArr<V> = mobx.IObservableArray<V>;
type OMap<K, V> = mobx.ObservableMap<K, V>;

const InitialSize = 10 * 1024;
const IncreaseFactor = 1.5;

class PtyDataBuffer {
    ptyPos: number;
    dataVersion: mobx.IObservableValue<number>;
    brokenData: boolean;
    rawData: Uint8Array;
    dataSize: number;

    constructor() {
        this.ptyPos = 0;
        this.dataVersion = mobx.observable.box(0, { name: "dataVersion" });
        this._resetData();
    }

    _resetData() {
        this.dataSize = 0;
        this.rawData = new Uint8Array(InitialSize);
        this.brokenData = false;
    }

    reset(): void {
        this._resetData();
    }

    getData(): Uint8Array {
        return this.rawData.slice(0, this.dataSize);
    }

    _growArray(minSize: number): void {
        let newSize = Math.round(this.rawData.length * IncreaseFactor);
        if (newSize < minSize) {
            newSize = minSize;
        }
        let newData = new Uint8Array(newSize);
        newData.set(this.rawData);
        this.rawData = newData;
    }

    receiveData(pos: number, data: Uint8Array, reason?: string): void {
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

const NewLineCharCode = "\n".charCodeAt(0);

class PacketDataBuffer extends PtyDataBuffer {
    parsePos: number;
    callback: (any) => void;

    constructor(callback: (any) => void) {
        super();
        this.parsePos = 0;
        this.callback = callback;
    }

    reset(): void {
        super.reset();
        this.parsePos = 0;
    }

    processLine(line: string) {
        if (line.length == 0) {
            return;
        }
        if (!line.startsWith("##")) {
            console.log("invalid line packet", line);
            return;
        }
        let bracePos = line.indexOf("{");
        if (bracePos == -1) {
            console.log("invalid line packet", line);
            return;
        }
        let packetStr = line.substring(bracePos);
        let sizeStr = line.substring(2, bracePos);
        if (sizeStr != "N") {
            let packetSize = parseInt(sizeStr);
            if (isNaN(packetSize) || packetSize != packetStr.length) {
                console.log("invalid line packet", line);
            }
        }
        let packet: any = null;
        try {
            packet = JSON.parse(packetStr);
        } catch (e) {
            console.log("invalid line packet (bad json)", line, e);
            return;
        }
        if (packet != null) {
            this.callback(packet);
        }
    }

    parseData() {
        for (let i = this.parsePos; i < this.dataSize; i++) {
            let ch = this.rawData[i];
            if (ch == NewLineCharCode) {
                // line does *not* include the newline
                let line = new TextDecoder().decode(
                    new Uint8Array(this.rawData.buffer, this.parsePos, i - this.parsePos)
                );
                this.parsePos = i + 1;
                this.processLine(line);
            }
        }
        return;
    }

    receiveData(pos: number, data: Uint8Array, reason?: string): void {
        super.receiveData(pos, data, reason);
        this.parseData();
    }
}

export { PtyDataBuffer, PacketDataBuffer };
