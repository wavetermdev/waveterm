import React from "react";
import { GlobalModel } from "../../model/model";
import * as T from "../../types/types";
import { debounce } from "throttle-debounce";
import * as mobx from "mobx";
import * as mobxReact from "mobx-react";
import { parse } from "path";
import { For } from "tsx-control-statements/components";

type OV<V> = mobx.IObservableValue<V>;

class FileViewRendererModel {
    context: T.RendererContext;
    opts: T.RendererOpts;
    api: T.RendererModelContainerApi;
    savedHeight: number;
    updateHeight_debounced: (newHeight: number) => void;
    ptyDataSource: (termContext: T.TermContextUnion) => Promise<T.PtyDataType>;
    rawCmd: T.WebCmd;
    loading: OV<boolean>;
    isDone: OV<boolean>;
    dirList: mobx.IObservableArray<any>;
    version: OV<number>;

    constructor() {
        this.updateHeight_debounced = debounce(1000, this.updateHeight.bind(this));
    }

    initialize(params: T.RendererModelInitializeParams): void {
        this.loading = mobx.observable.box(true, { name: "renderer-loading" });
        this.isDone = mobx.observable.box(params.isDone, { name: "renderer-isDone" });
        this.context = params.context;
        this.opts = params.opts;
        this.api = params.api;
        this.savedHeight = params.savedHeight;
        this.ptyDataSource = params.ptyDataSource;
        this.rawCmd = params.rawCmd;
        this.dirList = mobx.observable.array(null, {
            name: "FileView-directorylist",
        });
    }

    dispose(): void {
        return;
    }

    giveFocus(): void {
        return;
    }

    updateOpts(update: T.RendererOptsUpdate): void {
        Object.assign(this.opts, update);
    }

    setIsDone(): void {
        if (this.isDone.get()) {
            return;
        }
        mobx.action(() => {
            this.isDone.set(true);
        })();
    }

    reload(delayMs: number): void {
        return;
    }

    updateHeight(newHeight: number): void {
        if (this.savedHeight != newHeight) {
            this.savedHeight = newHeight;
            this.api.saveHeight(newHeight);
        }
    }

    parseBytesToUTF(data: Uint8Array): string {
        let rtn = "";
        for (let index = 0; index < data.length; index++) {
            let curByte = data[index];
            rtn += String.fromCharCode(curByte);
        }
        return rtn;
    }

    parseUTFPacketStringJSON(packetString: string) {
        let jsonStartIndex = packetString.indexOf("{");
        let jsonString = packetString.substring(jsonStartIndex, packetString.length).trim();
        let jsonPk = JSON.parse(jsonString);
        return jsonPk;
    }

    receiveData(pos: number, data: Uint8Array, reason?: string): void {
        let packetString = this.parseBytesToUTF(data);
        let pk = this.parseUTFPacketStringJSON(packetString);
        console.log("pk:", pk.name);
        mobx.action(() => {
            this.dirList.push(pk);
        })();
    }
}

@mobxReact.observer
class FileViewRenderer extends React.Component<{ model: FileViewRendererModel }> {
    constructor(props) {
        super(props);
    }

    renderFile(file: any, index: number) {
        let keyString = "file-" + index;
        return <div key={keyString}>{file.name}</div>;
    }

    render() {
        let model: FileViewRendererModel = this.props.model;
        let dirList = model.dirList;
        let file: any;
        let index: number;
        return (
            <div>
                <For each="file" index="index" of={dirList}>
                    {this.renderFile(file, index)}
                </For>
            </div>
        );
    }
}

export { FileViewRendererModel, FileViewRenderer };
