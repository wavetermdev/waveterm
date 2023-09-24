import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { boundMethod } from "autobind-decorator";
import { If } from "tsx-control-statements/components";
import cn from "classnames";
import dayjs from "dayjs";
import type { RemoteType, RemoteInstanceType, RemotePtrType } from "../../types";
import localizedFormat from "dayjs/plugin/localizedFormat";
import { GlobalModel, GlobalCommandRunner } from "../../model";
import { Prompt } from "../line/linecomps";
import { renderCmdText } from "../../common/common";
import { TextAreaInput } from "./TextareaInput";
import { InfoMsg } from "./InfoMsg";
import { HistoryInfo } from "./HistoryInfo";
import "./sessionview.less";

dayjs.extend(localizedFormat);

const TDots = "⋮";

type OV<V> = mobx.IObservableValue<V>;

@mobxReact.observer
class CmdInput extends React.Component<{}, {}> {
    cmdInputRef: React.RefObject<any> = React.createRef();

    @boundMethod
    onInfoToggle(): void {
        GlobalModel.inputModel.toggleInfoMsg();
        return;
    }

    componentDidMount() {
        this.updateCmdInputHeight();
    }

    updateCmdInputHeight() {
        let elem = this.cmdInputRef.current;
        if (elem == null) {
            return;
        }
        let height = elem.offsetHeight;
        if (height == GlobalModel.inputModel.cmdInputHeight) {
            return;
        }
        mobx.action(() => {
            GlobalModel.inputModel.cmdInputHeight.set(height);
        })();
    }

    componentDidUpdate(prevProps, prevState, snapshot: {}): void {
        this.updateCmdInputHeight();
    }

    @boundMethod
    handleInnerHeightUpdate(): void {
        this.updateCmdInputHeight();
    }

    @boundMethod
    clickFocusInputHint(): void {
        GlobalModel.inputModel.giveFocus();
    }

    @boundMethod
    clickHistoryHint(e: any): void {
        e.preventDefault();
        e.stopPropagation();

        let inputModel = GlobalModel.inputModel;
        if (inputModel.historyShow.get()) {
            inputModel.resetHistory();
        } else {
            inputModel.openHistory();
        }
    }

    @boundMethod
    clickConnectRemote(remoteId: string): void {
        GlobalCommandRunner.connectRemote(remoteId);
    }

    render() {
        let model = GlobalModel;
        let inputModel = model.inputModel;
        let screen = GlobalModel.getActiveScreen();
        let ri: RemoteInstanceType = null;
        let rptr: RemotePtrType = null;
        if (screen != null) {
            ri = screen.getCurRemoteInstance();
            rptr = screen.curRemote.get();
        }
        let remote: RemoteType = null;
        let feState: Record<string, string> = null;
        if (ri != null) {
            remote = GlobalModel.getRemote(ri.remoteid);
            feState = ri.festate;
        }
        let infoShow = inputModel.infoShow.get();
        let historyShow = !infoShow && inputModel.historyShow.get();
        let infoMsg = inputModel.infoMsg.get();
        let hasInfo = infoMsg != null;
        let focusVal = inputModel.physicalInputFocused.get();
        let inputMode: string = inputModel.inputMode.get();
        let textAreaInputKey = screen == null ? "null" : screen.screenId;
        return (
            <div
                ref={this.cmdInputRef}
                className={cn(
                    "cmd-input has-background-black",
                    { "has-info": infoShow },
                    { "has-history": historyShow }
                )}
            >
                <div key="focus" className={cn("focus-indicator", { active: focusVal })} />
                <div key="minmax" onClick={this.onInfoToggle} className="input-minmax-control">
                    <If condition={infoShow || historyShow}>
                        <i className="fa-sharp fa-solid fa-chevron-down" />
                    </If>
                    <If condition={!(infoShow || historyShow) && hasInfo}>
                        <i className="fa-sharp fa-solid fa-chevron-up" />
                    </If>
                </div>
                <If condition={historyShow}>
                    <div className="cmd-input-grow-spacer"></div>
                    <HistoryInfo />
                </If>
                <InfoMsg key="infomsg" />
                <If condition={remote && remote.status != "connected"}>
                    <div className="remote-status-warning">
                        WARNING:&nbsp;
                        <span className="remote-name">[{GlobalModel.resolveRemoteIdToFullRef(remote.remoteid)}]</span>
                        &nbsp;is {remote.status}
                        <If condition={remote.status != "connecting"}>
                            <div
                                className="button is-prompt-green is-outlined is-small"
                                onClick={() => this.clickConnectRemote(remote.remoteid)}
                            >
                                connect now
                            </div>
                        </If>
                    </div>
                </If>
                <div key="prompt" className="cmd-input-context">
                    <div className="has-text-white">
                        <Prompt rptr={rptr} festate={feState} />
                    </div>
                </div>
                <div
                    key="input"
                    className={cn(
                        "cmd-input-field field has-addons",
                        inputMode != null ? "inputmode-" + inputMode : null
                    )}
                >
                    <If condition={inputMode != null}>
                        <div className="control cmd-quick-context">
                            <div className="button is-static">{inputMode}</div>
                        </div>
                    </If>
                    <TextAreaInput key={textAreaInputKey} onHeightChange={this.handleInnerHeightUpdate} />
                    <div className="control cmd-exec">
                        <div onClick={inputModel.uiSubmitCommand} className="button" title="Run Command">
                            <span className="icon">
                                <i className="fa-sharp fa-solid fa-rocket" />
                            </span>
                        </div>
                    </div>
                    <div className="cmd-hints">
                        <div onClick={inputModel.toggleExpandInput} className="hint-item color-white">
                            {inputModel.inputExpanded.get() ? "shrink" : "expand"} input ({renderCmdText("E")})
                        </div>
                        <If condition={!focusVal}>
                            <div onClick={this.clickFocusInputHint} className="hint-item color-white">
                                focus input ({renderCmdText("I")})
                            </div>
                        </If>
                        <If condition={focusVal}>
                            <div onMouseDown={this.clickHistoryHint} className="hint-item color-green">
                                <i className={cn("fa-sharp fa-solid", historyShow ? "fa-angle-down" : "fa-angle-up")} />{" "}
                                {historyShow ? "close history (esc)" : "show history (ctrl-r)"}
                            </div>
                        </If>
                    </div>
                </div>
            </div>
        );
    }
}

export { CmdInput };
