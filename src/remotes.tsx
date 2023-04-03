import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import {sprintf} from "sprintf-js";
import {boundMethod} from "autobind-decorator";
import {If, For, When, Otherwise, Choose} from "tsx-control-statements/components";
import cn from "classnames";
import {GlobalModel, GlobalCommandRunner, getTermPtyData, RemotesModalModel} from "./model";
import {Toggle, RemoteStatusLight, InlineSettingsTextEdit} from "./elements";
import {RemoteType, RemoteInputPacketType} from "./types";
import * as util from "./util";
import * as textmeasure from "./textmeasure";
import {TermWrap} from "./term";

type OV<V> = mobx.IObservableValue<V>;
type OArr<V> = mobx.IObservableArray<V>;
type OMap<K,V> = mobx.ObservableMap<K,V>;

const RemotePtyRows = 8;
const RemotePtyCols = 80;

function getRemoteCNWithPort(remote : RemoteType) {
    if (util.isBlank(remote.remotevars.port) || remote.remotevars.port == "22") {
        return remote.remotecanonicalname;
    }
    return remote.remotecanonicalname + ":" + remote.remotevars.port;
}

function getRemoteTitle(remote : RemoteType) {
    if (!util.isBlank(remote.remotealias)) {
        return remote.remotealias + " (" + remote.remotecanonicalname + ")";
    }
    return remote.remotecanonicalname;
}

@mobxReact.observer
class RemoteDetailView extends React.Component<{remoteId : string, model : RemotesModalModel}, {}> {
    termRef : React.RefObject<any> = React.createRef();

    componentDidMount() {
        let elem = this.termRef.current;
        if (elem == null) {
            console.log("ERROR null term-remote element");
            return;
        }
        this.props.model.createTermWrap(elem);
    }

    componentWillUnmount() {
        this.props.model.disposeTerm();
    }

    @boundMethod
    clickTermBlock() : void {
        if (this.props.model.remoteTermWrap != null) {
            this.props.model.remoteTermWrap.giveFocus();
        }
    }

    getRemoteTypeStr(remote : RemoteType) : string {
        if (!util.isBlank(remote.uname)) {
            let unameStr = remote.uname;
            unameStr = unameStr.replace("|", ", ");
            return remote.remotetype + " (" + unameStr + ")";
        }
        return remote.remotetype;
    }

    @boundMethod
    connectRemote(remoteId : string) {
        GlobalCommandRunner.connectRemote(remoteId);
    }

    @boundMethod
    disconnectRemote(remoteId : string) {
        GlobalCommandRunner.disconnectRemote(remoteId);
    }

    @boundMethod
    installRemote(remoteId : string) {
        GlobalCommandRunner.installRemote(remoteId);
    }

    @boundMethod
    cancelInstall(remoteId : string) {
        GlobalCommandRunner.installCancelRemote(remoteId);
    }

    @boundMethod
    editAuthSettings() : void {
        this.props.model.startEditAuth();
    }

    @boundMethod
    clickArchive(remoteId : string) : void {
        let prtn = GlobalModel.showAlert({message: "Are you sure you want to archive this connection?", confirm: true});
        prtn.then((confirm) => {
            if (!confirm) {
                return;
            }
            console.log("archive remote", remoteId);
        });
    }

    @boundMethod
    editAlias(remoteId : string, alias : string) : void {
    }

    renderInstallStatus(remote : RemoteType) : any {
        let statusStr : string = null;
        if (remote.installstatus == "disconnected") {
            if (remote.needsmshellupgrade) {
                statusStr = "mshell " + remote.mshellversion + " (needs upgrade)";
            }
            else if (util.isBlank(remote.mshellversion)) {
                statusStr = "mshell unknown";
            }
            else {
                statusStr = "mshell " + remote.mshellversion + " (current)";
            }
        }
        else {
            statusStr = remote.installstatus;
        }
        if (statusStr == null) {
            return null;
        }
        return (
            <div key="install-status" className="settings-field">
                <div className="settings-label"> Install Status</div>
                <div className="settings-input">
                    {statusStr}
                </div>
            </div>
        );
    }

