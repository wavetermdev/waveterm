// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { modalsModel } from "@/app/store/modalmodel";
import { makeIconClass } from "@/util/util";
import { ReactNode, useEffect } from "react";
import ReactDOM from "react-dom";

interface AlertModalProps {
    children: ReactNode;
    title?: string;
    icon?: string;
    iconClassName?: string;
    okLabel?: string;
    onClose?: () => void;
}

interface AlertOptions {
    title?: string;
    message: ReactNode;
    icon?: string;
    iconClassName?: string;
    okLabel?: string;
}

function showAlert(opts: AlertOptions) {
    modalsModel.pushModal("AlertModal", {
        children: opts.message,
        title: opts.title ?? "Alert",
        icon: opts.icon,
        iconClassName: opts.iconClassName,
        okLabel: opts.okLabel,
    });
}

function showErrorAlert(message: ReactNode, title?: string) {
    showAlert({ title: title ?? "Error", message, icon: "circle-exclamation", iconClassName: "text-error" });
}

const AlertModal = ({ children, title = "Alert", icon = "circle-info", iconClassName, okLabel = "Ok", onClose }: AlertModalProps) => {
    function close() {
        if (onClose) {
            onClose();
        } else {
            modalsModel.popModal();
        }
    }

    useEffect(() => {
        function handleKeyDown(e: KeyboardEvent) {
            if (e.key === "Escape" || e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                close();
            }
        }
        window.addEventListener("keydown", handleKeyDown, true);
        return () => window.removeEventListener("keydown", handleKeyDown, true);
    }, []);

    const iconClass = makeIconClass(icon, false);

    return ReactDOM.createPortal(
        <div
            className="fixed inset-0 flex items-center justify-center"
            style={{ zIndex: "var(--zindex-modal-wrapper)" }}
        >
            <div
                className="fixed inset-0"
                style={{ zIndex: "var(--zindex-modal-backdrop)", backgroundColor: "rgba(21,23,21,0.7)", top: "36px" }}
            />
            <div
                className="relative flex flex-col rounded-lg shadow-[0px_8px_32px_rgba(0,0,0,0.4)] min-w-[380px] max-w-[560px]"
                style={{
                    zIndex: "var(--zindex-modal)",
                    background: "var(--modal-bg-color)",
                    border: "0.5px solid var(--modal-border-color)",
                }}
            >
                <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/10">
                    <i className={`${iconClass} text-base ${iconClassName ?? "text-warning"}`} />
                    <span className="text-sm font-semibold text-primary flex-1">{title}</span>
                    <button
                        className="text-muted hover:text-primary transition-colors cursor-pointer p-0.5"
                        onClick={close}
                        tabIndex={-1}
                    >
                        <i className="fa-sharp fa-solid fa-xmark text-sm" />
                    </button>
                </div>
                <div className="px-5 pt-3 pb-2 text-sm text-secondary leading-relaxed">{children}</div>
                <div className="flex justify-end px-5 pb-3 pt-1">
                    <button
                        className="bg-white/10 text-primary rounded px-5 py-1.5 text-sm font-medium hover:bg-white/20 transition-colors cursor-pointer outline-none"
                        onClick={close}
                        autoFocus
                    >
                        {okLabel}
                    </button>
                </div>
            </div>
        </div>,
        document.getElementById("main")
    );
};

AlertModal.displayName = "AlertModal";

export { AlertModal, showAlert, showErrorAlert };
export type { AlertOptions };
