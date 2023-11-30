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
import { GlobalModel, GlobalCommandRunner, RemotesModel } from "../../../model/model";
import * as T from "../../../types/types";
import { Markdown, InfoMessage } from "../common";
import * as util from "../../../util/util";
import * as textmeasure from "../../../util/textmeasure";
import { Toggle, Checkbox, Modal } from "../common";
import { ClientDataType } from "../../../types/types";
import { TextField, NumberField, InputDecoration, Dropdown, PasswordField, Tooltip, Button, Status } from "../common";

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

const RemotePtyRows = 9;
const RemotePtyCols = 80;
const PasswordUnchangedSentinel = "--unchanged--";

@mobxReact.observer
class ModalProvider extends React.Component {
    renderModals() {
        const modals = GlobalModel.modalStoreModel.activeModals;

        return modals.map((ModalComponent, index) => <ModalComponent key={index} />);
    }

    render() {
        return <>{this.renderModals()}</>;
    }
}

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
        let logLine: string | null = null;
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
class AlertModal extends React.Component<{ onOk?: () => void }, {}> {
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
        let title = message?.title ?? (message?.confirm ? "Confirm" : "Alert");
        let isConfirm = message?.confirm ?? false;

        return (
            <Modal onClose={this.closeModal} onOk={this.handleOK} title={title} className="alert-modal">
                <Modal.Header />
                <Modal.Body>
                    <If condition={message?.markdown}>
                        <Markdown text={message?.message ?? ""} />
                    </If>
                    <If condition={!message?.markdown}>{message?.message}</If>
                </Modal.Body>
                <Modal.Footer>
                    <If condition={isConfirm}>
                        <Button theme="secondary" onClick={this.closeModal}>
                            Cancel
                        </Button>
                        <Button onClick={this.handleOK}>Ok</Button>
                    </If>
                    <If condition={!isConfirm}>
                        <Button onClick={this.handleOK}>Ok</Button>
                    </If>
                </Modal.Footer>
            </Modal>
        );
    }
}

@mobxReact.observer
class TosModal extends React.Component<{}, {}> {
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
                            <div className="item-text">
                                By continuing, I accept the&nbsp;
                                <a href="https://www.waveterm.dev/tos">Terms of Service</a>
                            </div>
                            <div className="button-wrapper">
                                <Button onClick={this.acceptTos}>Continue</Button>
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
            GlobalModel.modalStoreModel.popModal();
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
            <Modal onClose={this.closeModal} title="About" className="about-modal">
                <Modal.Header />
                <Modal.Body>
                    <div className="about-section">
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
                    </div>
                    <div className="about-section text-standard">{this.getStatus(this.isUpToDate())}</div>
                    <div className="about-section">
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
                            href={util.makeExternLink("https://github.com/wavetermdev/waveterm/blob/main/LICENSE")}
                            target="_blank"
                        >
                            <i className="fa-sharp fa-light fa-book-blank"></i>
                            License
                        </a>
                    </div>
                    <div className="about-section text-standard">&copy; 2023 Command Line Inc.</div>
                </Modal.Body>
            </Modal>
        );
    }
}

@mobxReact.inject("remotesModel")
@mobxReact.observer
class CreateRemoteConnModal extends React.Component<{ remotesModel?: RemotesModel }, {}> {
    tempAlias: OV<string>;
    tempHostName: OV<string>;
    tempPort: OV<string>;
    tempAuthMode: OV<string>;
    tempConnectMode: OV<string>;
    tempPassword: OV<string>;
    tempKeyFile: OV<string>;
    errorStr: OV<string | null>;
    remoteEdit: T.RemoteEditType | null;
    model: RemotesModel;

