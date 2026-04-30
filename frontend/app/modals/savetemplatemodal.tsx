// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Modal } from "@/app/modals/modal";
import { modalsModel } from "@/store/modalmodel";
import * as keyutil from "@/util/keyutil";
import { fireAndForget } from "@/util/util";
import { useCallback, useState } from "react";
import { TabTemplateService } from "../store/services";

interface SaveTemplateModalProps {
    tabId: string;
}

const SaveTemplateModal = ({ tabId }: SaveTemplateModalProps) => {
    const [templateName, setTemplateName] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleClose = useCallback(() => {
        modalsModel.popModal();
    }, []);

    const handleSave = useCallback(() => {
        if (!templateName.trim()) {
            setError("Please enter a template name");
            return;
        }
        setSaving(true);
        setError(null);
        fireAndForget(async () => {
            try {
                await TabTemplateService.SaveTabAsTemplate(tabId, templateName.trim());
                modalsModel.popModal();
            } catch (e) {
                setError(e.message || "Failed to save template");
                setSaving(false);
            }
        });
    }, [tabId, templateName]);

    const handleKeyDown = useCallback(
        (waveEvent: WaveKeyboardEvent): boolean => {
            if (keyutil.checkKeyPressed(waveEvent, "Escape")) {
                handleClose();
                return true;
            }
            if (keyutil.checkKeyPressed(waveEvent, "Enter")) {
                handleSave();
                return true;
            }
            return false;
        },
        [handleClose, handleSave]
    );

    return (
        <Modal
            className="pt-6 pb-4 px-5"
            onOk={handleSave}
            onCancel={handleClose}
            onClose={handleClose}
            okLabel={saving ? "Saving..." : "Save"}
            cancelLabel="Cancel"
            okDisabled={saving || !templateName.trim()}
        >
            <div className="font-bold text-primary mx-4 pb-2.5">Save Tab as Template</div>
            <div className="flex flex-col gap-4 mx-4 mb-4 max-w-[400px]">
                <div className="text-secondary text-sm">
                    Save this tab's layout and block configuration as a reusable template.
                </div>
                <input
                    type="text"
                    placeholder="Template name"
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    className="resize-none bg-panel rounded-md border border-border py-1.5 pl-4 min-h-[30px] text-inherit cursor-text focus:ring-2 focus:ring-accent focus:outline-none"
                    autoFocus
                    onKeyDown={(e) => keyutil.keydownWrapper(handleKeyDown)(e)}
                    disabled={saving}
                />
                {error && <div className="text-red-500 text-sm">{error}</div>}
            </div>
        </Modal>
    );
};

SaveTemplateModal.displayName = "SaveTemplateModal";

export { SaveTemplateModal };
