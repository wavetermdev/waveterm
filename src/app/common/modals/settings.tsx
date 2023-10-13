import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { boundMethod } from "autobind-decorator";
import { If, For } from "tsx-control-statements/components";
import cn from "classnames";
import { GlobalModel, GlobalCommandRunner, TabColors } from "../../../model/model";
import { Toggle, InlineSettingsTextEdit, SettingsError, InfoMessage } from "../common";
import { LineType, RendererPluginType, ClientDataType, CommandRtnType } from "../../../types/types";
import { PluginModel } from "../../../plugins/plugins";
import * as util from "../../../util/util";
import { ReactComponent as SquareIcon } from "../../assets/icons/tab/square.svg";
import { ReactComponent as XmarkIcon } from "../../assets/icons/line/xmark.svg";
import { ReactComponent as AngleDownIcon } from "../../assets/icons/history/angle-down.svg";

import "./modals.less";

type OV<V> = mobx.IObservableValue<V>;

// @ts-ignore
const VERSION = __PROMPT_VERSION__;
// @ts-ignore
const BUILD = __PROMPT_BUILD__;

const ScreenDeleteMessage = `
Are you sure you want to delete this screen/tab?

All commands and output will be deleted, and removed from history.  To hide the screen, and retain the commands in history, use 'archive'.
`.trim();

const SessionDeleteMessage = `
Are you sure you want to delete this session?

All commands and output will be deleted, and removed from history.  To hide the session, and retain the commands in history, use 'archive'.
`.trim();

const WebShareConfirmMarkdown = `
You are about to share a terminal tab on the web.  Please make sure that you do
NOT share any private information, keys, passwords, or other sensitive information.
You are responsible for what you are sharing, be smart.
`.trim();

const WebStopShareConfirmMarkdown = `
Are you sure you want to stop web-sharing this screen?
`.trim();

function commandRtnHandler(prtn: Promise<CommandRtnType>, errorMessage: OV<string>) {
    prtn.then((crtn) => {
        if (crtn.success) {
            return;
        }
        mobx.action(() => {
            errorMessage.set(crtn.error);
        })();
    });
}

@mobxReact.observer
class ScreenSettingsModal extends React.Component<{ sessionId: string; screenId: string }, {}> {
    shareCopied: OV<boolean> = mobx.observable.box(false, { name: "ScreenSettings-shareCopied" });
    errorMessage: OV<string> = mobx.observable.box(null, { name: "ScreenSettings-errorMessage" });

    constructor(props: any) {
        super(props);
        let { sessionId, screenId } = props;
        let screen = GlobalModel.getScreenById(sessionId, screenId);
        if (screen == null) {
            return;
        }
    }

    @boundMethod
    closeModal(): void {
        mobx.action(() => {
            GlobalModel.screenSettingsModal.set(null);
        })();
    }

    @boundMethod
    selectTabColor(color: string): void {
        let { sessionId, screenId } = this.props;
        let screen = GlobalModel.getScreenById(sessionId, screenId);
        if (screen == null) {
            return;
        }
        if (screen.getTabColor() == color) {
            return;
        }
        let prtn = GlobalCommandRunner.screenSetSettings(this.props.screenId, { tabcolor: color }, false);
        commandRtnHandler(prtn, this.errorMessage);
    }

    @boundMethod
    handleChangeArchived(val: boolean): void {
        let { sessionId, screenId } = this.props;
        let screen = GlobalModel.getScreenById(sessionId, screenId);
        if (screen == null) {
            return;
        }
        if (screen.archived.get() == val) {
            return;
        }
        let prtn = GlobalCommandRunner.screenArchive(this.props.screenId, val);
        commandRtnHandler(prtn, this.errorMessage);
    }

    @boundMethod
    handleChangeWebShare(val: boolean): void {
        let { sessionId, screenId } = this.props;
        let screen = GlobalModel.getScreenById(sessionId, screenId);
        if (screen == null) {
            return;
        }
        if (screen.isWebShared() == val) {
            return;
        }
        let message = val ? WebShareConfirmMarkdown : WebStopShareConfirmMarkdown;
        let alertRtn = GlobalModel.showAlert({ message: message, confirm: true, markdown: true });
        alertRtn.then((result) => {
            if (!result) {
                return;
            }
            let prtn = GlobalCommandRunner.screenWebShare(screen.screenId, val);
            commandRtnHandler(prtn, this.errorMessage);
        });
    }

    @boundMethod
    copyShareLink(): void {
        let { sessionId, screenId } = this.props;
        let screen = GlobalModel.getScreenById(sessionId, screenId);
        if (screen == null) {
            return null;
        }
        let shareLink = screen.getWebShareUrl();
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
        let { sessionId, screenId } = this.props;
        let screen = GlobalModel.getScreenById(sessionId, screenId);
        if (screen == null) {
            return;
        }
        if (util.isStrEq(val, screen.name.get())) {
            return;
        }
        let prtn = GlobalCommandRunner.screenSetSettings(this.props.screenId, { name: val }, false);
        commandRtnHandler(prtn, this.errorMessage);
    }

