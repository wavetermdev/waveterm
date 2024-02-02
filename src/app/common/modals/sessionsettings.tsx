// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import * as mobx from "mobx";
import { boundMethod } from "autobind-decorator";
import { GlobalModel, GlobalCommandRunner, Session } from "../../../model/model";
import { Toggle, InlineSettingsTextEdit, SettingsError, InfoMessage, Modal } from "../common";
import * as util from "../../../util/util";
import { commandRtnHandler } from "../../../util/util";

import "./sessionsettings.less";

type OV<V> = mobx.IObservableValue<V>;

const SessionDeleteMessage = `
Are you sure you want to delete this workspace?

All commands and output will be deleted.  To hide the workspace, and retain the commands and output, use 'archive'.
`.trim();

@mobxReact.observer
class SessionSettingsModal extends React.Component<{}, {}> {
    errorMessage: OV<string> = mobx.observable.box(null, { name: "ScreenSettings-errorMessage" });
    session: Session;
    sessionId: string;

    constructor(props: any) {
        super(props);
        this.sessionId = GlobalModel.sessionSettingsModal.get();
        this.session = GlobalModel.getSessionById(this.sessionId);
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
            let prtn = GlobalCommandRunner.sessionDelete(this.sessionId);
            commandRtnHandler(prtn, this.errorMessage, () => GlobalModel.modalsModel.popModal());
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

export { SessionSettingsModal };
