// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobx from "mobx";
import * as mobxReact from "mobx-react";
import * as T from "../../types/types";
import { debounce } from "throttle-debounce";
import { boundMethod } from "autobind-decorator";
import { PacketDataBuffer } from "../core/ptydata";
import { Markdown } from "../../app/common/elements";

import "./openai.less";

type OV<V> = mobx.IObservableValue<V>;

type OpenAIOutputType = {
    model: string;
    created: number;
    finish_reason: string;
    message: string;
};

class OpenAIRendererModel {
    context: T.RendererContext;
    opts: T.RendererOpts;
    isDone: OV<boolean>;
    api: T.RendererModelContainerApi;
    savedHeight: number;
    loading: OV<boolean>;
    loadError: OV<string> = mobx.observable.box(null, { name: "renderer-loadError" });
    chatError: OV<string> = mobx.observable.box(null, { name: "renderer-chatError" });
    updateHeight_debounced: (newHeight: number) => void;
    ptyDataSource: (termContext: T.TermContextUnion) => Promise<T.PtyDataType>;
    packetData: PacketDataBuffer;
    rawCmd: T.WebCmd;
    output: OV<OpenAIOutputType>;
    version: OV<number>;

    constructor() {
        this.updateHeight_debounced = debounce(1000, this.updateHeight.bind(this));
        this.packetData = new PacketDataBuffer(this.packetCallback);
        this.output = mobx.observable.box(null, { name: "openai-output" });
        this.version = mobx.observable.box(0);
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
        setTimeout(() => this.reload(0), 10);
    }

    @boundMethod
    packetCallback(packetAny: any) {
        let packet: T.OpenAIPacketType = packetAny;
        if (packet == null) {
            return;
        }
        // console.log("got packet", packet);
        if (packet.error != null) {
            mobx.action(() => {
                this.chatError.set(packet.error);
                this.version.set(this.version.get() + 1);
            })();
            return;
        }
        if (packet.model != null && (packet.index ?? 0) == 0) {
            let output = {
                model: packet.model,
                created: packet.created,
                finish_reason: packet.finish_reason,
                message: packet.text ?? "",
            };
            mobx.action(() => {
                this.output.set(output);
            })();
            return;
        }
        if ((packet.index ?? 0) == 0) {
            mobx.action(() => {
                let output = this.output.get();
                if (output == null) {
                    return;
                }
                if (packet.finish_reason != null) {
                    this.output.get().finish_reason = packet.finish_reason;
                }
                if (packet.text != null) {
                    this.output.get().message += packet.text;
                }
                this.version.set(this.version.get() + 1);
            })();
        }
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

    updateHeight(newHeight: number): void {
        if (this.savedHeight != newHeight) {
            this.savedHeight = newHeight;
            this.api.saveHeight(newHeight);
        }
    }

    setIsDone(): void {
        if (this.isDone.get()) {
            return;
        }
        mobx.action(() => {
            this.isDone.set(true);
        })();
        // this.reload(0);
    }

    reload(delayMs: number): void {
        mobx.action(() => {
            this.loading.set(true);
            this.loadError.set(null);
            this.chatError.set(null);
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
                })();
            }, delayMs);
        }).catch((e) => {
            console.log("error loading data", e);
            mobx.action(() => {
                this.loadError.set("error loading data: " + e);
            })();
        });
    }

    receiveData(pos: number, data: Uint8Array, reason?: string): void {
        this.packetData.receiveData(pos, data, reason);
    }
}

@mobxReact.observer
class OpenAIRenderer extends React.Component<{ model: OpenAIRendererModel }> {
    renderPrompt(cmd: T.WebCmd) {
        let cmdStr = cmd.cmdstr.trim();
        if (cmdStr.startsWith("/openai")) {
            let spaceIdx = cmdStr.indexOf(" ");
            if (spaceIdx > 0) {
                cmdStr = cmdStr.substr(spaceIdx + 1).trim();
            }
        }
        return (
            <div className="openai-message">
                <span className="openai-role openai-role-user">[user]</span>
                <div className="openai-content-user">{cmdStr}</div>
            </div>
        );
    }

    renderError() {
        let model: OpenAIRendererModel = this.props.model;
        return (
            <div className="openai-message">
                <span className="openai-role openai-role-error">[error]</span>
                <div className="openai-content-error">{model.loadError.get()}</div>
            </div>
        );
    }

    renderOutput() {
        let model = this.props.model;
        let output = model.output.get();
        if (output == null || output.message == null || output.message == "") {
            return null;
        }
        let message = output.message;
        let opts = model.opts;
        let minWidth = opts.maxSize.width;
        if (minWidth > 1000) {
            minWidth = 1000;
        }
        return (
            <div className="openai-message">
                <div className="openai-role openai-role-assistant">[assistant]</div>
                <div className="openai-content-assistant">
                    <div
                        style={{
                            maxHeight: opts.maxSize.height,
                            paddingRight: 5,
                        }}
                    >
                        <Markdown text={message} style={{ maxHeight: opts.maxSize.height }} />
                    </div>
                </div>
            </div>
        );
    }

    renderChatError() {
        let model = this.props.model;
        let chatError = model.chatError.get();
        if (chatError == null) {
            return null;
        }
        return (
            <div className="openai-message">
                <div className="openai-role openai-role-error">[error]</div>
                <div className="openai-content-error">{chatError}</div>
            </div>
        );
    }

    render() {
        let model: OpenAIRendererModel = this.props.model;
        let cmd = model.rawCmd;
        let styleVal: Record<string, any> = null;
        if (model.loading.get() && model.savedHeight >= 0 && model.isDone) {
            styleVal = {
                height: model.savedHeight,
                maxHeight: model.opts.maxSize.height,
            };
        } else {
            let maxWidth = model.opts.maxSize.width;
            if (maxWidth > 1000) {
                maxWidth = 1000;
            }
            styleVal = {
                maxWidth: maxWidth,
                maxHeight: model.opts.maxSize.height,
            };
        }
        let version = model.version.get();
        let loadError = model.loadError.get();
        if (loadError != null) {
            return (
                <div className="openai-renderer openai-error" style={styleVal}>
                    {this.renderPrompt(cmd)}
                    {this.renderError()}
                </div>
            );
        }
        return (
            <div className="openai-renderer" style={styleVal}>
                {this.renderPrompt(cmd)}
                {this.renderOutput()}
                {this.renderChatError()}
            </div>
        );
    }
}

export { OpenAIRenderer, OpenAIRendererModel };
