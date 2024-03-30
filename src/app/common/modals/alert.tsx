// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobxReact from "mobx-preact";
import { boundMethod } from "autobind-decorator";
import { If } from "tsx-control-statements/components";
import { Markdown, Modal, Button, Checkbox } from "@/elements";
import { GlobalModel, GlobalCommandRunner } from "@/models";

import "./alert.less";
import { ModalKeybindings } from "../elements/modal";

@mobxReact.observer
class AlertModal extends React.PureComponent<{}, {}> {
    @boundMethod
    closeModal(): void {
        GlobalModel.modalsModel.popModal(() => GlobalModel.cancelAlert());
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
                <Modal.Header onClose={this.closeModal} title={title} keybindings={true} />
                <div className="wave-modal-body">
                    <If condition={message?.markdown}>
                        <Markdown text={message?.message ?? ""} extraClassName="bottom-margin" />
                    </If>
                    <If condition={!message?.markdown}>{message?.message}</If>
                    <If condition={message?.confirmflag}>
                        <Checkbox
                            onChange={this.handleDontShowAgain}
                            label={"Don't show me this again"}
                            className="dontshowagain-text"
                        />
                    </If>
                </div>
                <div className="wave-modal-footer">
                    <If condition={isConfirm}>
                        <ModalKeybindings onOk={this.handleOK} onCancel={this.closeModal}></ModalKeybindings>
                        <Button className="secondary" onClick={this.closeModal}>
                            Cancel
                        </Button>
                        <Button autoFocus={true} onClick={this.handleOK}>
                            Ok
                        </Button>
                    </If>
                    <If condition={!isConfirm}>
                        <ModalKeybindings onOk={this.handleOK} onCancel={null}></ModalKeybindings>
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
