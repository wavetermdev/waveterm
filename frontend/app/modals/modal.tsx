// Copyright 2024, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import clsx from "clsx";
import ReactDOM from "react-dom";

import "./modal.less";

interface ModalContentProps {
    children: React.ReactNode;
}

function ModalContent({ children }: ModalContentProps) {
    return <div className="modal-content">{children}</div>;
}

interface ModalFooterProps {
    okLabel?: string;
    cancelLabel?: string;
    onOk?: () => void;
    onCancel?: () => void;
}

const ModalFooter = ({ onCancel, onOk, cancelLabel = "Cancel", okLabel = "Ok" }: ModalFooterProps) => {
    return (
        <footer className="modal-footer">
            {onCancel && (
                <Button className="secondary ghost" onClick={onCancel}>
                    {cancelLabel}
                </Button>
            )}
            {onOk && (
                <Button className="primary" onClick={onOk}>
                    {okLabel}
                </Button>
            )}
        </footer>
    );
};

interface ModalProps {
    children?: React.ReactNode;
    description?: string;
    okLabel?: string;
    cancelLabel?: string;
    className?: string;
    onClickBackdrop?: () => void;
    onOk?: () => void;
    onCancel?: () => void;
    onClose?: () => void;
}

const Modal = ({
    children,
    className,
    description,
    cancelLabel,
    okLabel,
    onCancel,
    onOk,
    onClose,
    onClickBackdrop,
}: ModalProps) => {
    const renderBackdrop = (onClick) => <div className="modal-backdrop" onClick={onClick}></div>;

    const renderFooter = () => {
        return onOk || onCancel;
    };

    const renderModal = () => (
        <div className="modal-wrapper">
            {renderBackdrop(onClickBackdrop)}
            <div className={clsx(`modal`, className)}>
                <Button className="secondary ghost modal-close-btn" onClick={onClose} title="Close (ESC)">
                    <i className="fa-sharp fa-solid fa-xmark"></i>
                </Button>
                <div className="content-wrapper">
                    <ModalContent>{children}</ModalContent>
                </div>
                {renderFooter() && (
                    <ModalFooter onCancel={onCancel} onOk={onOk} cancelLabel={cancelLabel} okLabel={okLabel} />
                )}
            </div>
        </div>
    );

    return ReactDOM.createPortal(renderModal(), document.getElementById("main"));
};

interface FlexiModalProps {
    children?: React.ReactNode;
    className?: string;
    onClickBackdrop?: () => void;
}

const FlexiModal = ({ children, className, onClickBackdrop }: FlexiModalProps) => {
    const renderBackdrop = (onClick) => <div className="modal-backdrop" onClick={onClick}></div>;

    const renderModal = () => (
        <div className="modal-wrapper">
            {renderBackdrop(onClickBackdrop)}
            <div className={`modal ${className}`}>{children}</div>
        </div>
    );

    return ReactDOM.createPortal(renderModal(), document.getElementById("main"));
};

FlexiModal.Content = ModalContent;
FlexiModal.Footer = ModalFooter;

export { FlexiModal, Modal };