    renderRemoteMessage(remote : RemoteType) : any {
        let message : string = "";
        let buttons : any[] = [];
        // connect, disconnect, editauth, tryreconnect, install

        let disconnectButton = (
            <div key="disconnect" style={{marginLeft: 10}} onClick={() => this.disconnectRemote(remote.remoteid)} className="button is-prompt-danger is-outlined is-small">Disconnect Now</div>
        );
        let connectButton = (
            <div key="connect" style={{marginLeft: 10}} onClick={() => this.connectRemote(remote.remoteid)} className="button is-prompt-green is-outlined is-small">Connect Now</div>
        );
        let tryReconnectButton = (
            <div style={{marginLeft: 10}} onClick={() => this.connectRemote(remote.remoteid)} className="button is-prompt-green is-outlined is-small">Try Reconnect</div>
        );
        let updateAuthButton = (
            <div style={{marginLeft: 10}} onClick={() => this.editAuthSettings()} className="button is-plain is-outlined is-small">Update Auth Settings</div>
        );
        let cancelInstallButton = (
            <div style={{marginLeft: 10}} onClick={() => this.cancelInstall(remote.remoteid)} className="button is-prompt-danger is-outlined is-small">Cancel Install</div>
        );
        let installNowButton = (
            <div style={{marginLeft: 10}} onClick={() => this.installRemote(remote.remoteid)} className="button is-prompt-green is-outlined is-small">Install Now</div>
        );
        
        if (remote.status == "connected") {
            message = "Connected and ready to run commands.";
            buttons = [disconnectButton];
        }
        else if (remote.status == "connecting") {
            message = (remote.waitingforpassword ? "Connecting, waiting for user-input..." : "Connecting...");
            buttons = [disconnectButton];
        }
        else if (remote.status == "disconnected") {
            message = "Disconnected";
            buttons = [connectButton];
        }
        else if (remote.status == "error") {
            if (remote.noinitpk) {
                message = "Error, could not connect.";
                buttons = [tryReconnectButton, updateAuthButton];
            }
            else if (remote.needsmshellupgrade) {
                if (remote.installstatus == "connecting") {
                    message = "Installing...";
                    buttons = [cancelInstallButton];
                }
                else {
                    message = "Error, needs install.";
                    buttons = [installNowButton, updateAuthButton];
                }
            }
            else {
                message = "Error";
                buttons = [tryReconnectButton, updateAuthButton];
            }
        }
        let button : any = null;
        return (
            <div className="remote-message">
                <div className="message-row">
                    <div><RemoteStatusLight remote={remote}/> {message}</div>
                    <div className="flex-spacer"/>
                    <For each="button" of={buttons}>
                        {button}
                    </For>
                </div>
            </div>
        );
    }
    
    render() {
        let remoteId = this.props.remoteId;
        let remote = GlobalModel.getRemote(remoteId);
        if (remote == null) {
            return (
                <div className="remote-detail flex-centered-row">
                    <div>
                        No Remote Selected
                    </div>
                </div>
            );
        }
        let isTermFocused = this.props.model.remoteTermWrapFocus.get();
        let termFontSize = GlobalModel.termFontSize.get();
        let remoteMessage = this.renderRemoteMessage(remote);
        let termWidth = textmeasure.termWidthFromCols(RemotePtyCols, termFontSize);
        let remoteAliasText = (util.isBlank(remote.remotealias) ? "(none)" : remote.remotealias);
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
                            <span style={{marginLeft: 5}}>(port {remote.remotevars.port})</span>
                        </If>
                    </div>
                </div>
                <div className="settings-field" style={{minHeight: 24}}>
                    <div className="settings-label">Alias</div>
                    <InlineSettingsTextEdit onChange={(val) => this.editAlias(remote.remoteid, val)} text={remoteAliasText ?? ""} value={remote.remotealias} placeholder="" maxLength={50}/>
                </div>
                <div className="settings-field">
                    <div className="settings-label">Auth Type</div>
                    <div className="settings-input">
                        {remote.authtype} <i style={{marginLeft: 12}} className="fa-sharp fa-solid fa-pen hide-hover"/>
                        <div onClick={() => this.editAuthSettings()} className="button is-plain is-outlined is-small is-inline-height ml-2 update-auth-button">
                            <span className="icon is-small"><i className="fa-sharp fa-solid fa-pen"/></span>
                            <span>Update Auth Settings</span>
                        </div>
                    </div>
                </div>
                <div className="settings-field">
                    <div className="settings-label">Connect Mode</div>
                    <div className="settings-input">
                        {remote.connectmode}
                    </div>
                </div>
                {this.renderInstallStatus(remote)}
                <div className="settings-field">
                    <div className="settings-label">Archive</div>
                    <div className="settings-input">
                        <div onClick={() => this.clickArchive(remote.remoteid)} className="button is-prompt-danger is-outlined is-small is-inline-height">
                            Archive This Connection
                        </div>
                    </div>
                </div>
                <div className="flex-spacer" style={{minHeight: 20}}/>
                <div style={{width: termWidth}}>
                    {remoteMessage}
                </div>
                <div key="term" className={cn("terminal-wrapper", {"focus": isTermFocused}, (remote != null ? "status-" + remote.status : null), {"has-message": remoteMessage != null})} style={{display: (remoteId == null ? "none" : "block"), width: termWidth}}>
                    <If condition={!isTermFocused}>
                        <div key="termblock" className="term-block" onClick={this.clickTermBlock}></div>
                    </If>
                    <If condition={this.props.model.showNoInputMsg.get()}>
                        <div key="termtag" className="term-tag">input is only allowed while status is 'connecting'</div>
                    </If>
                    <div key="terminal" className="terminal-connectelem" ref={this.termRef} data-remoteid={remoteId} style={{height: textmeasure.termHeightFromRows(RemotePtyRows, termFontSize)}}></div>
                </div>
            </div>
        );
    }
}

