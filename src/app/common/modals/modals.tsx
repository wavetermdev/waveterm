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
import { GlobalModel, GlobalCommandRunner, RemotesModalModel } from "../../../model/model";
import * as T from "../../../types/types";
import { Markdown, InfoMessage } from "../common";
import * as util from "../../../util/util";
import { Toggle, Checkbox } from "../common";
import { ClientDataType } from "../../../types/types";
import { TextField, NumberField, InputDecoration, Dropdown, PasswordField, Tooltip, Button } from "../common";

import close from "../../assets/icons/close.svg";
import { ReactComponent as WarningIcon } from "../../assets/icons/line/triangle-exclamation.svg";
import { ReactComponent as XmarkIcon } from "../../assets/icons/line/xmark.svg";
import shield from "../../assets/icons/shield_check.svg";
import help from "../../assets/icons/help_filled.svg";
import github from "../../assets/icons/github.svg";
import logo from "../../assets/waveterm-logo-with-bg.svg";
import { ReactComponent as AngleDownIcon } from "../../assets/icons/history/angle-down.svg";

dayjs.extend(localizedFormat);

// @ts-ignore
const VERSION = __WAVETERM_VERSION__;
// @ts-ignore
let BUILD = __WAVETERM_BUILD__;

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
                <div className="modal-background wave-modal-background" />
                <div className="modal-content wave-modal-content tos-wave-modal-content">
                    <div className="modal-content-inner wave-modal-content-inner tos-wave-modal-content-inner">
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
                                <Button onClick={this.acceptTos} disabled={!this.state.isChecked}>
                                    Continue
                                </Button>
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
        // TODO no up-to-date status reporting
        return (
            <div className="status updated">
                <div className="text-selectable">
                    Client Version {VERSION} ({BUILD})
                </div>
            </div>
        );

        if (isUpToDate) {
            return (
                <div className="status updated">
                    <div>
                        <i className="fa-sharp fa-solid fa-circle-check" />
                        <span>Up to Date</span>
                    </div>
                    <div className="selectable">
                        Client Version {VERSION} ({BUILD})
                    </div>
                </div>
            );
        }
        return (
            <div className="status outdated">
                <div>
                    <i className="fa-sharp fa-solid fa-triangle-exclamation" />
                    <span>Outdated Version</span>
                </div>
                <div className="selectable">
                    Client Version {VERSION} ({BUILD})
                </div>
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
                <div className="modal-background wave-modal-background" />
                <div className="modal-content wave-modal-content about-wave-modal-content">
                    <div className="modal-content-inner wave-modal-content-inner about-wave-modal-content-inner">
                        <header className="wave-modal-header about-wave-modal-header">
                            <div className="wave-modal-title about-wave-modal-title">About</div>
                            <div className="wave-modal-close about-wave-modal-close" onClick={this.closeModal}>
                                <img src={close} alt="Close (Escape)" />
                            </div>
                        </header>
                        <div className="wave-modal-body about-wave-modal-body">
                            <section className="wave-modal-section about-section">
                                <div className="logo-wrapper">
                                    <img src={logo} alt="logo" />
                                </div>
                                <div className="text-wrapper">
                                    <div>Wave Terminal</div>
                                    <div className="text-standard">
                                        Modern Terminal for
                                        <br />
                                        Seamless Workflow
                                    </div>
                                </div>
                            </section>
                            <section className="wave-modal-section about-section text-standard">
                                {this.getStatus(this.isUpToDate())}
                            </section>
                            <section className="wave-modal-section about-section">
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
                                    href={util.makeExternLink("https://www.waveterm.dev/")}
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
                            <section className="wave-modal-section about-section text-standard">
                                &copy; 2023 Command Line Inc.
                            </section>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

@mobxReact.observer
class CreateRemoteConnModal extends React.Component<{ model: RemotesModalModel; remoteEdit: T.RemoteEditType }, {}> {
    tempAlias: OV<string>;
    tempHostName: OV<string>;
    tempPort: OV<string>;
    tempAuthMode: OV<string>;
    tempConnectMode: OV<string>;
    tempManualMode: OV<boolean>;
    tempPassword: OV<string>;
    tempKeyFile: OV<string>;
    errorStr: OV<string>;

    constructor(props: any) {
        super(props);
        let { remoteEdit } = this.props;
        this.tempAlias = mobx.observable.box("", { name: "CreateRemote-alias" });
        this.tempHostName = mobx.observable.box("", { name: "CreateRemote-hostName" });
        this.tempPort = mobx.observable.box("", { name: "CreateRemote-port" });
        this.tempAuthMode = mobx.observable.box("none", { name: "CreateRemote-authMode" });
        this.tempConnectMode = mobx.observable.box("auto", { name: "CreateRemote-connectMode" });
        this.tempKeyFile = mobx.observable.box("", { name: "CreateRemote-keystr" });
        this.tempPassword = mobx.observable.box("", { name: "CreateRemote-password" });
        this.errorStr = mobx.observable.box(remoteEdit.errorstr, { name: "CreateRemote-errorStr" });
    }

    remoteCName(): string {
        let hostName = this.tempHostName.get();
        if (hostName == "") {
            return "[no host]";
        }
        if (hostName.indexOf("@") == -1) {
            hostName = "[no user]@" + hostName;
        }
        return hostName;
    }

    getErrorStr(): string {
        if (this.errorStr.get() != null) {
            return this.errorStr.get();
        }
        return this.props.remoteEdit.errorstr;
    }

    @boundMethod
    submitRemote(): void {
        mobx.action(() => {
            this.errorStr.set(null);
        })();
        let authMode = this.tempAuthMode.get();
        let cname = this.tempHostName.get();
        if (cname == "") {
            this.errorStr.set("You must specify a 'user@host' value to create a new connection");
            return;
        }
        let kwargs: Record<string, string> = {};
        kwargs["alias"] = this.tempAlias.get();
        if (this.tempPort.get() != "" && this.tempPort.get() != "22") {
            kwargs["port"] = this.tempPort.get();
        }
        if (authMode == "key" || authMode == "key+password") {
            if (this.tempKeyFile.get() == "") {
                this.errorStr.set("When AuthMode is set to 'key', you must supply a valid key file name.");
                return;
            }
            kwargs["key"] = this.tempKeyFile.get();
        } else {
            kwargs["key"] = "";
        }
        if (authMode == "password" || authMode == "key+password") {
            if (this.tempPassword.get() == "") {
                this.errorStr.set("When AuthMode is set to 'password', you must supply a password.");
                return;
            }
            kwargs["password"] = this.tempPassword.get();
        } else {
            kwargs["password"] = "";
        }
        kwargs["connectmode"] = this.tempConnectMode.get();
        kwargs["visual"] = "1";
        kwargs["submit"] = "1";
        let model = this.props.model;
        let prtn = GlobalCommandRunner.createRemote(cname, kwargs, false);
        prtn.then((crtn) => {
            if (crtn.success) {
                let crRtn = GlobalCommandRunner.screenSetRemote(cname, true, false);
                crRtn.then((crcrtn) => {
                    if (crcrtn.success) {
                        model.closeModal();
                        return;
                    }
                    mobx.action(() => {
                        this.errorStr.set(crcrtn.error);
                    })();
                });
                return;
            }
            mobx.action(() => {
                this.errorStr.set(crtn.error);
            })();
        });
    }

    @boundMethod
    handleChangeKeyFile(value: string): void {
        mobx.action(() => {
            this.tempKeyFile.set(value);
        })();
    }

    @boundMethod
    handleChangePassword(value: string): void {
        mobx.action(() => {
            this.tempPassword.set(value);
        })();
    }

    @boundMethod
    handleChangeAlias(value: string): void {
        mobx.action(() => {
            this.tempAlias.set(value);
        })();
    }

    @boundMethod
    handleChangePort(value: string): void {
        mobx.action(() => {
            this.tempPort.set(value);
        })();
    }

    @boundMethod
    handleChangeHostName(value: string): void {
        mobx.action(() => {
            this.tempHostName.set(value);
        })();
    }

    render() {
        let { model, remoteEdit } = this.props;
        let authMode = this.tempAuthMode.get();

        return (
            <div className={cn("modal wave-modal crconn-modal is-active")}>
                <div className="modal-background wave-modal-background" />
                <div className="modal-content wave-modal-content crconn-wave-modal-content">
                    <div className="wave-modal-content-inner crconn-wave-modal-content-inner">
                        <header className="wave-modal-header crconn-wave-modal-header">
                            <div className="wave-modal-title crconn-wave-modal-title">Add Connection</div>
                            <div className="wave-modal-close crconn-wave-modal-close" onClick={model.cancelEditAuth}>
                                <img src={close} alt="Close (Escape)" />
                            </div>
                        </header>
                        <div className="wave-modal-body crconn-wave-modal-body">
                            <div className="user-section">
                                <TextField
                                    label="user@host"
                                    autoFocus={true}
                                    value={this.tempHostName.get()}
                                    onChange={this.handleChangeHostName}
                                    required={true}
                                    decoration={{
                                        endDecoration: (
                                            <InputDecoration>
                                                <Tooltip
                                                    message={`(Required) The user and host that you want to connect with. This is in the same format as
													you would pass to ssh, e.g. "ubuntu@test.mydomain.com".`}
                                                    icon={<i className="fa-sharp fa-regular fa-circle-question" />}
                                                >
                                                    <i className="fa-sharp fa-regular fa-circle-question" />
                                                </Tooltip>
                                            </InputDecoration>
                                        ),
                                    }}
                                />
                            </div>
                            <div className="alias-section">
                                <TextField
                                    label="Alias"
                                    onChange={this.handleChangeAlias}
                                    value={this.tempAlias.get()}
                                    maxLength={100}
                                    decoration={{
                                        endDecoration: (
                                            <InputDecoration>
                                                <Tooltip
                                                    message={`(Optional) A short alias to use when selecting or displaying this connection.`}
                                                    icon={<i className="fa-sharp fa-regular fa-circle-question" />}
                                                >
                                                    <i className="fa-sharp fa-regular fa-circle-question" />
                                                </Tooltip>
                                            </InputDecoration>
                                        ),
                                    }}
                                />
                            </div>
                            <div className="port-section">
                                <NumberField
                                    label="Port"
                                    placeholder="22"
                                    value={this.tempPort.get()}
                                    onChange={this.handleChangePort}
                                    decoration={{
                                        endDecoration: (
                                            <InputDecoration>
                                                <Tooltip
                                                    message={`(Optional) Defaults to 22. Set if the server you are connecting to listens to a non-standard
													SSH port.`}
                                                    icon={<i className="fa-sharp fa-regular fa-circle-question" />}
                                                >
                                                    <i className="fa-sharp fa-regular fa-circle-question" />
                                                </Tooltip>
                                            </InputDecoration>
                                        ),
                                    }}
                                />
                            </div>
                            <div className="authmode-section">
                                <Dropdown
                                    label="Auth Mode"
                                    options={[
                                        { value: "none", label: "none" },
                                        { value: "key", label: "key" },
                                        { value: "password", label: "password" },
                                        { value: "key+password", label: "key+password" },
                                    ]}
                                    value={this.tempAuthMode.get()}
                                    onChange={(val: string) => {
                                        this.tempAuthMode.set(val);
                                    }}
                                    decoration={{
                                        endDecoration: (
                                            <InputDecoration>
                                                <Tooltip
                                                    message={
                                                        <ul>
                                                            <li>
                                                                <b>none</b> - no authentication, or authentication is
                                                                already configured in your ssh config.
                                                            </li>
                                                            <li>
                                                                <b>key</b> - use a private key.
                                                            </li>
                                                            <li>
                                                                <b>password</b> - use a password.
                                                            </li>
                                                            <li>
                                                                <b>key+password</b> - use a key with a passphrase.
                                                            </li>
                                                        </ul>
                                                    }
                                                    icon={<i className="fa-sharp fa-regular fa-circle-question" />}
                                                >
                                                    <i className="fa-sharp fa-regular fa-circle-question" />
                                                </Tooltip>
                                            </InputDecoration>
                                        ),
                                    }}
                                />
                            </div>
                            <If condition={authMode == "key" || authMode == "key+password"}>
                                <TextField
                                    label="SSH Keyfile"
                                    placeholder="keyfile path"
                                    onChange={this.handleChangeKeyFile}
                                    value={this.tempKeyFile.get()}
                                    maxLength={400}
                                    required={true}
                                    decoration={{
                                        endDecoration: (
                                            <InputDecoration>
                                                <Tooltip
                                                    message={`(Required) The path to your ssh key file.`}
                                                    icon={<i className="fa-sharp fa-regular fa-circle-question" />}
                                                >
                                                    <i className="fa-sharp fa-regular fa-circle-question" />
                                                </Tooltip>
                                            </InputDecoration>
                                        ),
                                    }}
                                />
                            </If>
                            <If condition={authMode == "password" || authMode == "key+password"}>
                                <PasswordField
                                    label={authMode == "password" ? "SSH Password" : "Key Passphrase"}
                                    placeholder="password"
                                    onChange={this.handleChangePassword}
                                    value={this.tempPassword.get()}
                                    maxLength={400}
                                />
                            </If>
                            <div className="connectmode-section">
                                <Dropdown
                                    label="Connect Mode"
                                    options={[
                                        { value: "startup", label: "startup" },
                                        { value: "key", label: "key" },
                                        { value: "auto", label: "auto" },
                                        { value: "manual", label: "manual" },
                                    ]}
                                    value={this.tempConnectMode.get()}
                                    onChange={(val: string) => {
                                        this.tempConnectMode.set(val);
                                    }}
                                />
                            </div>
                            <If condition={!util.isBlank(this.getErrorStr())}>
                                <div className="settings-field settings-error">Error: {this.getErrorStr()}</div>
                            </If>
                        </div>
                        <footer className="wave-modal-footer crconn-wave-modal-footer">
                            <div className="action-buttons">
                                <Button theme="secondary" onClick={model.cancelEditAuth}>
                                    Cancel
                                </Button>
                                <Button onClick={this.submitRemote}>Connect</Button>
                            </div>
                        </footer>
                    </div>
                </div>
            </div>
        );
    }
}

@mobxReact.observer
class RemoteConnDetailModal extends React.Component<{ model: RemotesModalModel; remote: T.RemoteType }, {}> {
    termRef: React.RefObject<any> = React.createRef();

    componentDidMount() {
        let elem = this.termRef.current;
        if (elem == null) {
            console.log("ERROR null term-remote element");
            return;
        }
        this.props.model.createTermWrap(elem);
    }

    componentDidUpdate() {
        let { remote } = this.props;
        if (remote == null || remote.archived) {
            this.props.model.deSelectRemote();
        }
    }

    componentWillUnmount() {
        this.props.model.disposeTerm();
    }

    @boundMethod
    clickTermBlock(): void {
        if (this.props.model.remoteTermWrap != null) {
            this.props.model.remoteTermWrap.giveFocus();
        }
    }

    getRemoteTypeStr(remote: T.RemoteType): string {
        if (!util.isBlank(remote.uname)) {
            let unameStr = remote.uname;
            unameStr = unameStr.replace("|", ", ");
            return remote.remotetype + " (" + unameStr + ")";
        }
        return remote.remotetype;
    }

    @boundMethod
    connectRemote(remoteId: string) {
        GlobalCommandRunner.connectRemote(remoteId);
    }

    @boundMethod
    disconnectRemote(remoteId: string) {
        GlobalCommandRunner.disconnectRemote(remoteId);
    }

    @boundMethod
    installRemote(remoteId: string) {
        GlobalCommandRunner.installRemote(remoteId);
    }

    @boundMethod
    cancelInstall(remoteId: string) {
        GlobalCommandRunner.installCancelRemote(remoteId);
    }

    @boundMethod
    editAuthSettings(): void {
        this.props.model.startEditAuth();
    }

    renderInstallStatus(remote: T.RemoteType): any {
        let statusStr: string = null;
        if (remote.installstatus == "disconnected") {
            if (remote.needsmshellupgrade) {
                statusStr = "mshell " + remote.mshellversion + " - needs upgrade";
            } else if (util.isBlank(remote.mshellversion)) {
                statusStr = "mshell unknown";
            } else {
                statusStr = "mshell " + remote.mshellversion + " - current";
            }
        } else {
            statusStr = remote.installstatus;
        }
        if (statusStr == null) {
            return null;
        }
        return (
            <div key="install-status" className="settings-field">
                <div className="settings-label"> Install Status</div>
                <div className="settings-input">{statusStr}</div>
            </div>
        );
    }

    renderRemoteMessage(remote: T.RemoteType): any {
        let message: string = "";
        let buttons: any[] = [];
        // connect, disconnect, editauth, tryreconnect, install

        let disconnectButton = (
            <div
                key="disconnect"
                style={{ marginLeft: 10 }}
                onClick={() => this.disconnectRemote(remote.remoteid)}
                className="button is-prompt-danger is-outlined is-small"
            >
                Disconnect Now
            </div>
        );
        let connectButton = (
            <div
                key="connect"
                style={{ marginLeft: 10 }}
                onClick={() => this.connectRemote(remote.remoteid)}
                className="button is-prompt-green is-outlined is-small"
            >
                Connect Now
            </div>
        );
        let tryReconnectButton = (
            <div
                key="tryreconnect"
                style={{ marginLeft: 10 }}
                onClick={() => this.connectRemote(remote.remoteid)}
                className="button is-prompt-green is-outlined is-small"
            >
                Try Reconnect
            </div>
        );
        let updateAuthButton = (
            <div
                key="updateauth"
                style={{ marginLeft: 10 }}
                onClick={() => this.editAuthSettings()}
                className="button is-plain is-outlined is-small"
            >
                Update Auth Settings
            </div>
        );
        let cancelInstallButton = (
            <div
                key="cancelinstall"
                style={{ marginLeft: 10 }}
                onClick={() => this.cancelInstall(remote.remoteid)}
                className="button is-prompt-danger is-outlined is-small"
            >
                Cancel Install
            </div>
        );
        let installNowButton = (
            <div
                key="installnow"
                style={{ marginLeft: 10 }}
                onClick={() => this.installRemote(remote.remoteid)}
                className="button is-prompt-green is-outlined is-small"
            >
                Install Now
            </div>
        );
        if (remote.local) {
            installNowButton = null;
            updateAuthButton = null;
            cancelInstallButton = null;
        }
        if (remote.status == "connected") {
            message = "Connected and ready to run commands.";
            buttons = [disconnectButton];
        } else if (remote.status == "connecting") {
            message = remote.waitingforpassword ? "Connecting, waiting for user-input..." : "Connecting...";
            let connectTimeout = remote.connecttimeout ?? 0;
            message = message + " (" + connectTimeout + "s)";
            buttons = [disconnectButton];
        } else if (remote.status == "disconnected") {
            message = "Disconnected";
            buttons = [connectButton];
        } else if (remote.status == "error") {
            if (remote.noinitpk) {
                message = "Error, could not connect.";
                buttons = [tryReconnectButton, updateAuthButton];
            } else if (remote.needsmshellupgrade) {
                if (remote.installstatus == "connecting") {
                    message = "Installing...";
                    buttons = [cancelInstallButton];
                } else {
                    message = "Error, needs install.";
                    buttons = [installNowButton, updateAuthButton];
                }
            } else {
                message = "Error";
                buttons = [tryReconnectButton, updateAuthButton];
            }
        }
        let button: any = null;
        return (
            <div className="remote-message">
                <div className="message-row">
                    <div>
                        <RemoteStatusLight remote={remote} /> {message}
                    </div>
                    <div className="flex-spacer" />
                    <For each="button" of={buttons}>
                        {button}
                    </For>
                </div>
            </div>
        );
    }

    render() {
        let { model, remote } = this.props;
        let isTermFocused = model.remoteTermWrapFocus.get();
        let termFontSize = GlobalModel.termFontSize.get();
        let remoteMessage = this.renderRemoteMessage(remote);
        let termWidth = textmeasure.termWidthFromCols(RemotePtyCols, termFontSize);
        let remoteAliasText = util.isBlank(remote.remotealias) ? "(none)" : remote.remotealias;
        return (
            <div className="remote-detail" style={{ overflow: "hidden" }}>
                <div className="title is-5">{getRemoteTitle(remote)}</div>
                <div className="settings-field">
                    <div className="settings-label">Conn Id</div>
                    <div className="settings-input">{remote.remoteid}</div>
                </div>
                <div className="settings-field">
                    <div className="settings-label">Type</div>
                    <div className="settings-input">{this.getRemoteTypeStr(remote)}</div>
                </div>
                <div className="settings-field">
                    <div className="settings-label">Canonical Name</div>
                    <div className="settings-input">
                        {remote.remotecanonicalname}
                        <If condition={!util.isBlank(remote.remotevars.port) && remote.remotevars.port != "22"}>
                            <span style={{ marginLeft: 5 }}>(port {remote.remotevars.port})</span>
                        </If>
                    </div>
                </div>
                <div className="settings-field" style={{ minHeight: 24 }}>
                    <div className="settings-label">Alias</div>
                    <div className="settings-input">{remoteAliasText}</div>
                </div>
                <div className="settings-field">
                    <div className="settings-label">Auth Type</div>
                    <div className="settings-input">
                        <If condition={!remote.local}>{remote.authtype}</If>
                        <If condition={remote.local}>local</If>
                    </div>
                </div>
                <div className="settings-field">
                    <div className="settings-label">Connect Mode</div>
                    <div className="settings-input">{remote.connectmode}</div>
                </div>
                {this.renderInstallStatus(remote)}
                <div className="settings-field">
                    <div className="settings-label">Actions</div>
                    <div className="settings-input">
                        <div
                            onClick={() => this.editAuthSettings()}
                            className="button is-prompt-green is-outlined is-small is-inline-height"
                        >
                            Edit Connection Settings
                        </div>
                    </div>
                </div>
                <div className="flex-spacer" style={{ minHeight: 20 }} />
                <div style={{ width: "100%" }}>{remoteMessage}</div>
                <div
                    key="term"
                    className={cn(
                        "terminal-wrapper",
                        { focus: isTermFocused },
                        remote != null ? "status-" + remote.status : null,
                        { "has-message": remoteMessage != null }
                    )}
                    style={{ width: "100%", overflowX: "auto" }}
                >
                    <If condition={!isTermFocused}>
                        <div key="termblock" className="term-block" onClick={this.clickTermBlock}></div>
                    </If>
                    <If condition={model.showNoInputMsg.get()}>
                        <div key="termtag" className="term-tag">
                            input is only allowed while status is 'connecting'
                        </div>
                    </If>
                    <div
                        key="terminal"
                        className="terminal-connectelem"
                        ref={this.termRef}
                        data-remoteid={remote.remoteid}
                        style={{
                            height: textmeasure.termHeightFromRows(RemotePtyRows, termFontSize),
                            width: termWidth,
                        }}
                    ></div>
                </div>
            </div>
        );
    }
}

export {
    LoadingSpinner,
    ClientStopModal,
    AlertModal,
    DisconnectedModal,
    TosModal,
    AboutModal,
    CreateRemoteConnModal,
    RemoteConnDetailModal,
};
