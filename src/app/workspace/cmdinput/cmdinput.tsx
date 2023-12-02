// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { boundMethod } from "autobind-decorator";
import { If, Choose, When, Otherwise } from "tsx-control-statements/components";
import cn from "classnames";
import dayjs from "dayjs";
import type { RemoteType, RemoteInstanceType, RemotePtrType } from "../../../types/types";
import localizedFormat from "dayjs/plugin/localizedFormat";
import { GlobalModel, GlobalCommandRunner, Screen, ScreenLines } from "../../../model/model";
import { renderCmdText, Button } from "../../common/common";
import { TextAreaInput } from "./textareainput";
import { InfoMsg } from "./infomsg";
import { HistoryInfo } from "./historyinfo";
import { Prompt } from "../../common/prompt/prompt";
import { ReactComponent as ExecIcon } from "../../assets/icons/exec.svg";
import { ReactComponent as RotateIcon } from "../../assets/icons/line/rotate.svg";
import "./cmdinput.less";

dayjs.extend(localizedFormat);

const TDots = "⋮";

type OV<V> = mobx.IObservableValue<V>;

@mobxReact.observer
class CmdInput extends React.Component<{}, {}> {
    cmdInputRef: React.RefObject<any> = React.createRef();
    promptRef: React.RefObject<any> = React.createRef();

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
    cmdInputClick(e: any): void {
        if (this.promptRef.current != null) {
            if (this.promptRef.current.contains(e.target)) {
                return;
            }
        }
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

    @boundMethod
    toggleFilter(screen: Screen) {
        mobx.action(() => {
            screen.filterRunning.set(!screen.filterRunning.get());
        })();
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
        let win = GlobalModel.getScreenLinesById(screen.screenId) ?? GlobalModel.loadScreenLines(screen.screenId);
        let numRunningLines = win.getRunningCmdLines().length;
        return (
            <div
                ref={this.cmdInputRef}
                className={cn("cmd-input", { "has-info": infoShow }, { active: focusVal })}
            >
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
                                className="button is-wave-green is-outlined is-small"
                                onClick={() => this.clickConnectRemote(remote.remoteid)}
                            >
                                connect now
                            </div>
                        </If>
                    </div>
                </If>
                <div key="prompt" className="cmd-input-context">
                    <div className="has-text-white">
                        <span ref={this.promptRef}><Prompt rptr={rptr} festate={feState} /></span>
                    </div>
                    <If condition={numRunningLines > 0}>
                        <div onClick={() => this.toggleFilter(screen)}className="cmd-input-filter">
                            {numRunningLines}
                            <div className="avatar">
                                <RotateIcon className="warning spin" />
                            </div>
                        </div>
                    </If>
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
                        {/**<div onClick={inputModel.toggleExpandInput} className="hint-item color-white">
                            {inputModel.inputExpanded.get() ? "shrink" : "expand"} input ({renderCmdText("E")})
                            </div>**/}
                        {!focusVal && (
                            <div onClick={this.clickFocusInputHint} className="cmd-btn hoverEffect">
                                focus input ({renderCmdText("I")})
                            </div>
                        )}
                        {focusVal && (
                            <div onMouseDown={this.clickHistoryHint} className="cmd-btn hoverEffect">
                                {historyShow ? "close (esc)" : "history (ctrl-r)"}
                            </div>
                        )}
                        <ExecIcon
                            onClick={inputModel.uiSubmitCommand}
                            className={`icon ${inputModel.getCurLine().trim() === "" ? "disabled" : "hoverEffect"}`}
                        />
                    </div>
                </div>
            </div>
        );
    }
}

export { CmdInput };
