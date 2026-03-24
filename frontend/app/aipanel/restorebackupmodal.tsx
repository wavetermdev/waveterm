// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Modal } from "@/app/modals/modal";
import { recordTEvent } from "@/app/store/global";
import { useAtomValue } from "jotai";
import { memo } from "react";
import { WaveUIMessagePart } from "./aitypes";
import { WaveAIModel } from "./waveai-model";

interface RestoreBackupModalProps {
    part: WaveUIMessagePart & { type: "data-tooluse" };
}

export const RestoreBackupModal = memo(({ part }: RestoreBackupModalProps) => {
    const model = WaveAIModel.getInstance();
    const toolData = part.data;
    const status = useAtomValue(model.restoreBackupStatus);
    const error = useAtomValue(model.restoreBackupError);

    const formatTimestamp = (ts: number) => {
        if (!ts) return "";
        const date = new Date(ts);
        return date.toLocaleString();
    };

    const handleConfirm = () => {
        recordTEvent("waveai:revertfile", { "waveai:action": "revertfile:confirm" });
        model.restoreBackup(toolData.toolcallid, toolData.writebackupfilename, toolData.inputfilename);
    };

    const handleCancel = () => {
        recordTEvent("waveai:revertfile", { "waveai:action": "revertfile:cancel" });
        model.closeRestoreBackupModal();
    };

    const handleClose = () => {
        model.closeRestoreBackupModal();
    };

    if (status === "success") {
        return (
            <Modal className="restore-backup-modal pb-5 pr-5" onClose={handleClose} onOk={handleClose} okLabel="Close">
                <div className="flex flex-col gap-4 pt-4 pb-4 max-w-xl">
                    <div className="font-semibold text-lg text-green-500">Backup Successfully Restored</div>
                    <div className="text-sm text-gray-300 leading-relaxed">
                        The file <span className="font-mono text-white break-all">{toolData.inputfilename}</span> has
                        been restored to its previous state.
                    </div>
                </div>
            </Modal>
        );
    }

    if (status === "error") {
        return (
            <Modal className="restore-backup-modal pb-5 pr-5" onClose={handleClose} onOk={handleClose} okLabel="Close">
                <div className="flex flex-col gap-4 pt-4 pb-4 max-w-xl">
                    <div className="font-semibold text-lg text-red-500">Failed to Restore Backup</div>
                    <div className="text-sm text-gray-300 leading-relaxed">
                        An error occurred while restoring the backup:
                    </div>
                    <div className="text-sm text-red-400 font-mono bg-zinc-800 p-3 rounded break-all">{error}</div>
                </div>
            </Modal>
        );
    }

    const isProcessing = status === "processing";

    return (
        <Modal
            className="restore-backup-modal pb-5 pr-5"
            onClose={handleCancel}
            onCancel={handleCancel}
            onOk={handleConfirm}
            okLabel={isProcessing ? "Restoring..." : "Confirm Restore"}
            cancelLabel="Cancel"
            okDisabled={isProcessing}
            cancelDisabled={isProcessing}
        >
            <div className="flex flex-col gap-4 pt-4 pb-4 max-w-xl">
                <div className="font-semibold text-lg">Restore File Backup</div>
                <div className="text-sm text-gray-300 leading-relaxed">
                    This will restore <span className="font-mono text-white break-all">{toolData.inputfilename}</span>{" "}
                    to its state before this edit was made
                    {toolData.runts && <span> ({formatTimestamp(toolData.runts)})</span>}.
                </div>
                <div className="text-sm text-gray-300 leading-relaxed">
                    Any changes made by this edit and subsequent edits will be lost.
                </div>
            </div>
        </Modal>
    );
});

RestoreBackupModal.displayName = "RestoreBackupModal";