@mobxReact.observer
class RemotesModal extends React.Component<{model : RemotesModalModel}, {}> {
    @boundMethod
    closeModal() : void {
        this.props.model.closeModal();
    }

    @boundMethod
    selectRemote(remoteId : string) : void {
        let model = this.props.model;
        model.selectRemote(remoteId);
    }

    @boundMethod
    clickAddRemote() : void {
    }

    @boundMethod
    cancelEditAuth() : void {
        this.props.model.cancelEditAuth();
    }

    @boundMethod
    editAuthSettings() : void {
        this.props.model.startEditAuth();
    }

    renderRemoteMenuItem(remote : RemoteType, selectedId : string) : any {
        return (
            <div key={remote.remoteid} onClick={() => this.selectRemote(remote.remoteid) } className={cn("remote-menu-item", {"is-selected" : remote.remoteid == selectedId})}>
                <div className="remote-status-light"><RemoteStatusLight remote={remote}/></div>
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

    renderAddRemoteMenuItem() : any {
        return (
            <div key="add" onClick={this.clickAddRemote} className={cn("remote-menu-item add-remote")}>
                <div>
                    <i className="fa-sharp fa-solid fa-plus"/> Add Connection
                </div>
            </div>
        );
    }

    renderEditAuthSettings(remoteId : string) : any {
        let remote = GlobalModel.getRemote(remoteId);
        if (remote == null) {
            return (
                <div className="remote-detail flex-centered-row">
                    <div>
                        No Remote Selected
                    </div>
                </div>
            );
        }
        return (
            <div className="remote-detail">
                <div className="title is-5">{getRemoteTitle(remote)}</div>
                <div>
                    Editing Authentication Settings
                </div>
                <div>
                    <div onClick={this.cancelEditAuth} className="button is-plain is-outlined is-small">Cancel</div>
                    <div style={{marginLeft: 10}} onClick={null} className="button is-prompt-green is-outlined is-small">Submit</div>
                </div>
            </div>
        );
    }
    
    render() {
        let model = this.props.model;
        let selectedRemoteId = model.selectedRemoteId.get();
        let allRemotes = util.sortAndFilterRemotes(GlobalModel.remotes.slice());
        let remote : RemoteType = null;
        let isAuthEditMode = model.authEditMode.get();
        return (
            <div className={cn("modal remotes-modal settings-modal prompt-modal is-active")}>
                <div className="modal-background"/>
                <div className="modal-content">
                    <header>
                        <div className="modal-title">Connections</div>
                        <div className="close-icon">
                            <i onClick={this.closeModal} className="fa-sharp fa-solid fa-times"/>
                        </div>
                    </header>
                    <div className="inner-content">
                        <div className="remotes-menu">
                            {this.renderAddRemoteMenuItem()}
                            <For each="remote" of={allRemotes}>
                                {this.renderRemoteMenuItem(remote, selectedRemoteId)}
                            </For>
                        </div>
                        <If condition={!isAuthEditMode}>
                            <RemoteDetailView key={"remotedetail-" + selectedRemoteId} remoteId={selectedRemoteId} model={model}/>
                        </If>
                        <If condition={isAuthEditMode}>
                            {this.renderEditAuthSettings(selectedRemoteId)}
                        </If>
                    </div>
                    <footer>
                        <div onClick={this.closeModal} className="button is-plain is-outlined is-small">Close</div>
                    </footer>
                </div>
            </div>
        );
    }
}

export {RemotesModal};
