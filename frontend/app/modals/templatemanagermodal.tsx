// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { Modal } from "@/app/modals/modal";
import { modalsModel } from "@/store/modalmodel";
import * as keyutil from "@/util/keyutil";
import { fireAndForget } from "@/util/util";
import { useCallback, useEffect, useState } from "react";
import { TabTemplateService } from "../store/services";

interface TemplateManagerModalProps {}

const TemplateManagerModal = ({}: TemplateManagerModalProps) => {
    const [templates, setTemplates] = useState<TabTemplate[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState("");
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

    const loadTemplates = useCallback(async () => {
        try {
            const result = await TabTemplateService.ListTabTemplates();
            setTemplates(result || []);
        } catch (e) {
            console.error("Failed to load templates:", e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadTemplates();
    }, [loadTemplates]);

    const handleClose = useCallback(() => {
        modalsModel.popModal();
    }, []);

    const handleStartEdit = useCallback((template: TabTemplate) => {
        setEditingId(template.oid);
        setEditingName(template.name);
        setDeleteConfirmId(null);
    }, []);

    const handleSaveEdit = useCallback(async () => {
        if (!editingId || !editingName.trim()) return;
        try {
            await TabTemplateService.UpdateTabTemplate(editingId, editingName.trim());
            setEditingId(null);
            setEditingName("");
            loadTemplates();
        } catch (e) {
            console.error("Failed to update template:", e);
        }
    }, [editingId, editingName, loadTemplates]);

    const handleCancelEdit = useCallback(() => {
        setEditingId(null);
        setEditingName("");
    }, []);

    const handleDeleteClick = useCallback((templateId: string) => {
        setDeleteConfirmId(templateId);
        setEditingId(null);
    }, []);

    const handleConfirmDelete = useCallback(
        async (templateId: string) => {
            try {
                await TabTemplateService.DeleteTabTemplate(templateId);
                setDeleteConfirmId(null);
                loadTemplates();
            } catch (e) {
                console.error("Failed to delete template:", e);
            }
        },
        [loadTemplates]
    );

    const handleCancelDelete = useCallback(() => {
        setDeleteConfirmId(null);
    }, []);

    const handleKeyDown = useCallback(
        (waveEvent: WaveKeyboardEvent): boolean => {
            if (keyutil.checkKeyPressed(waveEvent, "Escape")) {
                if (editingId) {
                    handleCancelEdit();
                } else if (deleteConfirmId) {
                    handleCancelDelete();
                } else {
                    handleClose();
                }
                return true;
            }
            if (keyutil.checkKeyPressed(waveEvent, "Enter") && editingId) {
                handleSaveEdit();
                return true;
            }
            return false;
        },
        [editingId, deleteConfirmId, handleCancelEdit, handleCancelDelete, handleClose, handleSaveEdit]
    );

    return (
        <Modal className="pt-6 pb-4 px-5 min-w-[450px]" onClose={handleClose}>
            <div className="font-bold text-primary mx-4 pb-2.5">Manage Tab Templates</div>
            <div className="flex flex-col gap-2 mx-4 mb-4 max-h-[400px] overflow-y-auto">
                {loading && <div className="text-secondary text-sm">Loading templates...</div>}
                {!loading && templates.length === 0 && (
                    <div className="text-secondary text-sm py-4 text-center">
                        No templates saved yet. Right-click a tab and select "Save as Template" to create one.
                    </div>
                )}
                {!loading &&
                    templates.map((template) => (
                        <div
                            key={template.oid}
                            className="flex items-center justify-between p-2 rounded-md bg-panel hover:bg-hoverbg"
                        >
                            {editingId === template.oid ? (
                                <input
                                    type="text"
                                    value={editingName}
                                    onChange={(e) => setEditingName(e.target.value)}
                                    className="flex-1 bg-transparent border border-border rounded px-2 py-1 text-inherit focus:outline-none focus:ring-1 focus:ring-accent"
                                    autoFocus
                                    onKeyDown={(e) => keyutil.keydownWrapper(handleKeyDown)(e)}
                                    onBlur={handleSaveEdit}
                                />
                            ) : (
                                <span className="flex-1 text-primary">{template.name}</span>
                            )}
                            <div className="flex items-center gap-2 ml-2">
                                {deleteConfirmId === template.oid ? (
                                    <>
                                        <span className="text-sm text-secondary mr-2">Delete?</span>
                                        <Button
                                            className="ghost text-sm"
                                            onClick={() => handleConfirmDelete(template.oid)}
                                        >
                                            Yes
                                        </Button>
                                        <Button className="ghost text-sm" onClick={handleCancelDelete}>
                                            No
                                        </Button>
                                    </>
                                ) : (
                                    <>
                                        <Button
                                            className="ghost text-sm"
                                            onClick={() => handleStartEdit(template)}
                                            title="Rename"
                                        >
                                            <i className="fa fa-pencil" />
                                        </Button>
                                        <Button
                                            className="ghost text-sm text-red-400 hover:text-red-300"
                                            onClick={() => handleDeleteClick(template.oid)}
                                            title="Delete"
                                        >
                                            <i className="fa fa-trash" />
                                        </Button>
                                    </>
                                )}
                            </div>
                        </div>
                    ))}
            </div>
            <div className="flex justify-end mx-4">
                <Button className="grey ghost" onClick={handleClose}>
                    Close
                </Button>
            </div>
        </Modal>
    );
};

TemplateManagerModal.displayName = "TemplateManagerModal";

export { TemplateManagerModal };
