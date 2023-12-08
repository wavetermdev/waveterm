// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { boundMethod } from "autobind-decorator";
import { If, For } from "tsx-control-statements/components";
import cn from "classnames";
import {
    GlobalModel,
    GlobalCommandRunner,
    TabColors,
    MinFontSize,
    MaxFontSize,
    TabIcons,
    Screen,
    Session,
} from "../../../model/model";
import { Toggle, InlineSettingsTextEdit, SettingsError, InfoMessage, Modal, Dropdown, Tooltip } from "../common";
import { LineType, RendererPluginType, ClientDataType, CommandRtnType, RemoteType } from "../../../types/types";
import { PluginModel } from "../../../plugins/plugins";
import * as util from "../../../util/util";
import { commandRtnHandler } from "../../../util/util";
import { ReactComponent as SquareIcon } from "../../assets/icons/tab/square.svg";
import { ReactComponent as AngleDownIcon } from "../../assets/icons/history/angle-down.svg";
import { ReactComponent as GlobeIcon } from "../../assets/icons/globe.svg";
import { ReactComponent as StatusCircleIcon } from "../../assets/icons/statuscircle.svg";

import "./modals.less";

type OV<V> = mobx.IObservableValue<V>;

// @ts-ignore
const VERSION = __WAVETERM_VERSION__;
// @ts-ignore
const BUILD = __WAVETERM_BUILD__;

const ScreenDeleteMessage = `
Are you sure you want to delete this tab?

All commands and output will be deleted, and removed from history.  To hide the tab, and retain the commands in history, use 'archive'.
`.trim();

const SessionDeleteMessage = `
Are you sure you want to delete this workspace?

All commands and output will be deleted, and removed from history.  To hide the workspace, and retain the commands in history, use 'archive'.
`.trim();

const WebShareConfirmMarkdown = `
You are about to share a terminal tab on the web.  Please make sure that you do
NOT share any private information, keys, passwords, or other sensitive information.
You are responsible for what you are sharing, be smart.
`.trim();

const WebStopShareConfirmMarkdown = `
Are you sure you want to stop web-sharing this tab?
`.trim();

@mobxReact.observer
class ScreenSettingsModal extends React.Component<{}, {}> {
    shareCopied: OV<boolean> = mobx.observable.box(false, { name: "ScreenSettings-shareCopied" });
    errorMessage: OV<string> = mobx.observable.box(null, { name: "ScreenSettings-errorMessage" });
    screen: Screen;
    sessionId: string;
    screenId: string;
    remotes: RemoteType[];

    constructor(props) {
        super(props);
        let screenSettingsModal = GlobalModel.screenSettingsModal.get();
        let { sessionId, screenId } = screenSettingsModal;
        this.sessionId = sessionId;
        this.screenId = screenId;
        this.screen = GlobalModel.getScreenById(sessionId, screenId);
        if (this.screen == null || sessionId == null || screenId == null) {
            return;
        }
        this.remotes = GlobalModel.remotes;
    }

    @boundMethod
    getOptions(): { label: string; value: string }[] {
        return this.remotes
            .filter((r) => !r.archived)
            .map((remote) => ({
                ...remote,
                label:
                    remote.remotealias && !util.isBlank(remote.remotealias)
                        ? `${remote.remotecanonicalname}`
                        : remote.remotecanonicalname,
                value: remote.remotecanonicalname,
            }))
            .sort((a, b) => {
                let connValA = util.getRemoteConnVal(a);
                let connValB = util.getRemoteConnVal(b);
                if (connValA !== connValB) {
                    return connValA - connValB;
                }
                return a.remoteidx - b.remoteidx;
            });
    }

    @boundMethod
    closeModal(): void {
        mobx.action(() => {
            GlobalModel.screenSettingsModal.set(null);
        })();
        GlobalModel.modalsModel.popModal();
    }

    @boundMethod
    selectTabColor(color: string): void {
        if (this.screen == null) {
            return;
        }
        if (this.screen.getTabColor() == color) {
            return;
        }
        let prtn = GlobalCommandRunner.screenSetSettings(this.screenId, { tabcolor: color }, false);
        commandRtnHandler(prtn, this.errorMessage);
    }

    @boundMethod
    selectTabIcon(icon: string): void {
        if (this.screen.getTabIcon() == icon) {
            return;
        }
        let prtn = GlobalCommandRunner.screenSetSettings(this.screen.screenId, { tabicon: icon }, false);
        util.commandRtnHandler(prtn, this.errorMessage);
    }

