// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { boundMethod } from "autobind-decorator";
import { If, For } from "tsx-control-statements/components";
import cn from "classnames";
import { GlobalModel, GlobalCommandRunner, RemotesModel } from "../../../model/model";
import * as T from "../../../types/types";
import { Modal, Tooltip, Button, Status } from "../common";
import * as util from "../../../util/util";
import * as textmeasure from "../../../util/textmeasure";

import "./viewremoteconn.less";

const RemotePtyRows = 9;
const RemotePtyCols = 80;

@mobxReact.observer
class ViewRemoteConnDetailModal extends React.Component<{}, {}> {
    termRef: React.RefObject<any> = React.createRef();
    model: RemotesModel;

    constructor(props: { remotesModel?: RemotesModel }) {
        super(props);
        this.model = GlobalModel.remotesModel;
    }

    @mobx.computed
    get selectedRemote(): T.RemoteType {
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
        GlobalModel.remotesModel.startEditAuth();
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
            GlobalModel.showAlert({ message: "Cannot delete when connected.  Disconnect and try again." });
            return;
        }
        let prtn = GlobalModel.showAlert({
            message: "Are you sure you want to delete this connection?",
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
    clickReinstall(): void {
        GlobalCommandRunner.installRemote(this.selectedRemote?.remoteid);
    }

    @boundMethod
    handleClose(): void {
        this.model.closeModal();
        this.model.seRecentConnAdded(false);
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

    renderHeaderBtns(remote: T.RemoteType): React.ReactNode {
        let buttons: React.ReactNode[] = [];
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
        let archiveButton = (
            <Button theme="secondary" onClick={() => this.clickArchive()}>
                Delete
            </Button>
        );
        const reinstallButton = (
            <Button theme="secondary" onClick={this.clickReinstall}>
                Reinstall
            </Button>
        );
        if (remote.local) {
            installNowButton = <></>;
            updateAuthButton = <></>;
            cancelInstallButton = <></>;
        }
        if (remote.sshconfigsrc == "sshconfig-import") {
            updateAuthButton = (
                <Button theme="secondary" disabled={true}>
                    Edit
                    <Tooltip
                        message={`Remotes imported from an ssh config file cannot be edited inside waveterm. To edit these, you must edit the config file and import it again.`}
                        icon={<i className="fa-sharp fa-regular fa-fw fa-ban" />}
                    >
                        <i className="fa-sharp fa-regular fa-fw fa-ban" />
                    </Tooltip>
                </Button>
            );
            archiveButton = (
                <Button theme="secondary" onClick={() => this.clickArchive()}>
                    Delete
                    <Tooltip
                        message={
                            <span>
                                Remotes imported from an ssh config file can be deleted, but will come back upon
                                importing again. They will stay removed if you follow{" "}
                                <a href="https://docs.waveterm.dev/features/sshconfig-imports">this procedure</a>.
                            </span>
                        }
                        icon={<i className="fa-sharp fa-regular fa-fw fa-triangle-exclamation" />}
                    >
                        <i className="fa-sharp fa-regular fa-fw fa-triangle-exclamation" />
                    </Tooltip>
                </Button>
            );
        }
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
        buttons.push(reinstallButton);
        buttons.push(updateAuthButton);
        buttons.push(archiveButton);

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
            <Modal className="rconndetail-modal">
                <Modal.Header title="Connection" onClose={this.model.closeModal} />
                <div className="wave-modal-body">
                    <div className="name-header-actions-wrapper">
                        <div className="name text-primary name-wrapper">
                            {util.getRemoteName(remote)}&nbsp; {getImportTooltip(remote)}
                        </div>
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
                </div>
                <Modal.Footer onOk={this.model.closeModal} onCancel={this.model.closeModal} okLabel="Done" />
            </Modal>
        );
    }
}

function getImportTooltip(remote: T.RemoteType): React.ReactElement<any, any> {
    if (remote.sshconfigsrc == "sshconfig-import") {
        return (
            <Tooltip
                message={`This remote was imported from an SSH config file.`}
                icon={<i className="fa-sharp fa-solid fa-file-import" />}
            >
                <i className="fa-sharp fa-solid fa-file-import" />
            </Tooltip>
        );
    } else {
        return <></>;
    }
}

export { ViewRemoteConnDetailModal };
