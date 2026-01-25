// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Action Buttons
 *
 * Save/Cancel buttons for the OMP Configurator.
 */

import { memo, useCallback, useEffect, useState } from "react";

interface ActionButtonsProps {
    hasChanges: boolean;
    saving: boolean;
    onSave: () => void;
    onCancel: () => void;
}

interface CancelConfirmDialogProps {
    isOpen: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

const CancelConfirmDialog = memo(({ isOpen, onConfirm, onCancel }: CancelConfirmDialogProps) => {
    if (!isOpen) return null;

    const handleKeyDown = useCallback(
        (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                onCancel();
            }
        },
        [onCancel]
    );

    useEffect(() => {
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [handleKeyDown]);

    return (
        <div className="confirm-dialog-overlay" onClick={onCancel}>
            <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
                <div className="dialog-header">
                    <i className="fa fa-solid fa-exclamation-triangle" />
                    <span>Discard Changes?</span>
                </div>
                <div className="dialog-body">
                    You have unsaved changes. Are you sure you want to discard them?
                </div>
                <div className="dialog-actions">
                    <button className="btn-secondary" onClick={onCancel}>
                        Keep Editing
                    </button>
                    <button className="btn-danger" onClick={onConfirm}>
                        Discard Changes
                    </button>
                </div>
            </div>
        </div>
    );
});

CancelConfirmDialog.displayName = "CancelConfirmDialog";

export const ActionButtons = memo(({ hasChanges, saving, onSave, onCancel }: ActionButtonsProps) => {
    const [showConfirm, setShowConfirm] = useState(false);

    const handleCancel = useCallback(() => {
        if (hasChanges) {
            setShowConfirm(true);
        } else {
            onCancel();
        }
    }, [hasChanges, onCancel]);

    const handleConfirmDiscard = useCallback(() => {
        setShowConfirm(false);
        onCancel();
    }, [onCancel]);

    const handleKeepEditing = useCallback(() => {
        setShowConfirm(false);
    }, []);

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Ctrl/Cmd + S to save
            if ((e.ctrlKey || e.metaKey) && e.key === "s") {
                e.preventDefault();
                if (hasChanges && !saving) {
                    onSave();
                }
            }

            // Escape to cancel (if not in confirm dialog)
            if (e.key === "Escape" && !showConfirm) {
                e.preventDefault();
                handleCancel();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [hasChanges, saving, onSave, handleCancel, showConfirm]);

    return (
        <>
            <div className="omp-action-buttons">
                <button className="btn-secondary" onClick={handleCancel} disabled={saving}>
                    <i className="fa fa-solid fa-times" />
                    <span>Cancel</span>
                </button>
                <button className="btn-primary" onClick={onSave} disabled={!hasChanges || saving}>
                    {saving ? (
                        <>
                            <i className="fa fa-solid fa-spinner fa-spin" />
                            <span>Saving...</span>
                        </>
                    ) : (
                        <>
                            <i className="fa fa-solid fa-check" />
                            <span>Save</span>
                        </>
                    )}
                </button>
            </div>
            <CancelConfirmDialog
                isOpen={showConfirm}
                onConfirm={handleConfirmDiscard}
                onCancel={handleKeepEditing}
            />
        </>
    );
});

ActionButtons.displayName = "ActionButtons";

export { ActionButtons };