    constructor(props: { remotesModel?: RemotesModel }) {
        super(props);
        this.model = this.props.remotesModel as RemotesModel;
        this.remoteEdit = this.model.remoteEdit.get();
        this.tempAlias = mobx.observable.box("", { name: "CreateRemote-alias" });
        this.tempHostName = mobx.observable.box("", { name: "CreateRemote-hostName" });
        this.tempPort = mobx.observable.box("", { name: "CreateRemote-port" });
        this.tempAuthMode = mobx.observable.box("none", { name: "CreateRemote-authMode" });
        this.tempConnectMode = mobx.observable.box("auto", { name: "CreateRemote-connectMode" });
        this.tempKeyFile = mobx.observable.box("", { name: "CreateRemote-keystr" });
        this.tempPassword = mobx.observable.box("", { name: "CreateRemote-password" });
        this.errorStr = mobx.observable.box(this.remoteEdit?.errorstr ?? null, { name: "CreateRemote-errorStr" });
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

    getErrorStr(): string | null {
        if (this.errorStr.get() != null) {
            return this.errorStr.get();
        }
        return this.remoteEdit?.errorstr ?? null;
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
        let model = this.model;
        let prtn = GlobalCommandRunner.createRemote(cname, kwargs, false);
        prtn.then((crtn) => {
            if (crtn.success) {
                let crRtn = GlobalCommandRunner.screenSetRemote(cname, true, false);
                crRtn.then((crcrtn) => {
                    if (crcrtn.success) {
                        return;
                    }
                    mobx.action(() => {
                        this.errorStr.set(crcrtn.error ?? null);
                    })();
                });
                return;
            }
            mobx.action(() => {
                this.errorStr.set(crtn.error ?? null);
            })();
        });
        model.seRecentConnAdded(true);
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
    handleChangeAuthMode(value: string): void {
        mobx.action(() => {
            this.tempAuthMode.set(value);
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

    @boundMethod
    handleChangeConnectMode(value: string): void {
        mobx.action(() => {
            this.tempConnectMode.set(value);
        })();
    }

    render() {
        let authMode = this.tempAuthMode.get();

        if (this.remoteEdit == null) {
            return null;
        }

        return (
            <Modal
                onClose={this.model.closeModal}
                onOk={this.submitRemote}
                title="Add Connection"
                okLabel="Connect"
                className="crconn-modal"
            >
                <Modal.Header />
                <Modal.Body>
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
                                                        <b>none</b> - no authentication, or authentication is already
                                                        configured in your ssh config.
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
                    <If condition={!util.isBlank(this.getErrorStr() as string)}>
                        <div className="settings-field settings-error">Error: {this.getErrorStr()}</div>
                    </If>
                </Modal.Body>
                <Modal.Footer />
            </Modal>
        );
    }
}

@mobxReact.inject("remotesModel")
@mobxReact.observer
class ViewRemoteConnDetailModal extends React.Component<{ remotesModel?: RemotesModel }, {}> {
    termRef: React.RefObject<any> = React.createRef();
    model: RemotesModel;

    constructor(props: { remotesModel?: RemotesModel }) {
        super(props);
        this.model = this.props.remotesModel as RemotesModel;
    }

    @mobx.computed
    get selectedRemote(): T.RemoteType | null {
        const selectedRemoteId = this.model.selectedRemoteId.get();
        return GlobalModel.getRemote(selectedRemoteId);
    }

    componentDidMount() {
        let elem = this.termRef.current;
        if (elem == null) {
            console.log("ERROR null term-remote element");
            return;
        }
        this.model.createTermWrap(elem);
    }

    componentDidUpdate() {
        if (this.selectedRemote == null || this.selectedRemote.archived) {
            this.model.deSelectRemote();
        }
    }

    componentWillUnmount() {
        this.model.disposeTerm();
    }

    @boundMethod
    clickTermBlock(): void {
        if (this.model.remoteTermWrap != null) {
            this.model.remoteTermWrap.giveFocus();
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
    openEditModal(): void {
        GlobalModel.remotesModel.openEditModal();
    }

    @boundMethod
    getStatus(status: string) {
        switch (status) {
            case "connected":
                return "green";
            case "disconnected":
                return "gray";
            default:
                return "red";
        }
    }

    @boundMethod
    clickArchive(): void {
        if (this.selectedRemote && this.selectedRemote.status == "connected") {
            GlobalModel.showAlert({ message: "Cannot archived a connected remote.  Disconnect and try again." });
            return;
        }
        let prtn = GlobalModel.showAlert({
            message: "Are you sure you want to archive this connection?",
            confirm: true,
        });
        prtn.then((confirm) => {
            if (!confirm) {
                return;
            }
            if (this.selectedRemote) {
                GlobalCommandRunner.archiveRemote(this.selectedRemote.remoteid);
            }
        });
    }

    @boundMethod
    handleClose(): void {
        this.model.closeModal();
        this.model.seRecentConnAdded(false);
    }

    renderInstallStatus(remote: T.RemoteType): any {
        let statusStr: string | null = null;
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

    renderHeaderBtns(remote: T.RemoteType): React.ReactNode {
        let buttons: React.ReactNode[] = [];
        const archiveButton = (
            <Button theme="secondary" onClick={() => this.clickArchive()}>
                Archive
            </Button>
        );
        const disconnectButton = (
            <Button theme="secondary" onClick={() => this.disconnectRemote(remote.remoteid)}>
                Disconnect Now
            </Button>
        );
        const connectButton = (
            <Button theme="secondary" onClick={() => this.connectRemote(remote.remoteid)}>
                Connect Now
            </Button>
        );
        const tryReconnectButton = (
            <Button theme="secondary" onClick={() => this.connectRemote(remote.remoteid)}>
                Try Reconnect
            </Button>
        );
        let updateAuthButton = (
            <Button theme="secondary" onClick={() => this.openEditModal()}>
                Edit
            </Button>
        );
        let cancelInstallButton = (
            <Button theme="secondary" onClick={() => this.cancelInstall(remote.remoteid)}>
                Cancel Install
            </Button>
        );
        let installNowButton = (
            <Button theme="secondary" onClick={() => this.installRemote(remote.remoteid)}>
                Install Now
            </Button>
        );
        if (remote.local) {
            installNowButton = <></>;
            updateAuthButton = <></>;
            cancelInstallButton = <></>;
        }
        buttons = [archiveButton, updateAuthButton];
        if (remote.status == "connected" || remote.status == "connecting") {
            buttons.push(disconnectButton);
        } else if (remote.status == "disconnected") {
            buttons.push(connectButton);
        } else if (remote.status == "error") {
            if (remote.needsmshellupgrade) {
                if (remote.installstatus == "connecting") {
                    buttons.push(cancelInstallButton);
                } else {
                    buttons.push(installNowButton);
                }
            } else {
                buttons.push(tryReconnectButton);
            }
        }

        let i = 0;
        let button: React.ReactNode = null;

        return (
            <For each="button" of={buttons} index="i">
                <div key={i}>{button}</div>
            </For>
        );
    }

    getMessage(remote: T.RemoteType): string {
        let message = "";
        if (remote.status == "connected") {
            message = "Connected and ready to run commands.";
        } else if (remote.status == "connecting") {
            message = remote.waitingforpassword ? "Connecting, waiting for user-input..." : "Connecting...";
            let connectTimeout = remote.connecttimeout ?? 0;
            message = message + " (" + connectTimeout + "s)";
        } else if (remote.status == "disconnected") {
            message = "Disconnected";
        } else if (remote.status == "error") {
            if (remote.noinitpk) {
                message = "Error, could not connect.";
            } else if (remote.needsmshellupgrade) {
                if (remote.installstatus == "connecting") {
                    message = "Installing...";
                } else {
                    message = "Error, needs install.";
                }
            } else {
                message = "Error";
            }
        }

        return message;
    }

    render() {
        let remote = this.selectedRemote;

        if (remote == null) {
            return null;
        }

        let model = this.model;
        let isTermFocused = this.model.remoteTermWrapFocus.get();
        let termFontSize = GlobalModel.termFontSize.get();
        let termWidth = textmeasure.termWidthFromCols(RemotePtyCols, termFontSize);
        let remoteAliasText = util.isBlank(remote.remotealias) ? "(none)" : remote.remotealias;

        return (
            <Modal
                onClose={this.model.closeModal}
                onOk={this.model.closeModal}
                title="Connection"
                okLabel="Done"
                className="rconndetail-modal"
            >
                <Modal.Header />
                <Modal.Body>
                    <div className="name-header-actions-wrapper">
                        <div className="name text-primary">{getName(remote)}</div>
                        <div className="header-actions">{this.renderHeaderBtns(remote)}</div>
                    </div>
                    <div className="remote-detail" style={{ overflow: "hidden" }}>
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
                        <div className="flex-spacer" style={{ minHeight: 20 }} />
                        <div className="status">
                            <Status status={this.getStatus(remote.status)} text={this.getMessage(remote)} />
                        </div>
                        <div
                            key="term"
                            className={cn(
                                "terminal-wrapper",
                                { focus: isTermFocused },
                                remote != null ? "status-" + remote.status : null
                            )}
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
                </Modal.Body>
                <Modal.Footer />
            </Modal>
        );
    }
}

@mobxReact.inject("remotesModel")
@mobxReact.observer
class EditRemoteConnModal extends React.Component<{ remotesModel?: RemotesModel }, {}> {
    submitted: OV<boolean>;
    model: RemotesModel;

    constructor(props: { remotesModel?: RemotesModel }) {
        super(props);
        this.model = this.props.remotesModel as RemotesModel;
        this.submitted = mobx.observable.box(false, { name: "EditRemoteConnModal-submitted" });
    }

    @mobx.computed
    get selectedRemoteId() {
        return this.model.selectedRemoteId.get();
    }

    @mobx.computed
    get selectedRemote(): T.RemoteType | null {
        return GlobalModel.getRemote(this.selectedRemoteId);
    }

    @mobx.computed
    get remoteEdit(): T.RemoteEditType | null {
        return this.model.remoteEdit.get();
    }

    @mobx.computed
    get isAuthEditMode(): boolean {
        return this.model.isAuthEditMode();
    }

    @mobx.computed
    get tempAlias(): mobx.IObservableValue<string> {
        return mobx.observable.box(this.selectedRemote?.remotealias ?? "", {
            name: "EditRemoteConnModal-alias",
        });
    }

    @mobx.computed
    get tempAuthMode(): mobx.IObservableValue<string | null> {
        return mobx.observable.box(this.selectedRemote?.authtype ?? null, {
            name: "EditRemoteConnModal-authMode",
        });
    }

    @mobx.computed
    get tempConnectMode(): mobx.IObservableValue<string | null> {
        return mobx.observable.box(this.selectedRemote?.connectmode ?? null, {
            name: "EditRemoteConnModal-connectMode",
        });
    }

    @mobx.computed
    get tempKeyFile(): mobx.IObservableValue<string> {
        return mobx.observable.box(this.remoteEdit?.keystr ?? "", {
            name: "EditRemoteConnModal-keystr",
        });
    }

    @mobx.computed
    get tempPassword(): mobx.IObservableValue<string> {
        return mobx.observable.box(this.remoteEdit?.haspassword ? PasswordUnchangedSentinel : "", {
            name: "EditRemoteConnModal-password",
        });
    }

    componentDidUpdate() {
        if (this.selectedRemote == null || this.selectedRemote.archived) {
            this.model.deSelectRemote();
        }
    }

    @boundMethod
    clickArchive(): void {
        if (this.selectedRemote?.status == "connected") {
            GlobalModel.showAlert({ message: "Cannot archived a connected remote.  Disconnect and try again." });
            return;
        }
        let prtn = GlobalModel.showAlert({
            message: "Are you sure you want to archive this connection?",
            confirm: true,
        });

        prtn.then((confirm) => {
            if (!confirm) {
                return;
            }
            GlobalCommandRunner.archiveRemote(this.selectedRemote?.remoteid ?? "");
        });
    }

    @boundMethod
    clickForceInstall(): void {
        GlobalCommandRunner.installRemote(this.selectedRemote?.remoteid ?? "");
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
    canResetPw(): boolean {
        if (this.remoteEdit == null) {
            return false;
        }
        return Boolean(this.remoteEdit.haspassword) && this.tempPassword.get() != PasswordUnchangedSentinel;
    }

    @boundMethod
    resetPw(): void {
        mobx.action(() => {
            this.tempPassword.set(PasswordUnchangedSentinel);
        })();
    }

    @boundMethod
    onFocusPassword(e: any) {
        if (this.tempPassword.get() == PasswordUnchangedSentinel) {
            e.target.select();
        }
    }

    @boundMethod
    submitRemote(): void {
        let authMode = this.tempAuthMode.get();
        let kwargs: Record<string, string> = {};
        if (!util.isStrEq(this.tempKeyFile.get(), this.remoteEdit?.keystr ?? "")) {
            if (authMode == "key" || authMode == "key+password") {
                kwargs["key"] = this.tempKeyFile.get();
            } else {
                kwargs["key"] = "";
            }
        }
        if (authMode == "password" || authMode == "key+password") {
            if (this.tempPassword.get() != PasswordUnchangedSentinel) {
                kwargs["password"] = this.tempPassword.get();
            }
        } else {
            if (this.remoteEdit?.haspassword) {
                kwargs["password"] = "";
            }
        }
        if (!util.isStrEq(this.tempAlias.get(), this.selectedRemote?.remotealias ?? "")) {
            kwargs["alias"] = this.tempAlias.get();
        }
        if (!util.isStrEq(this.tempConnectMode.get() ?? "", this.selectedRemote?.connectmode ?? "")) {
            kwargs["connectmode"] = this.tempConnectMode.get() ?? "";
        }
        if (Object.keys(kwargs).length == 0) {
            this.submitted.set(true);
            return;
        }
        kwargs["visual"] = "1";
        kwargs["submit"] = "1";
        GlobalCommandRunner.editRemote(this.selectedRemote?.remoteid ?? "", kwargs);
        this.submitted.set(true);
        this.model.seRecentConnAdded(false);
    }

    renderAuthModeMessage(): any {
        let authMode = this.tempAuthMode.get();
        if (authMode == "none") {
            return (
                <span>
                    This connection requires no authentication.
                    <br />
                    Or authentication is already configured in ssh_config.
                </span>
            );
        }
        if (authMode == "key") {
            return <span>Use a public/private keypair.</span>;
        }
        if (authMode == "password") {
            return <span>Use a password.</span>;
        }
        if (authMode == "key+password") {
            return <span>Use a public/private keypair with a passphrase.</span>;
        }
        return null;
    }

    render() {
        let authMode = this.tempAuthMode.get();

        if (
            (util.isBlank(this.remoteEdit?.errorstr ?? "") && this.submitted.get()) ||
            this.remoteEdit === null ||
            !this.isAuthEditMode
        ) {
            return null;
        }

        return (
            <div className={cn("modal wave-modal erconn-modal is-active")}>
                <div className="modal-background wave-modal-background" />
                <div className="modal-content wave-modal-content erconn-wave-modal-content">
                    <div className="wave-modal-content-inner erconn-wave-modal-content-inner">
                        <header className="wave-modal-header erconn-wave-modal-header">
                            <div className="wave-modal-title erconn-wave-modal-title">Edit Connection</div>
                            <div className="wave-modal-close erconn-wave-modal-close" onClick={this.model.closeModal}>
                                <img src={close} alt="Close (Escape)" />
                            </div>
                        </header>
                        <div className="wave-modal-body erconn-wave-modal-body">
                            <div className="name-actions-section">
                                <div className="name text-primary">{getName(this.selectedRemote)}</div>
                                <div className="header-actions">
                                    <Button theme="secondary" onClick={this.clickArchive}>
                                        Archive
                                    </Button>
                                    <Button theme="secondary" onClick={this.clickForceInstall}>
                                        Force Install
                                    </Button>
                                </div>
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
                            <div className="authmode-section">
                                <Dropdown
                                    label="Auth Mode"
                                    options={[
                                        { value: "none", label: "none" },
                                        { value: "key", label: "key" },
                                        { value: "password", label: "password" },
                                        { value: "key+password", label: "key+password" },
                                    ]}
                                    value={this.tempAuthMode.get() ?? ""}
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
                                    value={this.tempConnectMode.get() ?? ""}
                                    onChange={(val: string) => {
                                        this.tempConnectMode.set(val);
                                    }}
                                />
                            </div>
                            <If condition={!util.isBlank(this.remoteEdit?.errorstr ?? "")}>
                                <div className="settings-field settings-error">
                                    Error: {this.remoteEdit?.errorstr ?? ""}
                                </div>
                            </If>
                        </div>
                        <footer className="wave-modal-footer erconn-wave-modal-footer">
                            <div className="action-buttons">
                                <Button theme="secondary" onClick={this.model.closeModal}>
                                    Cancel
                                </Button>
                                <Button onClick={this.submitRemote}>Save</Button>
                            </div>
                        </footer>
                    </div>
                </div>
            </div>
        );
    }
}

const getName = (remote: T.RemoteType | null): string => {
    if (remote == null) {
        return "";
    }
    const { remotealias, remotecanonicalname } = remote;
    return remotealias ? `${remotealias} [${remotecanonicalname}]` : remotecanonicalname;
};

export {
    LoadingSpinner,
    ClientStopModal,
    AlertModal,
    DisconnectedModal,
    TosModal,
    AboutModal,
    CreateRemoteConnModal,
    ViewRemoteConnDetailModal,
    EditRemoteConnModal,
    ModalProvider,
};
