import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { sprintf } from "sprintf-js";
import { boundMethod } from "autobind-decorator";
import { If, For, When, Otherwise, Choose } from "tsx-control-statements/components";
import cn from "classnames";
import { GlobalModel, GlobalCommandRunner, getTermPtyData, RemotesModalModel } from "./model";
import { Toggle, RemoteStatusLight, InlineSettingsTextEdit, InfoMessage } from "./elements";
import { RemoteType, RemoteInputPacketType, RemoteEditType } from "./types";
import * as util from "./util";
import * as textmeasure from "./textmeasure";
import { TermWrap } from "./term";

type OV<V> = mobx.IObservableValue<V>;
type OArr<V> = mobx.IObservableArray<V>;
type OMap<K, V> = mobx.ObservableMap<K, V>;

const RemotePtyRows = 8;
const RemotePtyCols = 80;
const PasswordUnchangedSentinel = "--unchanged--";

function getRemoteCNWithPort(remote: RemoteType) {
    if (util.isBlank(remote.remotevars.port) || remote.remotevars.port == "22") {
        return remote.remotecanonicalname;
    }
    return remote.remotecanonicalname + ":" + remote.remotevars.port;
}

function getRemoteTitle(remote: RemoteType) {
    if (!util.isBlank(remote.remotealias)) {
        return remote.remotealias + " (" + remote.remotecanonicalname + ")";
    }
    return remote.remotecanonicalname;
}

@mobxReact.observer
class AuthModeDropdown extends React.Component<{ tempVal: OV<string> }, {}> {
    active: OV<boolean> = mobx.observable.box(false, { name: "AuthModeDropdown-active" });

    @boundMethod
    toggleActive(): void {
        mobx.action(() => {
            this.active.set(!this.active.get());
        })();
    }

    @boundMethod
    updateValue(val: string): void {
        mobx.action(() => {
            this.props.tempVal.set(val);
            this.active.set(false);
        })();
    }

