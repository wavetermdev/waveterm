// Copyright 2023, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as React from "react";
import * as mobx from "mobx";
import { If } from "tsx-control-statements/components";
import ReactDOM from "react-dom";
import { Button } from "./button";
import { IconButton } from "./iconbutton";

import "./modal.less";

interface ModalHeaderProps {
    onClose?: () => void;
    title: string;
}

const ModalHeader: React.FC<ModalHeaderProps> = ({ onClose, title }) => (
    <div className="wave-modal-header">
        {<div className="wave-modal-title">{title}</div>}
        <If condition={onClose}>
            <IconButton theme="secondary" variant="ghost" onClick={onClose}>
                <i className="fa-sharp fa-solid fa-xmark"></i>
            </IconButton>
        </If>
    </div>
);

interface ModalFooterProps {
    onCancel?: () => void;
    onOk?: () => void;
    cancelLabel?: string;
    okLabel?: string;
}

const ModalFooter: React.FC<ModalFooterProps> = ({ onCancel, onOk, cancelLabel = "Cancel", okLabel = "Ok" }) => (
    <div className="wave-modal-footer">
        {onCancel && (
            <Button theme="secondary" onClick={onCancel}>
                {cancelLabel}
            </Button>
        )}
        {onOk && <Button onClick={onOk}>{okLabel}</Button>}
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

export { Modal };
