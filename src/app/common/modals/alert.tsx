// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-react";
import { boundMethod } from "autobind-decorator";
import { If } from "tsx-control-statements/components";
import { Markdown, Modal, Button, Checkbox } from "../elements";
import { GlobalModel, GlobalCommandRunner } from "../../../model/model";

import "./alert.less";

@mobxReact.observer
class AlertModal extends React.Component<{}, {}> {
    @boundMethod
    closeModal(): void {
        GlobalModel.cancelAlert();
    }

    @boundMethod
    handleOK(): void {
        GlobalModel.confirmAlert();
    }

    @boundMethod
    handleDontShowAgain(checked: boolean) {
        let message = GlobalModel.alertMessage.get();
        if (message.confirmflag == null) {
            return;
        }
        GlobalCommandRunner.clientSetConfirmFlag(message.confirmflag, checked);
    }

    render() {
        let message = GlobalModel.alertMessage.get();
        let title = message?.title ?? (message?.confirm ? "Confirm" : "Alert");
        let isConfirm = message?.confirm ?? false;

        return (
            <Modal className="alert-modal">
                <Modal.Header onClose={this.closeModal} title={title} />
                <div className="wave-modal-body">
                    <If condition={message?.markdown}>
                        <Markdown text={message?.message ?? ""} />
                    </If>
                    <If condition={!message?.markdown}>{message?.message}</If>
                    <If condition={message.confirmflag}>
                        <Checkbox
                            onChange={this.handleDontShowAgain}
                            label={"Don't show me this again"}
                            className="dontshowagain-text"
                        />
                    </If>
                </div>
                <div className="wave-modal-footer">
                    <If condition={isConfirm}>
                        <Button theme="secondary" onClick={this.closeModal}>
                            Cancel
                        </Button>
                        <Button autoFocus={true} onClick={this.handleOK}>
                            Ok
                        </Button>
                    </If>
                    <If condition={!isConfirm}>
                        <Button autoFocus={true} onClick={this.handleOK}>
                            Ok
                        </Button>
                    </If>
                </div>
            </Modal>
        );
    }
}

export { AlertModal };