    @boundMethod
    handleChangeArchived(val: boolean): void {
        if (this.screen == null) {
            return;
        }
        if (this.screen.archived.get() == val) {
            return;
        }
        let prtn = GlobalCommandRunner.screenArchive(this.screenId, val);
        commandRtnHandler(prtn, this.errorMessage);
    }

    @boundMethod
    handleChangeWebShare(val: boolean): void {
        if (this.screen == null) {
            return;
        }
        if (this.screen.isWebShared() == val) {
            return;
        }
        let message = val ? WebShareConfirmMarkdown : WebStopShareConfirmMarkdown;
        let alertRtn = GlobalModel.showAlert({ message: message, confirm: true, markdown: true });
        alertRtn.then((result) => {
            if (!result) {
                return;
            }
            let prtn = GlobalCommandRunner.screenWebShare(this.screen.screenId, val);
            commandRtnHandler(prtn, this.errorMessage);
        });
    }

    @boundMethod
    copyShareLink(): void {
        if (this.screen == null) {
            return null;
        }
        let shareLink = this.screen.getWebShareUrl();
        if (shareLink == null) {
            return;
        }
        navigator.clipboard.writeText(shareLink);
        mobx.action(() => {
            this.shareCopied.set(true);
        })();
        setTimeout(() => {
            mobx.action(() => {
                this.shareCopied.set(false);
            })();
        }, 600);
    }

    @boundMethod
    inlineUpdateName(val: string): void {
        if (this.screen == null) {
            return;
        }
        if (util.isStrEq(val, this.screen.name.get())) {
            return;
        }
        let prtn = GlobalCommandRunner.screenSetSettings(this.screenId, { name: val }, false);
        commandRtnHandler(prtn, this.errorMessage);
    }

    @boundMethod
    inlineUpdateShareName(val: string): void {
        if (this.screen == null) {
            return;
        }
        if (util.isStrEq(val, this.screen.getShareName())) {
            return;
        }
        let prtn = GlobalCommandRunner.screenSetSettings(this.screenId, { sharename: val }, false);
        commandRtnHandler(prtn, this.errorMessage);
    }

    @boundMethod
    dismissError(): void {
        mobx.action(() => {
            this.errorMessage.set(null);
        })();
    }

    @boundMethod
    handleDeleteScreen(): void {
        if (this.screen == null) {
            return;
        }
        let message = ScreenDeleteMessage;
        let alertRtn = GlobalModel.showAlert({ message: message, confirm: true, markdown: true });
        alertRtn.then((result) => {
            if (!result) {
                return;
            }
            let prtn = GlobalCommandRunner.screenPurge(this.screenId);
            commandRtnHandler(prtn, this.errorMessage);
            GlobalModel.modalsModel.popModal();
        });
    }

    @boundMethod
    selectRemote(cname: string): void {
        let prtn = GlobalCommandRunner.screenSetRemote(cname, true, false);
        util.commandRtnHandler(prtn, this.errorMessage);
    }

