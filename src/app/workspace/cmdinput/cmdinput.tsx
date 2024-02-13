// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { boundMethod } from "autobind-decorator";
import { If } from "tsx-control-statements/components";
import cn from "classnames";
import dayjs from "dayjs";
import localizedFormat from "dayjs/plugin/localizedFormat";
import { GlobalModel, GlobalCommandRunner, Screen } from "@/models";
import { renderCmdText } from "@/elements";
import { TextAreaInput } from "./textareainput";
import { InfoMsg } from "./infomsg";
import { HistoryInfo } from "./historyinfo";
import { Prompt } from "@/common/prompt/prompt";
import { ReactComponent as ExecIcon } from "@/assets/icons/exec.svg";
import { RotateIcon } from "@/common/icons/icons";
import { AIChat } from "./aichat";

import "./cmdinput.less";

dayjs.extend(localizedFormat);

@mobxReact.observer
class CmdInput extends React.Component<{}, {}> {
    cmdInputRef: React.RefObject<any> = React.createRef();
    promptRef: React.RefObject<any> = React.createRef();

    componentDidMount() {
        this.updateCmdInputHeight();
    }

    updateCmdInputHeight() {
        const elem = this.cmdInputRef.current;
        if (elem == null) {
            return;
        }
        const height = elem.offsetHeight;
        if (height == GlobalModel.inputModel.cmdInputHeight) {
            return;
        }
        mobx.action(() => {
            GlobalModel.inputModel.cmdInputHeight.set(height);
        })();
    }

    componentDidUpdate(): void {
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
    clickAIHint(e: any): void {
        e.preventDefault();
        e.stopPropagation();
        let inputModel = GlobalModel.inputModel;
        inputModel.openAIAssistantChat();
    }

    @boundMethod
    clickHistoryHint(e: any): void {
        e.preventDefault();
        e.stopPropagation();

        const inputModel = GlobalModel.inputModel;
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

    @boundMethod
    clickResetState(): void {
        GlobalCommandRunner.resetShellState();
    }

    render() {
        const model = GlobalModel;
        const inputModel = model.inputModel;
        const screen = GlobalModel.getActiveScreen();
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
        feState = feState || {};
        const infoShow = inputModel.infoShow.get();
        const historyShow = !infoShow && inputModel.historyShow.get();
        const aiChatShow = inputModel.aIChatShow.get();
        const focusVal = inputModel.physicalInputFocused.get();
        const inputMode: string = inputModel.inputMode.get();
        const textAreaInputKey = screen == null ? "null" : screen.screenId;
        const win = GlobalModel.getScreenLinesById(screen.screenId);
        let numRunningLines = 0;
        if (win != null) {
            numRunningLines = mobx.computed(() => win.getRunningCmdLines().length).get();
        }
        return (
            <div
                ref={this.cmdInputRef}
                className={cn(
                    "cmd-input",
                    { "has-info": infoShow },
                    { "has-aichat": aiChatShow },
                    { active: focusVal }
                )}
            >
                <If condition={historyShow}>
                    <div className="cmd-input-grow-spacer"></div>
                    <HistoryInfo />
                </If>
                <If condition={aiChatShow}>
                    <div className="cmd-input-grow-spacer"></div>
                    <AIChat />
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
                <If condition={feState["invalidshellstate"]}>
                    <div className="remote-status-warning">
                        WARNING:&nbsp; The shell state for this tab is invalid (
                        <a target="_blank" href="https://docs.waveterm.dev/reference/faq">
                            see FAQ
                        </a>
                        ). Must reset to continue.
                        <div className="button is-wave-green is-outlined is-small" onClick={this.clickResetState}>
                            reset shell state
                        </div>
                    </div>
                </If>
                <div key="prompt" className="cmd-input-context">
                    <div className="has-text-white">
                        <span ref={this.promptRef}>
                            <Prompt rptr={rptr} festate={feState} />
                        </span>
                    </div>
                    <If condition={numRunningLines > 0}>
                        <div onClick={() => this.toggleFilter(screen)} className="cmd-input-filter">
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
                    <TextAreaInput
                        key={textAreaInputKey}
                        screen={screen}
                        onHeightChange={this.handleInnerHeightUpdate}
                    />
                    <div className="control cmd-exec">
                        {/**<div onClick={inputModel.toggleExpandInput} className="hint-item color-white">
                            {inputModel.inputExpanded.get() ? "shrink" : "expand"} input ({renderCmdText("E")})
                            </div>**/}
                        {!focusVal && (
                            <div onClick={this.clickFocusInputHint} className="cmd-btn hoverEffect">
                                <div className="hint-elem">focus input ({renderCmdText("I")})</div>
                            </div>
                        )}
                        {focusVal && (
                            <div className="cmd-btn hoverEffect">
                                <If condition={historyShow}>
                                    <div className="hint-elem" onMouseDown={this.clickHistoryHint}>
                                        close (esc)
                                    </div>
                                </If>
                                <If condition={!historyShow}>
                                    <div className="hint-elem" onMouseDown={this.clickHistoryHint}>
                                        history (ctrl-r)
                                    </div>
                                    <div className="hint-elem" onMouseDown={this.clickAIHint}>
                                        AI (ctrl-space)
                                    </div>
                                </If>
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
