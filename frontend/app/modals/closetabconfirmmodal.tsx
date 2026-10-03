// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Modal } from "@/app/modals/modal";
import { modalsModel } from "@/app/store/modalmodel";
import { useState } from "react";

type CloseTabConfirmModalProps = {
    onCancel: () => void;
    onConfirm: (dontAskAgain: boolean) => void | Promise<void>;
};

const CloseTabConfirmModal = ({ onCancel, onConfirm }: CloseTabConfirmModalProps) => {
    const [dontAskAgain, setDontAskAgain] = useState(false);

    const handleCancel = () => {
        modalsModel.popModal();
        onCancel();
    };

    const handleConfirm = () => {
        modalsModel.popModal();
        onConfirm(dontAskAgain);
    };

    return (
        <Modal
            className="pt-6 pb-4 px-5 w-[420px]"
            onOk={handleConfirm}
            onCancel={handleCancel}
            onClose={handleCancel}
            okLabel="Close Tab"
            cancelLabel="Cancel"
        >
            <div className="mx-4 pb-2.5 font-bold text-primary">Close Tab?</div>
            <div className="mx-4 mb-4 flex flex-col gap-4 text-primary">
                <div className="text-sm text-secondary">Are you sure you want to close this tab?</div>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                        type="checkbox"
                        className="accent-accent cursor-pointer"
                        checked={dontAskAgain}
                        onChange={(e) => setDontAskAgain(e.target.checked)}
                    />
                    <span>Do not ask me again</span>
                </label>
            </div>
        </Modal>
    );
};

CloseTabConfirmModal.displayName = "CloseTabConfirmModal";

export { CloseTabConfirmModal };
