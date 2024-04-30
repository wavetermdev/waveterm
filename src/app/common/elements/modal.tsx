// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import { If } from "tsx-control-statements/components";
import ReactDOM from "react-dom";
import { Button } from "./button";
import { v4 as uuidv4 } from "uuid";
import { GlobalModel } from "@/models";

import "./modal.less";
import { boundMethod } from "autobind-decorator";

interface ModalHeaderProps {
    onClose?: () => void;
    keybindings?: boolean;
    title: string;
}

const ModalHeader: React.FC<ModalHeaderProps> = ({ onClose, keybindings, title }) => (
    <div className="wave-modal-header">
        <If condition={keybindings && onClose}>
            <ModalKeybindings onCancel={onClose}></ModalKeybindings>
        </If>
        {<div className="wave-modal-title">{title}</div>}
        <If condition={onClose}>
            <Button className="secondary ghost" onClick={() => onClose()} title="Close (ESC)">
                <i className="fa-sharp fa-solid fa-xmark"></i>
            </Button>
        </If>
    </div>
);

interface ModalFooterProps {
    onCancel?: () => void;
    onOk?: () => void;
    cancelLabel?: string;
    okLabel?: string;
    keybindings?: boolean;
}

class ModalKeybindings extends React.Component<{ onOk?: () => void; onCancel?: () => void }, {}> {
    curId: string;

    @boundMethod
    componentDidMount(): void {
        this.curId = uuidv4();
        const domain = "modal-" + this.curId;
        const keybindManager = GlobalModel.keybindManager;
        if (this.props.onOk) {
            keybindManager.registerKeybinding("modal", domain, "generic:confirm", (waveEvent) => {
                if (this.props.onOk) {
                    this.props.onOk();
                }
                return true;
            });
        }
        if (this.props.onCancel) {
            keybindManager.registerKeybinding("modal", domain, "generic:cancel", (waveEvent) => {
                if (this.props.onCancel) {
                    this.props.onCancel();
                }
                return true;
            });
        }
    }

    @boundMethod
    componentWillUnmount(): void {
        GlobalModel.keybindManager.unregisterDomain("modal-" + this.curId);
    }

    render(): React.ReactNode {
        return null;
    }
}

const ModalFooter: React.FC<ModalFooterProps> = ({
    onCancel,
    onOk,
    cancelLabel = "Cancel",
    okLabel = "Ok",
    keybindings,
}) => (
    <div className="wave-modal-footer">
        <If condition={keybindings}>
            <ModalKeybindings onOk={onOk} onCancel={onCancel}></ModalKeybindings>
        </If>
        {onCancel && (
            <Button className="secondary" onClick={onCancel}>
                {cancelLabel}
            </Button>
        )}
        {onOk && (
            <Button className="primary" onClick={onOk}>
                {okLabel}
            </Button>
        )}
    </div>
);

interface ModalProps {
    className?: string;
    children?: React.ReactNode;
    onClickBackdrop?: () => void;
}

class Modal extends React.Component<ModalProps> {
    static Header = ModalHeader;
    static Footer = ModalFooter;

    renderBackdrop(onClick: (() => void) | undefined) {
        return <div className="wave-modal-backdrop" onClick={onClick}></div>;
    }

    renderModal() {
        const { className, children } = this.props;

        return (
            <div className="wave-modal-container">
                {this.renderBackdrop(this.props.onClickBackdrop)}
                <div className={`wave-modal ${className}`}>
                    <div className="wave-modal-content">{children}</div>
                </div>
            </div>
        );
    }

    render() {
        return ReactDOM.createPortal(this.renderModal(), document.getElementById("app"));
    }
}

export { Modal, ModalKeybindings };
