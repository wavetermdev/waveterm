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
import { Button } from "@/elements";
import { TextAreaInput } from "./textareainput";
import { InfoMsg } from "./infomsg";
import { HistoryInfo } from "./historyinfo";
import { Prompt } from "@/common/prompt/prompt";
import { CenteredIcon, RotateIcon } from "@/common/icons/icons";
import { AIChat } from "./aichat";
import * as util from "@/util/util";

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
    baseCmdInputClick(e: React.MouseEvent): void {
        if (this.promptRef.current != null) {
            if (this.promptRef.current.contains(e.target)) {
                return;
            }
        }
        if ((e.target as HTMLDivElement).classList.contains("cmd-input-context")) {
            e.stopPropagation();
            return;
        }
        GlobalModel.inputModel.setHistoryFocus(false);
        GlobalModel.inputModel.giveFocus();
    }

    @boundMethod
    clickAIAction(e: any): void {
        e.preventDefault();
        e.stopPropagation();
        const inputModel = GlobalModel.inputModel;
        if (inputModel.aIChatShow.get()) {
            inputModel.closeAIAssistantChat(true);
        } else {
            inputModel.openAIAssistantChat();
        }
    }

    @boundMethod
    clickHistoryAction(e: any): void {
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

    getRemoteDisplayName(rptr: RemotePtrType): string {
        if (rptr == null) {
            return "(unknown)";
        }
        const remote = GlobalModel.getRemote(rptr.remoteid);
        if (remote == null) {
            return "(invalid)";
        }
        let remoteNamePart = "";
        if (!util.isBlank(rptr.name)) {
            remoteNamePart = "#" + rptr.name;
        }
        if (remote.remotealias) {
            return remote.remotealias + remoteNamePart;
        }
        return remote.remotecanonicalname + remoteNamePart;
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
        if (remote == null && rptr != null) {
            remote = GlobalModel.getRemote(rptr.remoteid);
        }
        feState = feState || {};
        const infoShow = inputModel.infoShow.get();
        const historyShow = !infoShow && inputModel.historyShow.get();
        const aiChatShow = inputModel.aIChatShow.get();
        const focusVal = inputModel.physicalInputFocused.get();
        const inputMode: string = inputModel.inputMode.get();
        const textAreaInputKey = screen == null ? "null" : screen.screenId;
        const win = GlobalModel.getScreenLinesById(screen.screenId);
        const filterRunning = screen.filterRunning.get();
        let numRunningLines = 0;
        if (win != null) {
            numRunningLines = mobx.computed(() => win.getRunningCmdLines().length).get();
        }
        let shellInitMsg: string = null;
        let hidePrompt = false;

        const openView = inputModel.getOpenView();
        const hasOpenView = openView ? `has-${openView}` : null;
        if (ri == null) {
            let shellStr = "shell";
            if (!util.isBlank(remote?.defaultshelltype)) {
                shellStr = remote.defaultshelltype;
            }
            if (numRunningLines > 0) {
                shellInitMsg = `initializing ${shellStr}...`;
            } else {
                hidePrompt = true;
            }
        }
        return (
            <div ref={this.cmdInputRef} className={cn("cmd-input", hasOpenView, { active: focusVal })}>
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
                            <Button
                                className="primary outlined"
                                onClick={() => this.clickConnectRemote(remote.remoteid)}
                            >
                                Connect Now
                            </Button>
                        </If>
                    </div>
                </If>
                <If condition={feState["invalidshellstate"]}>
                    <div className="remote-status-warning">
                        The shell state for this tab is invalid (
                        <a target="_blank" href="https://docs.waveterm.dev/reference/faq">
                            see FAQ
                        </a>
                        ). Must reset to continue.
                        <Button className="primary outlined" onClick={this.clickResetState}>
                            Reset Now
                        </Button>
                    </div>
                </If>
                <If condition={ri == null && numRunningLines == 0}>
                    <div className="remote-status-warning">
                        Shell is not initialized, must reset to continue.
                        <Button className="primary outlined" onClick={this.clickResetState}>
                            Reset Now
                        </Button>
                    </div>
                </If>
                <div key="base-cmdinput" className="base-cmdinput" onClick={this.baseCmdInputClick}>
                    <div className="cmdinput-actions">
                        <If condition={numRunningLines > 0}>
                            <div
                                key="running"
                                className={cn("cmdinput-icon", "running-cmds", { active: filterRunning })}
                                title="Filter for Running Commands"
                                onClick={() => this.toggleFilter(screen)}
                            >
                                <CenteredIcon>{numRunningLines}</CenteredIcon>{" "}
                                <CenteredIcon>
                                    <RotateIcon className="rotate warning spin" />
                                </CenteredIcon>
                            </div>
                        </If>
                        <div
                            key="ai"
                            title="Wave AI (Ctrl-Space)"
                            className="cmdinput-icon"
                            onClick={this.clickAIAction}
                        >
                            <i className="fa-sharp fa-regular fa-sparkles fa-fw" />
                        </div>
                        <div
                            key="history"
                            title="Tab History (Ctrl-R)"
                            className="cmdinput-icon"
                            onClick={this.clickHistoryAction}
                        >
                            <i className="fa-sharp fa-regular fa-clock-rotate-left fa-fw" />
                        </div>
                    </div>
                    <If condition={!hidePrompt}>
                        <div key="prompt" className="cmd-input-context">
                            <div className="has-text-white">
                                <span ref={this.promptRef}>
                                    <Prompt rptr={rptr} festate={feState} color={true} shellInitMsg={shellInitMsg} />
                                </span>
                            </div>
                        </div>
                    </If>
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
                    </div>
                </div>
            </div>
        );
    }
}

export { CmdInput };
