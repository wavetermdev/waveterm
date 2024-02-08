import React from "react";
import { GlobalModel } from "../../model/model";
import * as T from "../../types/types";
import { debounce } from "throttle-debounce";
import * as mobx from "mobx";
import * as mobxReact from "mobx-react";
import { parse } from "path";

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
        console.log("data: ", data);
        var rtn = "";
        for (let index = 0; index < data.length; index++) {
            let curByte = data[index];
            rtn += String.fromCharCode(curByte);
        }
        return rtn;
    }

    receiveData(pos: number, data: Uint8Array, reason?: string): void {
        console.log("received data in fileview", pos, this.parseBytesToUTF(data), reason);
    }
}

class FileViewRenderer extends React.Component<{ model: FileViewRendererModel }> {
    render() {
        return (
            <div>
                <h1>File View Full Renderer Test</h1>
            </div>
        );
    }
}

export { FileViewRendererModel, FileViewRenderer };