    render() {
        return (
            <div className={cn("dropdown", "editremote-dropdown", { "is-active": this.active.get() })}>
                <div className="dropdown-trigger">
                    <button onClick={this.toggleActive} className="button is-small is-dark">
                        <span>{this.props.tempVal.get()}</span>
                        <div className="flex-spacer" />
                        <span className="icon is-small">
                            <i className="fa-sharp fa-regular fa-angle-down" aria-hidden="true"></i>
                        </span>
                    </button>
                </div>
                <div className="dropdown-menu" role="menu">
                    <div className="dropdown-content has-background-black">
                        <div key="none" onClick={() => this.updateValue("none")} className="dropdown-item">
                            none
                        </div>
                        <div key="key" onClick={() => this.updateValue("key")} className="dropdown-item">
                            key
                        </div>
                        <div key="password" onClick={() => this.updateValue("password")} className="dropdown-item">
                            password
                        </div>
                        <div
                            key="key+password"
                            onClick={() => this.updateValue("key+password")}
                            className="dropdown-item"
                        >
                            key+password
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

@mobxReact.observer
class ConnectModeDropdown extends React.Component<{ tempVal: OV<string> }, {}> {
    active: OV<boolean> = mobx.observable.box(false, { name: "ConnectModeDropdown-active" });

    @boundMethod
    toggleActive(): void {
        mobx.action(() => {
            this.active.set(!this.active.get());
        })();
    }

    @boundMethod
    updateValue(val: string): void {
        mobx.action(() => {
            this.props.tempVal.set(val);
            this.active.set(false);
        })();
    }

    render() {
        return (
            <div className={cn("dropdown", "editremote-dropdown", { "is-active": this.active.get() })}>
                <div className="dropdown-trigger">
                    <button onClick={this.toggleActive} className="button is-small is-dark">
                        <span>{this.props.tempVal.get()}</span>
                        <div className="flex-spacer" />
                        <span className="icon is-small">
                            <i className="fa-sharp fa-regular fa-angle-down" aria-hidden="true"></i>
                        </span>
                    </button>
                </div>
                <div className="dropdown-menu" role="menu">
                    <div className="dropdown-content has-background-black">
                        <div key="startup" onClick={() => this.updateValue("startup")} className="dropdown-item">
                            startup
                        </div>
                        <div key="auto" onClick={() => this.updateValue("auto")} className="dropdown-item">
                            auto
                        </div>
                        <div key="manual" onClick={() => this.updateValue("manual")} className="dropdown-item">
                            manual
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}

@mobxReact.observer
class CreateRemote extends React.Component<{ model: RemotesModalModel; remoteEdit: RemoteEditType }, {}> {
    tempAlias: OV<string>;
    tempHostName: OV<string>;
    tempPort: OV<string>;
    tempAuthMode: OV<string>;
    tempConnectMode: OV<string>;
    tempManualMode: OV<boolean>;
    tempPassword: OV<string>;
    tempKeyFile: OV<string>;
    tempAutoInstall: OV<boolean>;
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
        this.tempAutoInstall = mobx.observable.box(true, { name: "CreateRemote-autoinstall" });
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
        kwargs["autoinstall"] = this.tempAutoInstall.get() ? "1" : "0";
        kwargs["visual"] = "1";
        kwargs["submit"] = "1";
        GlobalCommandRunner.createRemote(cname, kwargs);
    }

    @boundMethod
    handleChangeKeyFile(e: any): void {
        mobx.action(() => {
            this.tempKeyFile.set(e.target.value);
        })();
    }

    @boundMethod
    handleChangePassword(e: any): void {
        mobx.action(() => {
            this.tempPassword.set(e.target.value);
        })();
    }

    @boundMethod
    handleChangeAlias(e: any): void {
        mobx.action(() => {
            this.tempAlias.set(e.target.value);
        })();
    }

    @boundMethod
    handleChangePort(e: any): void {
        mobx.action(() => {
            this.tempPort.set(e.target.value);
        })();
    }

    @boundMethod
    handleChangeHostName(e: any): void {
        mobx.action(() => {
            this.tempHostName.set(e.target.value);
        })();
    }

    @boundMethod
    handleChangeAutoInstall(val: boolean): void {
        mobx.action(() => {
            this.tempAutoInstall.set(val);
        })();
    }

    render() {
        let { model, remoteEdit } = this.props;
        let authMode = this.tempAuthMode.get();
        return (
            <div className="remote-detail create-remote">
                <div className="title is-5">Create New Connection</div>
                <div className="settings-field mt-3">
                    <div className="settings-label">
                        <div>user@host</div>
                        <div className="flex-spacer" />
                        <InfoMessage width={400}>
                            (Required) The user and host that you want to connect with. This is in the same format as
                            you would pass to ssh, e.g. "ubuntu@test.mydomain.com".
                        </InfoMessage>
                    </div>
                    <div className="settings-input">
                        <input
                            type="text"
                            placeholder="user@host"
                            onChange={this.handleChangeHostName}
                            value={this.tempHostName.get()}
                            maxLength={100}
                        />
                    </div>
                </div>
                <div className="settings-field">
                    <div className="settings-label">
                        <div>Alias</div>
                        <div className="flex-spacer" />
                        <InfoMessage width={400}>
                            (Optional) A short alias to use when selecting or displaying this connection.
                        </InfoMessage>
                    </div>
                    <div className="settings-input">
                        <input
                            type="text"
                            onChange={this.handleChangeAlias}
                            value={this.tempAlias.get()}
                            maxLength={40}
                        />
                    </div>
                </div>
                <div className="settings-field">
                    <div className="settings-label">
                        <div>Port</div>
                        <div className="flex-spacer" />
                        <InfoMessage width={400}>
                            (Optional) Defaults to 22. Set if the server you are connecting to listens to a non-standard
                            SSH port.
                        </InfoMessage>
                    </div>
                    <div className="settings-input">
                        <input
                            type="number"
                            placeholder="22"
                            onChange={this.handleChangePort}
                            value={this.tempPort.get()}
                        />
                    </div>
                </div>
                <div className="settings-field align-top">
                    <div className="settings-label">
                        <div>Auth Mode</div>
                        <div className="flex-spacer" />
                        <InfoMessage width={350}>
                            <ul>
                                <li>
                                    <b>none</b> - no authentication, or authentication is already configured in your ssh
                                    config.
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
                        </InfoMessage>
                    </div>
                    <div className="settings-input">
                        <div className="raw-input">
                            <AuthModeDropdown tempVal={this.tempAuthMode} />
                        </div>
                    </div>
                </div>
                <If condition={authMode == "key" || authMode == "key+password"}>
                    <div className="settings-field" style={{ marginTop: 10 }}>
                        <div className="settings-label">SSH Keyfile</div>
                        <div className="settings-input">
                            <input
                                type="text"
                                placeholder="keyfile"
                                onChange={this.handleChangeKeyFile}
                                value={this.tempKeyFile.get()}
                                maxLength={400}
                            />
                        </div>
                    </div>
                </If>
                <If condition={authMode == "password" || authMode == "key+password"}>
                    <div className="settings-field" style={{ marginTop: 10 }}>
                        <div className="settings-label">
                            {authMode == "password" ? "SSH Password" : "Key Passphrase"}
                        </div>
                        <div className="settings-input">
                            <input
                                type="password"
                                placeholder="password"
                                onChange={this.handleChangePassword}
                                value={this.tempPassword.get()}
                                maxLength={400}
                            />
                        </div>
                    </div>
                </If>
                <div className="settings-field align-top" style={{ marginTop: 10 }}>
                    <div className="settings-label">
                        <div>Connect Mode</div>
                        <div className="flex-spacer" />
                        <InfoMessage width={350}>
                            <ul>
                                <li>
                                    <b>startup</b> - connect when [prompt] starts.
                                </li>
                                <li>
                                    <b>auto</b> - connect when you first run a command using this connection.
                                </li>
                                <li>
                                    <b>manual</b> - connect manually. Note, if your connection requires manual input,
                                    like an OPT code, you must use this setting.
                                </li>
                            </ul>
                        </InfoMessage>
                    </div>
                    <div className="settings-input">
                        <div className="raw-input">
                            <div className="raw-input">
                                <ConnectModeDropdown tempVal={this.tempConnectMode} />
                            </div>
                        </div>
                    </div>
                </div>
                <div className="settings-field" style={{ marginTop: 10 }}>
                    <div className="settings-label">
                        <div>Auto Install</div>
                        <div className="flex-spacer" />
                        <InfoMessage width={350}>
                            If selected, will try to auto-install the mshell client if it is not installed or out of
                            date.
                        </InfoMessage>
                    </div>
                    <div className="settings-input">
                        <Toggle checked={this.tempAutoInstall.get()} onChange={this.handleChangeAutoInstall} />
                    </div>
                </div>
                <If condition={!util.isBlank(this.getErrorStr())}>
                    <div className="settings-field settings-error">Error: {this.getErrorStr()}</div>
                </If>
                <div className="flex-spacer" />
                <div className="action-buttons">
                    <div className="flex-spacer" />
                    <div onClick={model.cancelEditAuth} className="button is-plain is-outlined is-small">
                        Cancel
                    </div>
                    <div
                        style={{ marginLeft: 10, marginRight: 20 }}
                        onClick={this.submitRemote}
                        className="button is-prompt-green is-outlined is-small"
                    >
                        Create Remote
                    </div>
                </div>
            </div>
        );
    }
}

@mobxReact.observer
class EditRemoteSettings extends React.Component<
    { model: RemotesModalModel; remote: RemoteType; remoteEdit: RemoteEditType },
    {}
> {
    tempAlias: OV<string>;
    tempAuthMode: OV<string>;
    tempConnectMode: OV<string>;
    tempManualMode: OV<boolean>;
    tempPassword: OV<string>;
    tempKeyFile: OV<string>;
    tempAutoInstall: OV<boolean>;

    constructor(props: any) {
        super(props);
        let { remote, remoteEdit } = this.props;
        this.tempAlias = mobx.observable.box(remote.remotealias ?? "", { name: "EditRemoteSettings-alias" });
        this.tempAuthMode = mobx.observable.box(remote.authtype, { name: "EditRemoteSettings-authMode" });
        this.tempConnectMode = mobx.observable.box(remote.connectmode, { name: "EditRemoteSettings-connectMode" });
        this.tempKeyFile = mobx.observable.box(remoteEdit.keystr ?? "", { name: "EditRemoteSettings-keystr" });
        this.tempPassword = mobx.observable.box(remoteEdit.haspassword ? PasswordUnchangedSentinel : "", {
            name: "EditRemoteSettings-password",
        });
        this.tempAutoInstall = mobx.observable.box(!!remote.autoinstall, { name: "EditRemoteSettings-autoinstall" });
    }

    componentDidUpdate() {
        let { remote } = this.props;
        if (remote == null || remote.archived) {
            this.props.model.deSelectRemote();
        }
    }

    @boundMethod
    clickArchive(): void {
        let { remote } = this.props;
        if (remote.status == "connected") {
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
            GlobalCommandRunner.archiveRemote(remote.remoteid);
        });
    }

    @boundMethod
    clickForceInstall(): void {
        let { remote } = this.props;
        GlobalCommandRunner.installRemote(remote.remoteid);
    }

    @boundMethod
    handleChangeKeyFile(e: any): void {
        mobx.action(() => {
            this.tempKeyFile.set(e.target.value);
        })();
    }

    @boundMethod
    handleChangePassword(e: any): void {
        mobx.action(() => {
            this.tempPassword.set(e.target.value);
        })();
    }

    @boundMethod
    handleChangeAlias(e: any): void {
        mobx.action(() => {
            this.tempAlias.set(e.target.value);
        })();
    }

    @boundMethod
    handleChangeAutoInstall(val: boolean): void {
        mobx.action(() => {
            this.tempAutoInstall.set(val);
        })();
    }

    @boundMethod
    canResetPw(): boolean {
        let { remoteEdit } = this.props;
        if (remoteEdit == null) {
            return false;
        }
        return remoteEdit.haspassword && this.tempPassword.get() != PasswordUnchangedSentinel;
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
        let { remote, remoteEdit } = this.props;
        let authMode = this.tempAuthMode.get();
        let kwargs: Record<string, string> = {};
        if (!util.isStrEq(this.tempKeyFile.get(), remoteEdit.keystr)) {
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
            if (remoteEdit.haspassword) {
                kwargs["password"] = "";
            }
        }
        if (!util.isStrEq(this.tempAlias.get(), remote.remotealias)) {
            kwargs["alias"] = this.tempAlias.get();
        }
        if (!util.isStrEq(this.tempConnectMode.get(), remote.connectmode)) {
            kwargs["connectmode"] = this.tempConnectMode.get();
        }
        if (!util.isBoolEq(this.tempAutoInstall.get(), remote.autoinstall)) {
            kwargs["autoinstall"] = this.tempAutoInstall.get() ? "1" : "0";
        }
        if (Object.keys(kwargs).length == 0) {
            return;
        }
        kwargs["visual"] = "1";
        kwargs["submit"] = "1";
        GlobalCommandRunner.editRemote(remote.remoteid, kwargs);
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
        let { model, remote, remoteEdit } = this.props;
        let authMode = this.tempAuthMode.get();
        return (
            <div className="remote-detail auth-editing">
                <div className="title is-5">{getRemoteTitle(remote)}</div>
                <div className="detail-subtitle">Editing Connection Settings</div>
                <div className="settings-field">
                    <div className="settings-label">
                        <div>Alias</div>
                        <div className="flex-spacer" />
                        <InfoMessage width={400}>
                            (Optional) A short alias to use when selecting or displaying this connection.
                        </InfoMessage>
                    </div>
                    <div className="settings-input">
                        <input
                            type="text"
                            onChange={this.handleChangeAlias}
                            value={this.tempAlias.get()}
                            maxLength={40}
                        />
                    </div>
                </div>
                <div className="settings-field align-top">
                    <div className="settings-label">
                        <div>Auth Mode</div>
                        <div className="flex-spacer" />
                        <InfoMessage width={350}>
                            <ul>
                                <li>
                                    <b>none</b> - no authentication, or authentication is already configured in your ssh
                                    config.
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
                        </InfoMessage>
                    </div>
                    <div className="settings-input">
                        <div className="raw-input">
                            <AuthModeDropdown tempVal={this.tempAuthMode} />
                        </div>
                    </div>
                </div>
                <If condition={authMode == "key" || authMode == "key+password"}>
                    <div className="settings-field" style={{ marginTop: 10 }}>
                        <div className="settings-label">SSH Keyfile</div>
                        <div className="settings-input">
                            <input
                                type="text"
                                placeholder="keyfile"
                                onChange={this.handleChangeKeyFile}
                                value={this.tempKeyFile.get()}
                                maxLength={400}
                            />
                        </div>
                    </div>
                </If>
                <If condition={authMode == "password" || authMode == "key+password"}>
                    <div className="settings-field" style={{ marginTop: 10 }}>
                        <div className="settings-label">
                            {authMode == "password" ? "SSH Password" : "Key Passphrase"}
                        </div>
                        <div className="settings-input">
                            <input
                                type="password"
                                placeholder="password"
                                onFocus={this.onFocusPassword}
                                onChange={this.handleChangePassword}
                                value={this.tempPassword.get()}
                                maxLength={400}
                            />
                            <If condition={this.canResetPw()}>
                                <div className="undo-icon" title="restore to original password">
                                    <i onClick={this.resetPw} className="icon fa-sharp fa-solid fa-rotate-left" />
                                </div>
                            </If>
                        </div>
                    </div>
                </If>
                <div className="settings-field align-top" style={{ marginTop: 10 }}>
                    <div className="settings-label">
                        <div>Connect Mode</div>
                        <div className="flex-spacer" />
                        <InfoMessage width={350}>
                            <ul>
                                <li>
                                    <b>startup</b> - connect when [prompt] starts.
                                </li>
                                <li>
                                    <b>auto</b> - connect when you first run a command using this connection.
                                </li>
                                <li>
                                    <b>manual</b> - connect manually. Note, if your connection requires manual input,
                                    like an OPT code, you must use this setting.
                                </li>
                            </ul>
                        </InfoMessage>
                    </div>
                    <div className="settings-input">
                        <div className="raw-input">
                            <div className="raw-input">
                                <ConnectModeDropdown tempVal={this.tempConnectMode} />
                            </div>
                        </div>
                    </div>
                </div>
                <div className="settings-field" style={{ marginTop: 10 }}>
                    <div className="settings-label">
                        <div>Auto Install</div>
                        <div className="flex-spacer" />
                        <InfoMessage width={350}>
                            If selected, will try to auto-install the mshell client if it is not installed or out of
                            date.
                        </InfoMessage>
                    </div>
                    <div className="settings-input">
                        <Toggle checked={this.tempAutoInstall.get()} onChange={this.handleChangeAutoInstall} />
                    </div>
                </div>
                <div className="settings-field mt-3">
                    <div className="settings-label">Actions</div>
                    <div className="settings-input">
                        <div
                            onClick={this.clickArchive}
                            className="button is-prompt-danger is-outlined is-small is-inline-height"
                        >
                            Archive Connection
                        </div>
                        <div
                            onClick={this.clickForceInstall}
                            className="button is-prompt-danger is-outlined is-small is-inline-height ml-3"
                        >
                            Force Install
                        </div>
                    </div>
                </div>
                <If condition={!util.isBlank(remoteEdit.errorstr)}>
                    <div className="remoteedit-error">Error: {remoteEdit.errorstr ?? "An error occured"}</div>
                </If>
                <div className="flex-spacer" />
                <div className="action-buttons">
                    <div className="flex-spacer" />
                    <div onClick={model.cancelEditAuth} className="button is-plain is-outlined is-small">
                        Cancel
                    </div>
                    <div
                        style={{ marginLeft: 10, marginRight: 20 }}
                        onClick={this.submitRemote}
                        className="button is-prompt-green is-outlined is-small"
                    >
                        Submit
                    </div>
                </div>
            </div>
        );
    }
}

@mobxReact.observer
class RemoteDetailView extends React.Component<{ model: RemotesModalModel; remote: RemoteType }, {}> {
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

    getRemoteTypeStr(remote: RemoteType): string {
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

    renderInstallStatus(remote: RemoteType): any {
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
        if (remote.autoinstall) {
            statusStr = statusStr + " (autoinstall)";
        }
        return (
            <div key="install-status" className="settings-field">
                <div className="settings-label"> Install Status</div>
                <div className="settings-input">{statusStr}</div>
            </div>
        );
    }

    renderRemoteMessage(remote: RemoteType): any {
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
            <div className="remote-detail">
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
                <div style={{ width: termWidth }}>{remoteMessage}</div>
                <div
                    key="term"
                    className={cn(
                        "terminal-wrapper",
                        { focus: isTermFocused },
                        remote != null ? "status-" + remote.status : null,
                        { "has-message": remoteMessage != null }
                    )}
                    style={{ width: termWidth }}
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
                        style={{ height: textmeasure.termHeightFromRows(RemotePtyRows, termFontSize) }}
                    ></div>
                </div>
            </div>
        );
    }
}

@mobxReact.observer
class RemotesModal extends React.Component<{ model: RemotesModalModel }, {}> {
    @boundMethod
    closeModal(): void {
        this.props.model.closeModal();
    }

    @boundMethod
    selectRemote(remoteId: string): void {
        let model = this.props.model;
        model.selectRemote(remoteId);
    }

    @boundMethod
    clickAddRemote(): void {
        GlobalCommandRunner.openCreateRemote();
    }

    renderRemoteMenuItem(remote: RemoteType, selectedId: string): any {
        return (
            <div
                key={remote.remoteid}
                onClick={() => this.selectRemote(remote.remoteid)}
                className={cn("remote-menu-item", { "is-selected": remote.remoteid == selectedId })}
            >
                <div className="remote-status-light">
                    <RemoteStatusLight remote={remote} />
                </div>
                <If condition={util.isBlank(remote.remotealias)}>
                    <div className="remote-name">
                        <div className="remote-name-primary">{remote.remotecanonicalname}</div>
                    </div>
                </If>
                <If condition={!util.isBlank(remote.remotealias)}>
                    <div className="remote-name">
                        <div className="remote-name-primary">{remote.remotealias}</div>
                        <div className="remote-name-secondary">{remote.remotecanonicalname}</div>
                    </div>
                </If>
            </div>
        );
    }

    renderAddRemoteMenuItem(): any {
        return (
            <div key="add" onClick={this.clickAddRemote} className={cn("remote-menu-item add-remote")}>
                <div>
                    <i className="fa-sharp fa-solid fa-plus" /> Add SSH Connection
                </div>
            </div>
        );
    }

    renderEmptyDetail(): any {
        return (
            <div className="remote-detail flex-centered-row">
                <div>No Connection Selected</div>
            </div>
        );
    }

    render() {
        let model = this.props.model;
        let selectedRemoteId = model.selectedRemoteId.get();
        let allRemotes = util.sortAndFilterRemotes(GlobalModel.remotes.slice());
        let remote: RemoteType = null;
        let isAuthEditMode = model.isAuthEditMode();
        let selectedRemote = GlobalModel.getRemote(selectedRemoteId);
        let remoteEdit = model.remoteEdit.get();
        return (
            <div className={cn("modal remotes-modal settings-modal prompt-modal is-active")}>
                <div className="modal-background" />
                <div className="modal-content">
                    <header>
                        <div className="modal-title">Connections</div>
                        <div className="close-icon">
                            <i
                                title="Close (Escape)"
                                onClick={this.closeModal}
                                className="fa-sharp fa-solid fa-times"
                            />
                        </div>
                    </header>
                    <div className="inner-content">
                        <div className="remotes-menu">
                            {this.renderAddRemoteMenuItem()}
                            <For each="remote" of={allRemotes}>
                                {this.renderRemoteMenuItem(remote, selectedRemoteId)}
                            </For>
                        </div>
                        <If condition={selectedRemote == null}>
                            <If condition={remoteEdit != null}>
                                <CreateRemote model={model} remoteEdit={remoteEdit} />
                            </If>
                            <If condition={remoteEdit == null}>{this.renderEmptyDetail()}</If>
                        </If>
                        <If condition={selectedRemote != null}>
                            <If condition={!isAuthEditMode}>
                                <RemoteDetailView
                                    key={"remotedetail-" + selectedRemoteId}
                                    remote={selectedRemote}
                                    model={model}
                                />
                            </If>
                            <If condition={isAuthEditMode}>
                                <EditRemoteSettings
                                    key={"editremote-" + selectedRemoteId}
                                    remote={selectedRemote}
                                    remoteEdit={remoteEdit}
                                    model={model}
                                />
                            </If>
                        </If>
                    </div>
                </div>
            </div>
        );
    }
}

export { RemotesModal };