    @boundMethod
    inlineUpdateShareName(val: string): void {
        let { sessionId, screenId } = this.props;
        let screen = GlobalModel.getScreenById(sessionId, screenId);
        if (screen == null) {
            return;
        }
        if (util.isStrEq(val, screen.getShareName())) {
            return;
        }
        let prtn = GlobalCommandRunner.screenSetSettings(this.props.screenId, { sharename: val }, false);
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
        let { sessionId, screenId } = this.props;
        let screen = GlobalModel.getScreenById(sessionId, screenId);
        if (screen == null) {
            return;
        }
        let message = ScreenDeleteMessage;
        let alertRtn = GlobalModel.showAlert({ message: message, confirm: true, markdown: true });
        alertRtn.then((result) => {
            if (!result) {
                return;
            }
            let prtn = GlobalCommandRunner.screenPurge(screenId);
            commandRtnHandler(prtn, this.errorMessage);
        });
    }

    render() {
        let { sessionId, screenId } = this.props;
        let screen = GlobalModel.getScreenById(sessionId, screenId);
        if (screen == null) {
            return null;
        }
        let color: string = null;
        return (
            <div className={cn("modal screen-settings-modal settings-modal prompt-modal is-active")}>
                <div className="modal-background" />
                <div className="modal-content">
                    <If condition={this.shareCopied.get()}>
                        <div className="copied-indicator" />
                    </If>
                    <header>
                        <div className="modal-title">screen settings ({screen.name.get()})</div>
                        <div className="close-icon hoverEffect" title="Close (Escape)" onClick={this.closeModal}>
                            <XmarkIcon />
                        </div>
                    </header>
                    <div className="inner-content">
                        <div className="settings-field">
                            <div className="settings-label">Screen Id</div>
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
                            <div className="settings-label">
                                <div>Archived</div>
                                <InfoMessage width={400}>
                                    Archive will hide the screen tab. Commands and output will be retained in history.
                                </InfoMessage>
                            </div>
                            <div className="settings-input">
                                <Toggle checked={screen.archived.get()} onChange={this.handleChangeArchived} />
                            </div>
                        </div>
                        <div className="settings-field">
                            <div className="settings-label">
                                <div>Actions</div>
                                <InfoMessage width={400}>
                                    Delete will remove the screen, removing all commands and output from history.
                                </InfoMessage>
                            </div>
                            <div className="settings-input">
                                <div
                                    onClick={this.handleDeleteScreen}
                                    className="button is-prompt-danger is-outlined is-small"
                                >
                                    Delete Screen
                                </div>
                            </div>
                        </div>
                        <SettingsError errorMessage={this.errorMessage} />
                    </div>
                    <footer>
                        <div onClick={this.closeModal} className="button is-prompt-green is-outlined is-small">
                            Close
                        </div>
                    </footer>
                </div>
            </div>
        );
    }
}

@mobxReact.observer
class SessionSettingsModal extends React.Component<{ sessionId: string }, {}> {
    errorMessage: OV<string> = mobx.observable.box(null, { name: "ScreenSettings-errorMessage" });

    constructor(props: any) {
        super(props);
        let { sessionId } = props;
        let session = GlobalModel.getSessionById(sessionId);
        if (session == null) {
            return;
        }
    }

    @boundMethod
    closeModal(): void {
        mobx.action(() => {
            GlobalModel.sessionSettingsModal.set(null);
        })();
    }

    @boundMethod
    handleInlineChangeName(newVal: string): void {
        let { sessionId } = this.props;
        let session = GlobalModel.getSessionById(sessionId);
        if (session == null) {
            return;
        }
        if (util.isStrEq(newVal, session.name.get())) {
            return;
        }
        let prtn = GlobalCommandRunner.sessionSetSettings(this.props.sessionId, { name: newVal }, false);
        commandRtnHandler(prtn, this.errorMessage);
    }

    @boundMethod
    handleChangeArchived(val: boolean): void {
        let { sessionId } = this.props;
        let session = GlobalModel.getSessionById(sessionId);
        if (session == null) {
            return;
        }
        if (session.archived.get() == val) {
            return;
        }
        let prtn = GlobalCommandRunner.sessionArchive(this.props.sessionId, val);
        commandRtnHandler(prtn, this.errorMessage);
    }