    render() {
        let screen = this.screen;
        if (screen == null) {
            return null;
        }
        let color: string = null;
        let icon: string = null;
        let index: number = 0;
        let curRemote = GlobalModel.getRemote(GlobalModel.getActiveScreen().getCurRemoteInstance().remoteid);

        return (
            <Modal className="screen-settings-modal">
                <Modal.Header onClose={this.closeModal} title={`tab settings (${screen.name.get()})`} />
                <div className="wave-modal-body">
                    <div className="settings-field">
                        <div className="settings-label">Tab Id</div>
                        <div className="settings-input">{screen.screenId}</div>
                    </div>
                    <div className="settings-field">
                        <div className="settings-label">Name</div>
                        <div className="settings-input">
                            <InlineSettingsTextEdit
                                placeholder="name"
                                text={screen.name.get() ?? "(none)"}
                                value={screen.name.get() ?? ""}
                                onChange={this.inlineUpdateName}
                                maxLength={50}
                                showIcon={true}
                            />
                        </div>
                    </div>
                    <div className="settings-field">
                        <div className="settings-label">Connection</div>
                        <div className="settings-input">
                            <Dropdown
                                label={curRemote.remotealias}
                                options={this.getOptions()}
                                defaultValue={curRemote.remotecanonicalname}
                                onChange={this.selectRemote}
                                decoration={{
                                    startDecoration: (
                                        <div className="lefticon">
                                            <GlobeIcon className="globe-icon" />
                                            <StatusCircleIcon
                                                className={cn("status-icon", "status-" + curRemote.status)}
                                            />
                                        </div>
                                    ),
                                }}
                            />
                        </div>
                    </div>
                    <div className="settings-field">
                        <div className="settings-label">Tab Color</div>
                        <div className="settings-input">
                            <div className="tab-colors">
                                <div className="tab-color-cur">
                                    <SquareIcon className={cn("tab-color-icon", "color-" + screen.getTabColor())} />
                                    <span className="tab-color-name">{screen.getTabColor()}</span>
                                </div>
                                <div className="tab-color-sep">|</div>
                                <For each="color" of={TabColors}>
                                    <div
                                        key={color}
                                        className="tab-color-select"
                                        onClick={() => this.selectTabColor(color)}
                                    >
                                        <SquareIcon className={cn("tab-color-icon", "color-" + color)} />
                                    </div>
                                </For>
                            </div>
                        </div>
                    </div>
                    <div className="settings-field">
                        <div className="settings-label">Tab Icon</div>
                        <div className="settings-input">
                            <div className="tab-icons">
                                <div className="tab-icon-cur">
                                    <If condition={screen.getTabIcon() == "default"}>
                                        <SquareIcon className={cn("tab-color-icon", "color-white")} />
                                    </If>
                                    <If condition={screen.getTabIcon() != "default"}>
                                        <i className={`fa-sharp fa-solid fa-${screen.getTabIcon()}`}></i>
                                    </If>
                                    <span className="tab-icon-name">{screen.getTabIcon()}</span>
                                </div>
                                <div className="tab-icon-sep">|</div>
                                <For each="icon" index="index" of={TabIcons}>
                                    <div
                                        key={`${color}-${index}`}
                                        className="tab-icon-select"
                                        onClick={() => this.selectTabIcon(icon)}
                                    >
                                        <i className={`fa-sharp fa-solid fa-${icon}`}></i>
                                    </div>
                                </For>
                            </div>
                        </div>
                    </div>
                    <div className="settings-field">
                        <div className="settings-label archived-label">
                            <div className="">Archived</div>
                            <Tooltip
                                message={`Archive will hide the tab. Commands and output will be retained in history.`}
                                icon={<i className="fa-sharp fa-regular fa-circle-question" />}
                                className="screen-settings-tooltip"
                            >
                                <i className="fa-sharp fa-regular fa-circle-question" />
                            </Tooltip>
                        </div>
                        <div className="settings-input">
                            <Toggle checked={screen.archived.get()} onChange={this.handleChangeArchived} />
                        </div>
                    </div>
                    <div className="settings-field">
                        <div className="settings-label actions-label">
                            <div>Actions</div>
                            <Tooltip
                                message={`Delete will remove the tab, removing all commands and output from history.`}
                                icon={<i className="fa-sharp fa-regular fa-circle-question" />}
                                className="screen-settings-tooltip"
                            >
                                <i className="fa-sharp fa-regular fa-circle-question" />
                            </Tooltip>
                        </div>
                        <div className="settings-input">
                            <div
                                onClick={this.handleDeleteScreen}
                                className="button is-prompt-danger is-outlined is-small"
                            >
                                Delete Tab
                            </div>
                        </div>
                    </div>
                    <SettingsError errorMessage={this.errorMessage} />
                </div>
                <Modal.Footer cancelLabel="Close" onCancel={this.closeModal} />
            </Modal>
        );
    }
}

@mobxReact.observer
class SessionSettingsModal extends React.Component<{}, {}> {
    errorMessage: OV<string> = mobx.observable.box(null, { name: "ScreenSettings-errorMessage" });
    session: Session;
    sessionId: string;

    constructor(props: any) {
        super(props);
        let sessionId = GlobalModel.sessionSettingsModal.get();
        this.session = GlobalModel.getSessionById(sessionId);
        if (this.session == null) {
            return;
        }
    }

    @boundMethod
    closeModal(): void {
        mobx.action(() => {
            GlobalModel.sessionSettingsModal.set(null);
        })();
        GlobalModel.modalsModel.popModal();
    }

