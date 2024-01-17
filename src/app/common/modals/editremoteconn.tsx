// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { If } from "tsx-control-statements/components";
import { boundMethod } from "autobind-decorator";
import { GlobalModel, GlobalCommandRunner, RemotesModel } from "../../../model/model";
import * as T from "../../../types/types";
import { Modal, TextField, InputDecoration, Dropdown, PasswordField, Tooltip } from "../common";
import * as util from "../../../util/util";

import "./editremoteconn.less";

type OV<V> = mobx.IObservableValue<V>;

const PasswordUnchangedSentinel = "--unchanged--";

@mobxReact.observer
class EditRemoteConnModal extends React.Component<{}, {}> {
    tempAlias: OV<string>;
    tempKeyFile: OV<string>;
    tempPassword: OV<string>;
    tempConnectMode: OV<string>;
    tempAuthMode: OV<string>;
    tempShellPref: OV<string>;
    model: RemotesModel;

    constructor(props: { remotesModel?: RemotesModel }) {
        super(props);
        this.model = GlobalModel.remotesModel;
        this.tempAlias = mobx.observable.box(null, { name: "EditRemoteSettings-tempAlias" });
        this.tempAuthMode = mobx.observable.box(null, { name: "EditRemoteSettings-tempAuthMode" });
        this.tempKeyFile = mobx.observable.box(null, { name: "EditRemoteSettings-tempKeyFile" });
        this.tempPassword = mobx.observable.box(null, { name: "EditRemoteSettings-tempPassword" });
        this.tempConnectMode = mobx.observable.box(null, { name: "EditRemoteSettings-tempConnectMode" });
        this.tempShellPref = mobx.observable.box(null, { name: "EditRemoteSettings-tempShellPref" });
    }

    get selectedRemoteId() {
        return this.model.selectedRemoteId.get();
    }

    get selectedRemote(): T.RemoteType {
        return GlobalModel.getRemote(this.selectedRemoteId);
    }

    get remoteEdit(): T.RemoteEditType {
        return this.model.remoteEdit.get();
    }

    get isAuthEditMode(): boolean {
        return this.model.isAuthEditMode();
    }

    isLocalRemote(): boolean {
        return this.selectedRemote?.local;
    }

    componentDidMount(): void {
        mobx.action(() => {
            this.tempAlias.set(this.selectedRemote?.remotealias);
            this.tempKeyFile.set(this.remoteEdit?.keystr);
            this.tempPassword.set(this.remoteEdit?.haspassword ? PasswordUnchangedSentinel : "");
            this.tempConnectMode.set(this.selectedRemote?.connectmode);
            this.tempAuthMode.set(this.selectedRemote?.authtype);
            this.tempShellPref.set(this.selectedRemote?.shellpref);
        })();
    }

    componentDidUpdate() {
        if (this.selectedRemote == null || this.selectedRemote.archived) {
            this.model.deSelectRemote();
        }
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
    handleChangeConnectMode(value: string): void {
        mobx.action(() => {
            this.tempConnectMode.set(value);
        })();
    }

    @boundMethod
    handleChangeShellPref(value: string): void {
        mobx.action(() => {
            this.tempShellPref.set(value);
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
        if (authMode == "key" || authMode == "key+password") {
            let keyStrEq = util.isStrEq(this.tempKeyFile.get(), this.remoteEdit?.keystr);
            if (!keyStrEq) {
                kwargs["key"] = this.tempKeyFile.get();
            }
        } else {
            if (!util.isBlank(this.tempKeyFile.get())) {
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
        if (!util.isStrEq(this.tempAlias.get(), this.selectedRemote?.remotealias)) {
            kwargs["alias"] = this.tempAlias.get();
        }
        if (!util.isStrEq(this.tempConnectMode.get(), this.selectedRemote?.connectmode)) {
            kwargs["connectmode"] = this.tempConnectMode.get();
        }
        if (!util.isStrEq(this.tempShellPref.get(), this.selectedRemote?.shellpref)) {
            kwargs["shellpref"] = this.tempShellPref.get();
        }
        kwargs["visual"] = "1";
        kwargs["submit"] = "1";
        GlobalCommandRunner.editRemote(this.selectedRemote?.remoteid, kwargs);
        this.model.closeModal();
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

    renderAlias() {
        return (
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
        );
    }

    renderConnectMode() {
        return (
            <div className="connectmode-section">
                <Dropdown
                    label="Connect Mode"
                    options={[
                        { value: "startup", label: "startup" },
                        { value: "auto", label: "auto" },
                        { value: "manual", label: "manual" },
                    ]}
                    value={this.tempConnectMode.get()}
                    onChange={this.handleChangeConnectMode}
                />
            </div>
        );
    }

    renderShellPref() {
        return (
            <div className="shellpref-section">
                <Dropdown
                    label="Shell Preference"
                    options={[
                        { value: "detect", label: "detect" },
                        { value: "bash", label: "bash" },
                        { value: "zsh", label: "zsh" },
                    ]}
                    value={this.tempShellPref.get()}
                    onChange={this.handleChangeShellPref}
                />
            </div>
        );
    }

    renderAuthMode() {
        let authMode = this.tempAuthMode.get();
        return (
            <>
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
                        onChange={this.handleChangeAuthMode}
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
            </>
        );
    }

    render() {
        if (this.remoteEdit === null || !this.isAuthEditMode) {
            return null;
        }
        let isLocal = this.isLocalRemote();
        return (
            <Modal className="erconn-modal">
                <Modal.Header title="Edit Connection" onClose={this.model.closeModal} />
                <div className="wave-modal-body">
                    <div className="name-actions-section">
                        <div className="name text-primary">{util.getRemoteName(this.selectedRemote)}</div>
                    </div>
                    <If condition={!isLocal}>{this.renderAlias()}</If>
                    <If condition={!isLocal}>{this.renderAuthMode()}</If>
                    <If condition={!isLocal}>{this.renderConnectMode()}</If>
                    {this.renderShellPref()}
                    <If condition={!util.isBlank(this.remoteEdit?.errorstr)}>
                        <div className="settings-field settings-error">Error: {this.remoteEdit?.errorstr}</div>
                    </If>
                </div>
                <Modal.Footer onOk={this.submitRemote} onCancel={this.model.closeModal} okLabel="Save" />
            </Modal>
        );
    }
}

export { EditRemoteConnModal };
