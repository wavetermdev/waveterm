// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { boundMethod } from "autobind-decorator";
import { If } from "tsx-control-statements/components";
import { GlobalModel, GlobalCommandRunner, RemotesModel } from "../../../models";
import {
    Modal,
    TextField,
    NumberField,
    InputDecoration,
    Dropdown,
    PasswordField,
    Tooltip,
    ShowWaveShellInstallPrompt,
} from "../elements";
import * as util from "../../../util/util";

import "./createremoteconn.less";

@mobxReact.observer
class CreateRemoteConnModal extends React.Component<{}, {}> {
    tempAlias: OV<string>;
    tempHostName: OV<string>;
    tempPort: OV<string>;
    tempAuthMode: OV<string>;
    tempConnectMode: OV<string>;
    tempPassword: OV<string>;
    tempKeyFile: OV<string>;
    tempShellPref: OV<string>;
    errorStr: OV<string>;
    remoteEdit: RemoteEditType;
    model: RemotesModel;

    constructor(props: { remotesModel?: RemotesModel }) {
        super(props);
        this.model = GlobalModel.remotesModel;
        this.remoteEdit = this.model.remoteEdit.get();
        this.tempAlias = mobx.observable.box("", { name: "CreateRemote-alias" });
        this.tempHostName = mobx.observable.box("", { name: "CreateRemote-hostName" });
        this.tempPort = mobx.observable.box("", { name: "CreateRemote-port" });
        this.tempAuthMode = mobx.observable.box("none", { name: "CreateRemote-authMode" });
        this.tempConnectMode = mobx.observable.box("auto", { name: "CreateRemote-connectMode" });
        this.tempKeyFile = mobx.observable.box("", { name: "CreateRemote-keystr" });
        this.tempPassword = mobx.observable.box("", { name: "CreateRemote-password" });
        this.tempShellPref = mobx.observable.box("detect", { name: "CreateRemote-shellPref" });
        this.errorStr = mobx.observable.box(this.remoteEdit?.errorstr ?? null, { name: "CreateRemote-errorStr" });
    }

    componentDidMount(): void {
        GlobalModel.getClientData();
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
        return this.remoteEdit?.errorstr ?? null;
    }

    @boundMethod
    handleOk(): void {
        ShowWaveShellInstallPrompt(this.submitRemote);
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
        kwargs["shellpref"] = this.tempShellPref.get();
        kwargs["visual"] = "1";
        kwargs["submit"] = "1";
        let prtn = GlobalCommandRunner.createRemote(cname, kwargs, false);
        prtn.then((crtn) => {
            if (crtn.success) {
                this.model.setRecentConnAdded(true);
                this.model.closeModal();

                let crRtn = GlobalCommandRunner.screenSetRemote(cname, true, false);
                crRtn.then((crcrtn) => {
                    if (crcrtn.success) {
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
    handleChangeAuthMode(value: string): void {
        mobx.action(() => {
            this.tempAuthMode.set(value);
        })();
    }

    @boundMethod
    handleChangeShellPref(value: string): void {
        mobx.action(() => {
            this.tempShellPref.set(value);
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
            <Modal className="crconn-modal">
                <Modal.Header title="Add Connection" onClose={this.model.closeModal} />
                <div className="wave-modal-body">
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
                                { value: "auto", label: "auto" },
                                { value: "manual", label: "manual" },
                            ]}
                            value={this.tempConnectMode.get()}
                            onChange={(val: string) => {
                                this.tempConnectMode.set(val);
                            }}
                        />
                    </div>
                    <div className="shellpref-section">
                        <Dropdown
                            label="Shell Preference"
                            options={[
                                { value: "detect", label: "detect" },
                                { value: "bash", label: "bash" },
                                { value: "zsh", label: "zsh" },
                            ]}
                            value={this.tempShellPref.get()}
                            onChange={(val: string) => {
                                this.tempShellPref.set(val);
                            }}
                        />
                    </div>
                    <If condition={!util.isBlank(this.getErrorStr() as string)}>
                        <div className="settings-field settings-error">Error: {this.getErrorStr()}</div>
                    </If>
                </div>
                <Modal.Footer onCancel={this.model.closeModal} onOk={this.handleOk} okLabel="Connect" />
            </Modal>
        );
    }
}

export { CreateRemoteConnModal };
