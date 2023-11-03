// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { boundMethod } from "autobind-decorator";
import { If, For } from "tsx-control-statements/components";
import cn from "classnames";
import dayjs from "dayjs";
import localizedFormat from "dayjs/plugin/localizedFormat";
import { GlobalModel, GlobalCommandRunner } from "../../../model/model";
import { Markdown } from "../common";
import * as util from "../../../util/util";
import { Toggle, Checkbox } from "../common";
import { ClientDataType } from "../../../types/types";

import close from "../../assets/icons/close.svg";
import { ReactComponent as WarningIcon } from "../../assets/icons/line/triangle-exclamation.svg";
import { ReactComponent as XmarkIcon } from "../../assets/icons/line/xmark.svg";
import shield from "../../assets/icons/shield_check.svg";
import help from "../../assets/icons/help_filled.svg";
import github from "../../assets/icons/github.svg";
import logo from "../../assets/waveterm-logo-with-bg.svg";

dayjs.extend(localizedFormat);

// @ts-ignore
const VERSION = __WAVETERM_VERSION__;

type OV<V> = mobx.IObservableValue<V>;

@mobxReact.observer
class DisconnectedModal extends React.Component<{}, {}> {
    logRef: any = React.createRef();
    showLog: mobx.IObservableValue<boolean> = mobx.observable.box(false);

    @boundMethod
    restartServer() {
        GlobalModel.restartWaveSrv();
    }

    @boundMethod
    tryReconnect() {
        GlobalModel.ws.connectNow("manual");
    }

    componentDidMount() {
        if (this.logRef.current != null) {
            this.logRef.current.scrollTop = this.logRef.current.scrollHeight;
        }
    }

    componentDidUpdate() {
        if (this.logRef.current != null) {
            this.logRef.current.scrollTop = this.logRef.current.scrollHeight;
        }
    }

    @boundMethod
    handleShowLog(): void {
        mobx.action(() => {
            this.showLog.set(!this.showLog.get());
        })();
    }

    render() {
        let model = GlobalModel;
        let logLine: string = null;
        let idx: number = 0;
        return (
            <div className="prompt-modal disconnected-modal modal is-active">
                <div className="modal-background"></div>
                <div className="modal-content">
                    <div className="message-header">
                        <div className="modal-title">Wave Client Disconnected</div>
                    </div>
                    <If condition={this.showLog.get()}>
                        <div className="inner-content">
                            <div className="ws-log" ref={this.logRef}>
                                <For each="logLine" index="idx" of={GlobalModel.ws.wsLog}>
                                    <div key={idx} className="ws-logline">
                                        {logLine}
                                    </div>
                                </For>
                            </div>
                        </div>
                    </If>
                    <footer>
                        <div className="footer-text-link" style={{ marginLeft: 10 }} onClick={this.handleShowLog}>
                            <If condition={!this.showLog.get()}>
                                <i className="fa-sharp fa-solid fa-plus" /> Show Log
                            </If>
                            <If condition={this.showLog.get()}>
                                <i className="fa-sharp fa-solid fa-minus" /> Hide Log
                            </If>
                        </div>
                        <div className="flex-spacer" />
                        <button onClick={this.tryReconnect} className="button">
                            <span className="icon">
                                <i className="fa-sharp fa-solid fa-rotate" />
                            </span>
                            <span>Try Reconnect</span>
                        </button>
                        <button onClick={this.restartServer} className="button is-danger" style={{ marginLeft: 10 }}>
                            <WarningIcon className="icon" />
                            <span>Restart Server</span>
                        </button>
                    </footer>
                </div>
            </div>
        );
    }
}

@mobxReact.observer
class ClientStopModal extends React.Component<{}, {}> {
    @boundMethod
    refreshClient() {
        GlobalModel.refreshClient();
    }

    render() {
        let model = GlobalModel;
        let cdata = model.clientData.get();
        let title = "Client Not Ready";
        return (
            <div className="prompt-modal client-stop-modal modal is-active">
                <div className="modal-background"></div>
                <div className="modal-content">
                    <div className="message-header">
                        <div className="modal-title">{title}</div>
                    </div>
                    <div className="inner-content">
                        <If condition={cdata == null}>
                            <div>Cannot get client data.</div>
                        </If>
                    </div>
                    <footer>
                        <button onClick={this.refreshClient} className="button">
                            <span className="icon">
                                <i className="fa-sharp fa-solid fa-rotate" />
                            </span>
                            <span>Hard Refresh Client</span>
                        </button>
                    </footer>
                </div>
            </div>
        );
    }
}

