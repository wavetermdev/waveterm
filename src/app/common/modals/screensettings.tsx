// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { boundMethod } from "autobind-decorator";
import { If, For } from "tsx-control-statements/components";
import cn from "classnames";
import { GlobalModel, GlobalCommandRunner, Screen } from "../../../models";
import { Toggle, InlineSettingsTextEdit, SettingsError, Modal, Dropdown, Tooltip } from "../elements";
import * as util from "../../../util/util";
import { commandRtnHandler } from "../../../util/util";
import { ReactComponent as SquareIcon } from "../../assets/icons/tab/square.svg";
import { ReactComponent as GlobeIcon } from "../../assets/icons/globe.svg";
import { ReactComponent as StatusCircleIcon } from "../../assets/icons/statuscircle.svg";
import * as appconst from "../../appconst";

import "./screensettings.less";

const ScreenDeleteMessage = `
Are you sure you want to delete this tab?

All commands and output will be deleted.  To hide the tab, and retain the commands and output, use 'archive'.
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
        if (this.screen.getScreenLines().lines.length == 0) {
            GlobalCommandRunner.screenDelete(this.screenId, false);
            GlobalModel.modalsModel.popModal();
            return;
        }
        let message = ScreenDeleteMessage;
        let alertRtn = GlobalModel.showAlert({ message: message, confirm: true, markdown: true });
        alertRtn.then((result) => {
            if (!result) {
                return;
            }
            let prtn = GlobalCommandRunner.screenDelete(this.screenId, false);
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
                                className="screen-settings-dropdown"
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
                                <For each="color" of={appconst.TabColors}>
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
                                <For each="icon" index="index" of={appconst.TabIcons}>
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

export { ScreenSettingsModal };
