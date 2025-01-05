// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Modal } from "@/app/modals/modal";
import { modalsModel } from "@/app/store/modalmodel";

import { ReactNode } from "react";
import "./messagemodal.scss";

const MessageModal = ({ children }: { children: ReactNode }) => {
    function closeModal() {
        modalsModel.popModal();
    }

    return (
        <Modal className="message-modal" onOk={() => closeModal()} onClose={() => closeModal()}>
            {children}
        </Modal>
    );
};

MessageModal.displayName = "MessageModal";

export { MessageModal };