@mobxReact.observer
class LoadingSpinner extends React.Component<{}, {}> {
    render() {
        return (
            <div className="loading-spinner">
                <div></div>
                <div></div>
                <div></div>
                <div></div>
            </div>
        );
    }
}

@mobxReact.observer
class AlertModal extends React.Component<{}, {}> {
    @boundMethod
    closeModal(): void {
        GlobalModel.cancelAlert();
    }

    @boundMethod
    handleOK(): void {
        GlobalModel.confirmAlert();
    }

    render() {
        let message = GlobalModel.alertMessage.get();
        if (message == null) {
            return null;
        }
        let title = message.title ?? (message.confirm ? "Confirm" : "Alert");
        let isConfirm = message.confirm;
        return (
            <div className="modal prompt-modal is-active alert-modal">
                <div className="modal-background" />
                <div className="modal-content">
                    <header>
                        <p className="modal-title">
                            <WarningIcon className="icon" />
                            {title}
                        </p>
                        <div className="close-icon hoverEffect" title="Close (Escape)" onClick={this.closeModal}>
                            <XmarkIcon />
                        </div>
                    </header>
                    <If condition={message.markdown}>
                        <Markdown text={message.message} extraClassName="inner-content" />
                    </If>
                    <If condition={!message.markdown}>
                        <div className="inner-content content">
                            <p>{message.message}</p>
                        </div>
                    </If>
                    <footer>
                        <If condition={isConfirm}>
                            <div onClick={this.closeModal} className="button is-prompt-cancel is-outlined is-small">
                                Cancel
                            </div>
                            <div onClick={this.handleOK} className="button is-prompt-green is-outlined is-small">
                                OK
                            </div>
                        </If>
                        <If condition={!isConfirm}>
                            <div onClick={this.handleOK} className="button is-prompt-green is-small">
                                OK
                            </div>
                        </If>
                    </footer>
                </div>
            </div>
        );
    }
}

@mobxReact.observer
class TosModal extends React.Component<{}, {}> {
    state = {
        isChecked: false,
    };

    @boundMethod
    handleCheckboxChange(checked: boolean): void {
        this.setState({ isChecked: checked });
    }

    @boundMethod
    acceptTos(): void {
        GlobalCommandRunner.clientAcceptTos();
    }

    @boundMethod
    handleChangeTelemetry(val: boolean): void {
        if (val) {
            GlobalCommandRunner.telemetryOn(false);
        } else {
            GlobalCommandRunner.telemetryOff(false);
        }
    }

    render() {
        let cdata: ClientDataType = GlobalModel.clientData.get();

        return (
            <div className={cn("modal tos-modal wave-modal is-active")}>
                <div className="modal-background" />
                <div className="modal-content tos-modal-content">
                    <div className="modal-content-wrapper">
                        <header className="tos-header unselectable">
                            <div className="modal-title">Welcome to Wave Terminal!</div>
                            <div className="modal-subtitle">Lets set everything for you</div>
                        </header>
                        <div className="content tos-content unselectable">
                            <div className="item">
                                <img src={shield} alt="Privacy" />
                                <div className="item-inner">
                                    <div className="item-title">Telemetry</div>
                                    <div className="item-text">
                                        We only collect minimal <i>anonymous</i> telemetry data to help us understand
                                        how many people are using Wave.
                                    </div>
                                    <div className="item-field" style={{ marginTop: 2 }}>
                                        <Toggle
                                            checked={!cdata.clientopts.notelemetry}
                                            onChange={this.handleChangeTelemetry}
                                        />
                                        <div className="item-label">
                                            Telemetry {cdata.clientopts.notelemetry ? "Disabled" : "Enabled"}
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="item">
                                <a target="_blank" href={util.makeExternLink("https://discord.gg/XfvZ334gwU")}>
                                    <img src={help} alt="Help" />
                                </a>
                                <div className="item-inner">
                                    <div className="item-title">Join our Community</div>
                                    <div className="item-text">
                                        Get help, submit feature requests, report bugs, or just chat with fellow
                                        terminal enthusiasts.
                                        <br />
                                        <a target="_blank" href={util.makeExternLink("https://discord.gg/XfvZ334gwU")}>
                                            Join the Wave&nbsp;Discord&nbsp;Channel
                                        </a>
                                    </div>
                                </div>
                            </div>
                            <div className="item">
                                <a
                                    target="_blank"
                                    href={util.makeExternLink("https://github.com/wavetermdev/waveterm")}
                                >
                                    <img src={github} alt="Github" />
                                </a>
                                <div className="item-inner">
                                    <div className="item-title">Support us on GitHub</div>
                                    <div className="item-text">
                                        We're <i>open source</i> and committed to providing a free terminal for
                                        individual users. Please show your support us by giving us a star on{" "}
                                        <a
                                            target="_blank"
                                            href={util.makeExternLink("https://github.com/wavetermdev/waveterm")}
                                        >
                                            Github&nbsp;(wavetermdev/waveterm)
                                        </a>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <footer className="unselectable">
                            <div>
                                <Checkbox
                                    checked={this.state.isChecked}
                                    label="I accept the Terms of Service"
                                    id="accept-tos"
                                    onChange={this.handleCheckboxChange}
                                />
                            </div>
                            <div className="button-wrapper">
                                <button
                                    onClick={this.acceptTos}
                                    className={cn("button is-wave-green is-outlined is-small", {
                                        "disabled-button": !this.state.isChecked,
                                    })}
                                    disabled={!this.state.isChecked}
                                >
                                    Continue
                                </button>
                            </div>
                        </footer>
                    </div>
                </div>
            </div>
        );
    }
}

