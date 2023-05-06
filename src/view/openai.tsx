import * as React from "react";
import * as mobx from "mobx";
import * as mobxReact from "mobx-react";
import cn from "classnames";
import {If, For, When, Otherwise, Choose} from "tsx-control-statements/components";
import * as T from "../types";
import {debounce, throttle} from "throttle-debounce";
import {boundMethod} from "autobind-decorator";
import {sprintf} from "sprintf-js";
import {PacketDataBuffer} from "../ptydata";
import {Markdown} from "../elements";

type OV<V> = mobx.IObservableValue<V>;
type OArr<V> = mobx.IObservableArray<V>;
type OMap<K,V> = mobx.ObservableMap<K,V>;

type OpenAIOutputType = {
    model : string,
    created : number,
    finish_reason : string,
    message : string,
};

class OpenAIRendererModel {
    context : T.RendererContext;
    opts : T.RendererOpts;
    isDone : OV<boolean>;
    api : T.RendererModelContainerApi;
    savedHeight : number;
    loading : OV<boolean>;
    loadError : OV<string> = mobx.observable.box(null, {name: "renderer-loadError"});
    updateHeight_debounced : (newHeight : number) => void;
    ptyDataSource : (termContext : T.TermContextUnion) => Promise<T.PtyDataType>;
    packetData : PacketDataBuffer;
    rawCmd : T.WebCmd;
    output : OV<OpenAIOutputType>;
    
    constructor() {
        this.updateHeight_debounced = debounce(1000, this.updateHeight.bind(this));
        this.packetData = new PacketDataBuffer(this.packetCallback);
        this.output = mobx.observable.box(null, {name: "openai-output"});
    }

    initialize(params : T.RendererModelInitializeParams) : void {
        this.loading = mobx.observable.box(true, {name: "renderer-loading"});
        this.isDone = mobx.observable.box(params.isDone, {name: "renderer-isDone"});
        this.context = params.context;
        this.opts = params.opts;
        this.api = params.api;
        this.savedHeight = params.savedHeight;
        this.ptyDataSource = params.ptyDataSource;
        this.rawCmd = params.rawCmd;
        if (this.isDone.get()) {
            setTimeout(() => this.reload(0), 10);
        }
    }

    @boundMethod
    packetCallback(packetAny : any) {
        let packet : T.OpenAIPacketType = packetAny
        if (packet == null) {
            return;
        }
        if (packet.model != null && (packet.index ?? 0) == 0) {
            let output = {
                model: packet.model,
                created: packet.created,
                finish_reason: packet.finish_reason,
                message: (packet.text ?? ""),
            };
            mobx.action(() => {
                this.output.set(output);
            })();
            return;
        }
        if ((packet.index ?? 0) == 0) {
            mobx.action(() => {
                if (packet.finish_reason != null) {
                    this.output.get().finish_reason = packet.finish_reason;
                }
                if (packet.text != null) {
                    this.output.get().message += packet.text;
                }
            })();
        }
    }

    dispose() : void {
        return;
    }
    
    giveFocus() : void {
        return;
    }

    updateOpts(update : T.RendererOptsUpdate) : void {
        Object.assign(this.opts, update);
    }

    updateHeight(newHeight : number) : void {
        if (this.savedHeight != newHeight) {
            this.savedHeight = newHeight;
            this.api.saveHeight(newHeight);
        }
    }
    
    setIsDone() : void {
        if (this.isDone.get()) {
            return;
        }
        mobx.action(() => {
            this.isDone.set(true);
        })();
        this.reload(0);
    }

    reload(delayMs : number) : void {
        mobx.action(() => {
            this.loading.set(true);
        })();
        let rtnp = this.ptyDataSource(this.context);
        if (rtnp == null) {
            console.log("no promise returned from ptyDataSource (openai renderer)", this.context);
            return;
        }
        rtnp.then((ptydata) => {
            setTimeout(() => {
                this.packetData.reset();
                this.receiveData(ptydata.pos, ptydata.data, "reload");
                mobx.action(() => {
                    this.loading.set(false);
                    this.loadError.set(null);
                })();
            }, delayMs);
        }).catch((e) => {
            console.log("error loading data", e);
            mobx.action(() => {
                this.loadError.set("error loading data: " + e);
            })();
        });
    }
    
    receiveData(pos : number, data : Uint8Array, reason? : string) : void {
        this.packetData.receiveData(pos, data, reason);
    }
}

@mobxReact.observer
class OpenAIRenderer extends React.Component<{model : OpenAIRendererModel}> {
    renderPrompt(cmd : T.WebCmd) {
        let cmdStr = cmd.cmdstr.trim();
        if (cmdStr.startsWith("/openai")) {
            let spaceIdx = cmdStr.indexOf(" ");
            if (spaceIdx > 0) {
                cmdStr = cmdStr.substr(spaceIdx+1).trim();
            }
        }
        return (
            <div className="openai-message">
                <span className="openai-role openai-role-user">[user]</span>
                <div className="openai-content-user">
                    {cmdStr}
                </div>
            </div>
        );
    }

    renderOutput(cmd : T.WebCmd) {
        let output = this.props.model.output.get();
        let message = "";
        if (output != null) {
            message = output.message ?? "";
        }
        let model = this.props.model;
        let opts = model.opts;
        let maxWidth = opts.maxSize.width;
        let minWidth = opts.maxSize.width;
        if (minWidth > 1000) {
            minWidth = 1000;
        }
        return (
            <div className="openai-message">
                <div className="openai-role openai-role-assistant">[assistant]</div>
                <div className="openai-content-assistant">
                    <div className="scroller" style={{maxHeight: opts.maxSize.height, minWidth: minWidth, width: "min-content", maxWidth: maxWidth}}>
                        <Markdown text={message} style={{maxHeight: opts.maxSize.height}}/>
                    </div>
                </div>
            </div>
        );
    }
    
    render() {
        let model : OpenAIRendererModel = this.props.model;
        let cmd = model.rawCmd;
        let styleVal : Record<string, any> = null;
        if (model.loading.get() && model.savedHeight >= 0) {
            styleVal = {height: model.savedHeight};
        }
        return (
            <div className="renderer-container openai-renderer" style={styleVal}>
                {this.renderPrompt(cmd)}
                {this.renderOutput(cmd)}
            </div>
        );
    }
}

export {OpenAIRenderer, OpenAIRendererModel};