    @boundMethod
    handleDeleteSession(): void {
        let { sessionId } = this.props;
        let message = SessionDeleteMessage;
        let alertRtn = GlobalModel.showAlert({ message: message, confirm: true, markdown: true });
        alertRtn.then((result) => {
            if (!result) {
                return;
            }
            let prtn = GlobalCommandRunner.sessionPurge(this.props.sessionId);
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
        let { sessionId } = this.props;
        let session = GlobalModel.getSessionById(sessionId);
        if (session == null) {
            return null;
        }
        return (
            <div className={cn("modal session-settings-modal settings-modal prompt-modal is-active")}>
                <div className="modal-background" />
                <div className="modal-content">
                    <header>
                        <div className="modal-title">workspace settings ({session.name.get()})</div>
                        <div className="close-icon hoverEffect" title="Close (Escape)" onClick={this.closeModal}>
                            <XmarkIcon />
                        </div>
                    </header>
                    <div className="inner-content">
                        <div className="settings-field">
                            <div className="settings-label">Name</div>
                            <div className="settings-input">
                                <InlineSettingsTextEdit
                                    placeholder="name"
                                    text={session.name.get() ?? "(none)"}
                                    value={session.name.get() ?? ""}
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
                                    Archive will hide the session from the active menu. Commands and output will be
                                    retained in history.
                                </InfoMessage>
                            </div>
                            <div className="settings-input">
                                <Toggle checked={session.archived.get()} onChange={this.handleChangeArchived} />
                            </div>
                        </div>
                        <div className="settings-field">
                            <div className="settings-label">
                                <div>Actions</div>
                                <InfoMessage width={400}>
                                    Delete will remove the session, removing all commands and output from history.
                                </InfoMessage>
                            </div>
                            <div className="settings-input">
                                <div
                                    onClick={this.handleDeleteSession}
                                    className="button is-prompt-danger is-outlined is-small"
                                >
                                    Delete Session
                                </div>
                            </div>
                        </div>
                        <SettingsError errorMessage={this.errorMessage} />
                    </div>
                    <footer>
                        <div onClick={this.closeModal} className="button is-prompt-green is-outlined is-small">
                            Close
                        </div>
                    </footer>
                </div>
            </div>
        );
    }
}

@mobxReact.observer
class LineSettingsModal extends React.Component<{ linenum: number }, {}> {
    rendererDropdownActive: OV<boolean> = mobx.observable.box(false, { name: "lineSettings-rendererDropdownActive" });
    errorMessage: OV<string> = mobx.observable.box(null, { name: "ScreenSettings-errorMessage" });

    @boundMethod
    closeModal(): void {
        mobx.action(() => {
            GlobalModel.lineSettingsModal.set(null);
        })();
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
        return screen.getLineByNum(this.props.linenum);
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
            <div className={cn("modal line-settings-modal settings-modal prompt-modal is-active")}>
                <div className="modal-background" />
                <div className="modal-content">
                    <header>
                        <div className="modal-title">line settings ({line.linenum})</div>
                        <div className="close-icon hoverEffect" title="Close (Escape)" onClick={this.closeModal}>
                            <XmarkIcon />
                        </div>
                    </header>
                    <div className="inner-content">
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
                    <footer>
                        <div onClick={this.closeModal} className="button is-prompt-green is-outlined is-small">
                            Close
                        </div>
                    </footer>
                </div>
            </div>
        );
    }
}

@mobxReact.observer
class ClientSettingsModal extends React.Component<{}, {}> {
    fontSizeDropdownActive: OV<boolean> = mobx.observable.box(false, { name: "clientSettings-fontSizeDropdownActive" });
    errorMessage: OV<string> = mobx.observable.box(null, { name: "ClientSettings-errorMessage" });

    @boundMethod
    closeModal(): void {
        mobx.action(() => {
            GlobalModel.clientSettingsModal.set(false);
        })();
    }

    @boundMethod
    dismissError(): void {
        mobx.action(() => {
            this.errorMessage.set(null);
        })();
    }

    @boundMethod
    handleChangeFontSize(newFontSize: number): void {
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

    renderFontSizeDropdown(): any {
        let availableFontSizes = [8, 9, 10, 11, 12, 13, 14, 15];
        let fsize: number = 0;
        let curSize = GlobalModel.termFontSize.get()
        return (
            <div className={cn("dropdown", "font-size-dropdown", { "is-active": this.fontSizeDropdownActive.get() })}>
                <div className="dropdown-trigger">
                    <button onClick={this.togglefontSizeDropdown} className="button">
                        <span>{curSize}px</span>
                        <AngleDownIcon className="icon" />
                    </button>
                </div>
                <div className="dropdown-menu" role="menu">
                    <div className="dropdown-content has-background-black">
                        <For each="fsize" of={availableFontSizes}>
                            <div
                                onClick={() => this.handleChangeFontSize(fsize)}
                                key={fsize + "px"}
                                className="dropdown-item"
                            >
                                {fsize}px
                            </div>
                        </For>
                    </div>
                </div>
            </div>
        );
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
        return (
            <div className={cn("modal client-settings-modal settings-modal prompt-modal is-active")}>
                <div className="modal-background" />
                <div className="modal-content">
                    <header>
                        <div className="modal-title">Client settings</div>
                        <div className="close-icon hoverEffect" title="Close (Escape)" onClick={this.closeModal}>
                            <XmarkIcon />
                        </div>
                    </header>
                    <div className="inner-content">
                        <div className="settings-field">
                            <div className="settings-label">Term Font Size</div>
                            <div className="settings-input">{this.renderFontSizeDropdown()}</div>
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
                    <footer>
                        <div onClick={this.closeModal} className="button is-prompt-green is-outlined is-small">
                            Close
                        </div>
                    </footer>
                </div>
            </div>
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