@mobxReact.observer
class AboutModal extends React.Component<{}, {}> {
    @boundMethod
    closeModal(): void {
        mobx.action(() => {
            GlobalModel.aboutModalOpen.set(false);
        })();
    }

    @boundMethod
    isUpToDate(): boolean {
        return true;
    }

    @boundMethod
    updateApp(): void {
        // GlobalCommandRunner.updateApp();
    }

    @boundMethod
    getStatus(isUpToDate: boolean): JSX.Element {
        if (isUpToDate) {
            return (
                <div className="status updated">
                    <div>
                        <i className="fa-sharp fa-solid fa-circle-check" />
                        <span>Up to Date</span>
                    </div>
                    <div>Client Version v0.4.0 20231016-110014</div>
                </div>
            );
        }
        return (
            <div className="status outdated">
                <div>
                    <i className="fa-sharp fa-solid fa-triangle-exclamation" />
                    <span>Outdated Version</span>
                </div>
                <div>Client Version v0.4.0 20231016-110014</div>
                <div>
                    <button onClick={this.updateApp} className="button color-green text-secondary">
                        Update
                    </button>
                </div>
            </div>
        );
    }

    render() {
        return (
            <div className={cn("modal about-modal wave-modal is-active")}>
                <div className="modal-background" />
                <div className="modal-content about-modal-content">
                    <div className="modal-content-wrapper">
                        <header className="common-header">
                            <div className="modal-title">About</div>
                            <div className="close-icon-wrapper" onClick={this.closeModal}>
                                <img src={close} alt="Close (Escape)" />
                            </div>
                        </header>
                        <div className="content about-content">
                            <section className="wave-section about-section">
                                <div className="logo-wrapper">
                                    <img src={logo} alt="logo" />
                                </div>
                                <div className="text-wrapper">
                                    <div>Wave Terminal</div>
                                    <div className="text-standard">Modern Terminal for Seamless Workflow</div>
                                </div>
                            </section>
                            <section className="wave-section about-section text-standard">
                                {this.getStatus(this.isUpToDate())}
                            </section>
                            <section className="wave-section about-section">
                                <a
                                    className="wave-button wave-button-link color-standard"
                                    href={util.makeExternLink("https://github.com/wavetermdev/waveterm")}
                                    target="_blank"
                                >
                                    <i className="fa-brands fa-github"></i>
                                    Github
                                </a>
                                <a
                                    className="wave-button wave-button-link color-standard"
                                    href={util.makeExternLink("https://www.commandline.dev/")}
                                    target="_blank"
                                >
                                    <i className="fa-sharp fa-light fa-globe"></i>
                                    Website
                                </a>
                                <a
                                    className="wave-button wave-button-link color-standard"
                                    href={util.makeExternLink(
                                        "https://github.com/wavetermdev/waveterm/blob/main/LICENSE"
                                    )}
                                    target="_blank"
                                >
                                    <i className="fa-sharp fa-light fa-book-blank"></i>
                                    License
                                </a>
                            </section>
                            <section className="wave-section about-section text-standard">
                                Copyright © 2023 Command Line Inc.
                            </section>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

export { LoadingSpinner, ClientStopModal, AlertModal, DisconnectedModal, TosModal, AboutModal };