    @boundMethod
    handleInlineChangeName(newVal: string): void {
        if (this.session == null) {
            return;
        }
        if (util.isStrEq(newVal, this.session.name.get())) {
            return;
        }
        let prtn = GlobalCommandRunner.sessionSetSettings(this.sessionId, { name: newVal }, false);
        commandRtnHandler(prtn, this.errorMessage);
    }

    @boundMethod
    handleChangeArchived(val: boolean): void {
        if (this.session == null) {
            return;
        }
        if (this.session.archived.get() == val) {
            return;
        }
        let prtn = GlobalCommandRunner.sessionArchive(this.sessionId, val);
        commandRtnHandler(prtn, this.errorMessage);
    }

    @boundMethod
    handleDeleteSession(): void {
        let message = SessionDeleteMessage;
        let alertRtn = GlobalModel.showAlert({ message: message, confirm: true, markdown: true });
        alertRtn.then((result) => {
            if (!result) {
                return;
            }
            let prtn = GlobalCommandRunner.sessionPurge(this.sessionId);
            commandRtnHandler(prtn, this.errorMessage);
        });
    }

    @boundMethod
    dismissError(): void {
        mobx.action(() => {
            this.errorMessage.set(null);
        })();
    }

    render() {
        if (this.session == null) {
            return null;
        }
        return (
            <Modal className="session-settings-modal">
                <Modal.Header onClose={this.closeModal} title={`workspace settings (${this.session.name.get()})`} />
                <div className="wave-modal-body">
                    <div className="settings-field">
                        <div className="settings-label">Name</div>
                        <div className="settings-input">
                            <InlineSettingsTextEdit
                                placeholder="name"
                                text={this.session.name.get() ?? "(none)"}
                                value={this.session.name.get() ?? ""}
                                onChange={this.handleInlineChangeName}
                                maxLength={50}
                                showIcon={true}
                            />
                        </div>
                    </div>
                    <div className="settings-field">
                        <div className="settings-label">
                            <div>Archived</div>
                            <InfoMessage width={400}>
                                Archive will hide the workspace from the active menu. Commands and output will be
                                retained in history.
                            </InfoMessage>
                        </div>
                        <div className="settings-input">
                            <Toggle checked={this.session.archived.get()} onChange={this.handleChangeArchived} />
                        </div>
                    </div>
                    <div className="settings-field">
                        <div className="settings-label">
                            <div>Actions</div>
                            <InfoMessage width={400}>
                                Delete will remove the workspace, removing all commands and output from history.
                            </InfoMessage>
                        </div>
                        <div className="settings-input">
                            <div
                                onClick={this.handleDeleteSession}
                                className="button is-prompt-danger is-outlined is-small"
                            >
                                Delete Workspace
                            </div>
                        </div>
                    </div>
                    <SettingsError errorMessage={this.errorMessage} />
                </div>
                <Modal.Footer cancelLabel="Close" onCancel={this.closeModal} />
            </Modal>
        );
    }
}

@mobxReact.observer
class LineSettingsModal extends React.Component<{}, {}> {
    rendererDropdownActive: OV<boolean> = mobx.observable.box(false, { name: "lineSettings-rendererDropdownActive" });
    errorMessage: OV<string> = mobx.observable.box(null, { name: "ScreenSettings-errorMessage" });
    linenum: number;

    constructor(props: any) {
        super(props);
        this.linenum = GlobalModel.lineSettingsModal.get();
        if (this.linenum == null) {
            return;
        }
    }

    @boundMethod
    closeModal(): void {
        mobx.action(() => {
            GlobalModel.lineSettingsModal.set(null);
        })();
        GlobalModel.modalsModel.popModal();
    }

    @boundMethod
    handleChangeArchived(val: boolean): void {
        let line = this.getLine();
        if (line == null) {
            return;
        }
        let prtn = GlobalCommandRunner.lineArchive(line.lineid, val);
        commandRtnHandler(prtn, this.errorMessage);
    }

    @boundMethod
    toggleRendererDropdown(): void {
        mobx.action(() => {
            this.rendererDropdownActive.set(!this.rendererDropdownActive.get());
        })();
    }

    getLine(): LineType {
        let screen = GlobalModel.getActiveScreen();
        if (screen == null) {
            return;
        }
        return screen.getLineByNum(this.linenum);
    }

