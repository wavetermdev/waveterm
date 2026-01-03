// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Modal } from "@/app/modals/modal";
import { deleteLayoutModelForTab } from "@/layout/index";
import { atoms, getApi, globalStore } from "@/store/global";
import { modalsModel } from "@/store/modalmodel";

interface ConfirmCloseTabModalProps {
    tabId: string;
}

const ConfirmCloseTabModal = ({ tabId }: ConfirmCloseTabModalProps) => {
    const handleConfirmClose = () => {
        const ws = globalStore.get(atoms.workspace);
        if (!ws) {
            modalsModel.popModal();
            return;
        }
        getApi().closeTab(ws.oid, tabId);
        deleteLayoutModelForTab(tabId);
        modalsModel.popModal();
    };

    const handleCancel = () => {
        modalsModel.popModal();
    };

    return (
        <Modal onOk={handleConfirmClose} onCancel={handleCancel} onClose={handleCancel}>
            <div className="content">
                <div className="modal-title">Close Tab?</div>
                <div style={{ marginTop: "10px" }}>
                    Are you sure you want to close this tab? This action cannot be undone.
                </div>
            </div>
        </Modal>
    );
};

ConfirmCloseTabModal.displayName = "ConfirmCloseTabModal";

export { ConfirmCloseTabModal };