    @boundMethod
    clickSetRenderer(renderer: string): void {
        let line = this.getLine();
        if (line == null) {
            return;
        }
        let prtn = GlobalCommandRunner.lineSet(line.lineid, { renderer: renderer });
        commandRtnHandler(prtn, this.errorMessage);
        mobx.action(() => {
            this.rendererDropdownActive.set(false);
        })();
    }

    renderRendererDropdown(): any {
        let line = this.getLine();
        if (line == null) {
            return null;
        }
        let plugins = PluginModel.rendererPlugins;
        let plugin: RendererPluginType = null;
        let renderer = line.renderer ?? "terminal";
        return (
            <div className={cn("dropdown", "renderer-dropdown", { "is-active": this.rendererDropdownActive.get() })}>
                <div className="dropdown-trigger">
                    <button onClick={this.toggleRendererDropdown} className="button is-small is-dark">
                        <span>
                            <i className="fa-sharp fa-solid fa-fill" /> {renderer}
                        </span>
                        <span className="icon is-small">
                            <i className="fa-sharp fa-regular fa-angle-down" aria-hidden="true"></i>
                        </span>
                    </button>
                </div>
                <div className="dropdown-menu" role="menu">
                    <div className="dropdown-content has-background-black">
                        <div onClick={() => this.clickSetRenderer(null)} key="terminal" className="dropdown-item">
                            terminal
                        </div>
                        <For each="plugin" of={plugins}>
                            <div
                                onClick={() => this.clickSetRenderer(plugin.name)}
                                key={plugin.name}
                                className="dropdown-item"
                            >
                                {plugin.name}
                            </div>
                        </For>
                        <div onClick={() => this.clickSetRenderer("none")} key="none" className="dropdown-item">
                            none
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    render() {
        let line = this.getLine();
        if (line == null) {
            setTimeout(() => {
                this.closeModal();
            }, 0);
            return null;
        }
        return (
            <Modal className="line-settings-modal">
                <Modal.Header onClose={this.closeModal} title={`line settings (${line.linenum})`} />
                <div className="wave-modal-body">
                    <div className="settings-field">
                        <div className="settings-label">Renderer</div>
                        <div className="settings-input">{this.renderRendererDropdown()}</div>
                    </div>
                    <div className="settings-field">
                        <div className="settings-label">Archived</div>
                        <div className="settings-input">
                            <Toggle checked={!!line.archived} onChange={this.handleChangeArchived} />
                        </div>
                    </div>
                    <SettingsError errorMessage={this.errorMessage} />
                    <div style={{ height: 50 }} />
                </div>
                <Modal.Footer cancelLabel="Close" onCancel={this.closeModal} />
            </Modal>
        );
    }
}

@mobxReact.observer
class ClientSettingsModal extends React.Component<{}, {}> {
    fontSizeDropdownActive: OV<boolean> = mobx.observable.box(false, { name: "clientSettings-fontSizeDropdownActive" });
    errorMessage: OV<string> = mobx.observable.box(null, { name: "ClientSettings-errorMessage" });

    @boundMethod
    closeModal(): void {
        GlobalModel.modalsModel.popModal();
    }

    @boundMethod
    dismissError(): void {
        mobx.action(() => {
            this.errorMessage.set(null);
        })();
    }

    @boundMethod
    handleChangeFontSize(fontSize: string): void {
        let newFontSize = Number(fontSize);
        this.fontSizeDropdownActive.set(false);
        if (GlobalModel.termFontSize.get() == newFontSize) {
            return;
        }
        let prtn = GlobalCommandRunner.setTermFontSize(newFontSize, false);
        commandRtnHandler(prtn, this.errorMessage);
    }

    @boundMethod
    togglefontSizeDropdown(): void {
        mobx.action(() => {
            this.fontSizeDropdownActive.set(!this.fontSizeDropdownActive.get());
        })();
    }

    @boundMethod
    handleChangeTelemetry(val: boolean): void {
        let prtn: Promise<CommandRtnType> = null;
        if (val) {
            prtn = GlobalCommandRunner.telemetryOn(false);
        } else {
            prtn = GlobalCommandRunner.telemetryOff(false);
        }
        commandRtnHandler(prtn, this.errorMessage);
    }

    getFontSizes(): any {
        let availableFontSizes: { label: string; value: number }[] = [];
        for (let s = MinFontSize; s <= MaxFontSize; s++) {
            availableFontSizes.push({ label: s + "px", value: s });
        }
        return availableFontSizes;
    }

    @boundMethod
    inlineUpdateOpenAIModel(newModel: string): void {
        let prtn = GlobalCommandRunner.setClientOpenAISettings({ model: newModel });
        commandRtnHandler(prtn, this.errorMessage);
    }

    @boundMethod
    inlineUpdateOpenAIToken(newToken: string): void {
        let prtn = GlobalCommandRunner.setClientOpenAISettings({ apitoken: newToken });
        commandRtnHandler(prtn, this.errorMessage);
    }

    @boundMethod
    inlineUpdateOpenAIMaxTokens(newMaxTokensStr: string): void {
        let prtn = GlobalCommandRunner.setClientOpenAISettings({ maxtokens: newMaxTokensStr });
        commandRtnHandler(prtn, this.errorMessage);
    }

    @boundMethod
    setErrorMessage(msg: string): void {
        mobx.action(() => {
            this.errorMessage.set(msg);
        })();
    }

    render() {
        let cdata: ClientDataType = GlobalModel.clientData.get();
        let openAIOpts = cdata.openaiopts ?? {};
        let apiTokenStr = util.isBlank(openAIOpts.apitoken) ? "(not set)" : "********";
        let maxTokensStr = String(
            openAIOpts.maxtokens == null || openAIOpts.maxtokens == 0 ? 1000 : openAIOpts.maxtokens
        );
        let curFontSize = GlobalModel.termFontSize.get();
        return (
            <Modal className="client-settings-modal">
                <Modal.Header onClose={this.closeModal} title="Client settings" />
                <div className="wave-modal-body">
                    <div className="settings-field">
                        <div className="settings-label">Term Font Size</div>
                        {/* <div className="settings-input">{this.renderFontSizeDropdown()}</div> */}
                        <div className="settings-input">
                            <Dropdown
                                className="font-size-dropdown"
                                options={this.getFontSizes()}
                                defaultValue={`${curFontSize}px`}
                                onChange={this.handleChangeFontSize}
                            />
                        </div>
                    </div>
                    <div className="settings-field">
                        <div className="settings-label">Client ID</div>
                        <div className="settings-input">{cdata.clientid}</div>
                    </div>
                    <div className="settings-field">
                        <div className="settings-label">Client Version</div>
                        <div className="settings-input">
                            {VERSION} {BUILD}
                        </div>
                    </div>
                    <div className="settings-field">
                        <div className="settings-label">DB Version</div>
                        <div className="settings-input">{cdata.dbversion}</div>
                    </div>
                    <div className="settings-field">
                        <div className="settings-label">Basic Telemetry</div>
                        <div className="settings-input">
                            <Toggle checked={!cdata.clientopts.notelemetry} onChange={this.handleChangeTelemetry} />
                        </div>
                    </div>
                    <div className="settings-field">
                        <div className="settings-label">OpenAI Token</div>
                        <div className="settings-input">
                            <InlineSettingsTextEdit
                                placeholder=""
                                text={apiTokenStr}
                                value={""}
                                onChange={this.inlineUpdateOpenAIToken}
                                maxLength={100}
                                showIcon={true}
                            />
                        </div>
                    </div>
                    <div className="settings-field">
                        <div className="settings-label">OpenAI Model</div>
                        <div className="settings-input">
                            <InlineSettingsTextEdit
                                placeholder="gpt-3.5-turbo"
                                text={util.isBlank(openAIOpts.model) ? "gpt-3.5-turbo" : openAIOpts.model}
                                value={openAIOpts.model ?? ""}
                                onChange={this.inlineUpdateOpenAIModel}
                                maxLength={100}
                                showIcon={true}
                            />
                        </div>
                    </div>
                    <div className="settings-field">
                        <div className="settings-label">OpenAI MaxTokens</div>
                        <div className="settings-input">
                            <InlineSettingsTextEdit
                                placeholder=""
                                text={maxTokensStr}
                                value={maxTokensStr}
                                onChange={this.inlineUpdateOpenAIMaxTokens}
                                maxLength={10}
                                showIcon={true}
                            />
                        </div>
                    </div>
                    <SettingsError errorMessage={this.errorMessage} />
                </div>
                <Modal.Footer cancelLabel="Close" onCancel={this.closeModal} />
            </Modal>
        );
    }
}

export {
    ScreenSettingsModal,
    SessionSettingsModal,
    LineSettingsModal,
    ClientSettingsModal,
    WebStopShareConfirmMarkdown,
};
