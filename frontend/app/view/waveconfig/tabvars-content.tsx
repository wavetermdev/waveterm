// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getApi } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { base64ToString, cn, stringToBase64 } from "@/util/util";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

import "./tabvars-content.scss";

// Regex for validating preset names (the part after "tabvar@")
const PresetNameRegex = /^[a-zA-Z0-9_-]+$/;

// Type for a tab variable preset
interface TabVarPreset {
    "tab:basedir"?: string;
    "tab:basedirlock"?: boolean;
    "display:name"?: string;
    "display:order"?: number;
}

// Type for the full presets file structure
interface TabVarsData {
    [key: string]: TabVarPreset;
}

interface ErrorDisplayProps {
    message: string;
    variant?: "error" | "warning";
}

const ErrorDisplay = memo(({ message, variant = "error" }: ErrorDisplayProps) => {
    const icon = variant === "error" ? "fa-circle-exclamation" : "fa-triangle-exclamation";
    const baseClasses = "flex items-center gap-2 p-4 border rounded-lg";
    const variantClasses =
        variant === "error"
            ? "bg-red-500/10 border-red-500/20 text-red-400"
            : "bg-yellow-500/10 border-yellow-500/20 text-yellow-400";

    return (
        <div className={`${baseClasses} ${variantClasses}`}>
            <i className={`fa-sharp fa-solid ${icon}`} />
            <span>{message}</span>
        </div>
    );
});
ErrorDisplay.displayName = "ErrorDisplay";

const LoadingSpinner = memo(({ message }: { message: string }) => {
    return (
        <div className="flex flex-col items-center justify-center gap-3 py-12">
            <i className="fa-sharp fa-solid fa-spinner fa-spin text-2xl text-zinc-400" />
            <span className="text-zinc-400">{message}</span>
        </div>
    );
});
LoadingSpinner.displayName = "LoadingSpinner";

const EmptyState = memo(({ onAddPreset }: { onAddPreset: () => void }) => {
    return (
        <div className="tabvars-empty-state">
            <i className="fa-sharp fa-solid fa-folder-tree" />
            <h3>No Tab Variable Presets</h3>
            <p>Create presets to quickly set up tab base directories for your projects</p>
            <button className="tabvars-add-button" onClick={onAddPreset}>
                <i className="fa-sharp fa-solid fa-plus" />
                <span>Add New Preset</span>
            </button>
        </div>
    );
});
EmptyState.displayName = "EmptyState";

const InfoBubble = memo(() => {
    return (
        <div className="tabvars-info-bubble">
            <div className="tabvars-info-header">
                <i className="fa-sharp fa-solid fa-circle-info" />
                <div className="tabvars-info-title">Tab Variables</div>
            </div>
            <div className="tabvars-info-content">
                Tab variable presets allow you to define named directory configurations that can be
                applied to tabs. Right-click any tab and select "Apply Preset" to use them.
            </div>
        </div>
    );
});
InfoBubble.displayName = "InfoBubble";

interface PresetListViewProps {
    presets: { key: string; data: TabVarPreset }[];
    onSelectPreset: (key: string) => void;
    onAddPreset: () => void;
}

const PresetListView = memo(({ presets, onSelectPreset, onAddPreset }: PresetListViewProps) => {
    return (
        <div className="tabvars-list-container">
            <div className="tabvars-list">
                {presets.map(({ key, data }) => {
                    const displayName = data["display:name"] || key.replace("tabvar@", "");
                    const basedir = data["tab:basedir"];
                    const isLocked = data["tab:basedirlock"];

                    return (
                        <div
                            key={key}
                            className="tabvars-list-item"
                            onClick={() => onSelectPreset(key)}
                        >
                            <div className="tabvars-list-item-icon">
                                <i className="fa-sharp fa-solid fa-folder-tree" />
                            </div>
                            <div className="tabvars-list-item-content">
                                <div className="tabvars-list-item-name">
                                    {displayName}
                                    {isLocked && (
                                        <i
                                            className="fa-sharp fa-solid fa-lock tabvars-lock-icon"
                                            title="Auto-detection locked"
                                        />
                                    )}
                                </div>
                                {basedir && (
                                    <div className="tabvars-list-item-path">{basedir}</div>
                                )}
                            </div>
                            <i className="fa-sharp fa-solid fa-chevron-right tabvars-list-item-arrow" />
                        </div>
                    );
                })}
                <div className="tabvars-list-add" onClick={onAddPreset}>
                    <i className="fa-sharp fa-solid fa-plus" />
                    <span>Add New Preset</span>
                </div>
            </div>
            <InfoBubble />
        </div>
    );
});
PresetListView.displayName = "PresetListView";

interface AddPresetFormProps {
    isLoading: boolean;
    onCancel: () => void;
    onSubmit: (presetName: string, data: TabVarPreset) => void;
}

const AddPresetForm = memo(({ isLoading, onCancel, onSubmit }: AddPresetFormProps) => {
    const [presetName, setPresetName] = useState("");
    const [displayName, setDisplayName] = useState("");
    const [basedir, setBasedir] = useState("");
    const [basedirLock, setBasedirLock] = useState(false);
    const [displayOrder, setDisplayOrder] = useState("");

    const isNameInvalid = presetName !== "" && !PresetNameRegex.test(presetName);
    const isDisplayNameTooLong = displayName.length > 256;

    const handleBrowseDirectory = useCallback(async () => {
        const result = await getApi().showOpenDialog({
            title: "Select Base Directory",
            defaultPath: basedir || "~",
            properties: ["openDirectory"],
        });
        if (result && result.length > 0) {
            setBasedir(result[0]);
        }
    }, [basedir]);

    const handleSubmit = useCallback(() => {
        const data: TabVarPreset = {};
        if (basedir) {
            data["tab:basedir"] = basedir;
        }
        if (basedirLock) {
            data["tab:basedirlock"] = true;
        }
        if (displayName) {
            data["display:name"] = displayName;
        }
        if (displayOrder && !isNaN(Number(displayOrder))) {
            data["display:order"] = Number(displayOrder);
        }
        onSubmit(presetName, data);
    }, [presetName, displayName, basedir, basedirLock, displayOrder, onSubmit]);

    const canSubmit =
        presetName.trim() !== "" && !isNameInvalid && !isDisplayNameTooLong && !isLoading;

    return (
        <div className="tabvars-form">
            <h3 className="tabvars-form-title">Add New Preset</h3>

            <div className="tabvars-form-field">
                <label className="tabvars-form-label">Preset ID</label>
                <div className="tabvars-form-input-wrapper">
                    <span className="tabvars-form-prefix">tabvar@</span>
                    <input
                        type="text"
                        className={cn("tabvars-form-input", {
                            "tabvars-form-input-error": isNameInvalid,
                        })}
                        value={presetName}
                        onChange={(e) => setPresetName(e.target.value)}
                        placeholder="my-project"
                        disabled={isLoading}
                    />
                </div>
                <div className="tabvars-form-hint">
                    Letters, numbers, underscores, and hyphens only
                </div>
            </div>

            <div className="tabvars-form-field">
                <label className="tabvars-form-label">Display Name</label>
                <input
                    type="text"
                    className={cn("tabvars-form-input tabvars-form-input-full", {
                        "tabvars-form-input-error": isDisplayNameTooLong,
                    })}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="My Project"
                    disabled={isLoading}
                />
                <div className="tabvars-form-hint">
                    Friendly name shown in menus (optional, max 256 chars)
                </div>
            </div>

            <div className="tabvars-form-field">
                <label className="tabvars-form-label">Base Directory</label>
                <div className="tabvars-form-directory">
                    <input
                        type="text"
                        className="tabvars-form-input tabvars-form-input-full"
                        value={basedir}
                        onChange={(e) => setBasedir(e.target.value)}
                        placeholder="/path/to/project"
                        disabled={isLoading}
                    />
                    <button
                        className="tabvars-browse-button"
                        onClick={handleBrowseDirectory}
                        disabled={isLoading}
                        type="button"
                    >
                        <i className="fa-sharp fa-solid fa-folder-open" />
                        Browse
                    </button>
                </div>
                <div className="tabvars-form-hint">Absolute path to the project directory</div>
            </div>

            <div className="tabvars-form-field">
                <label className="tabvars-form-checkbox-label">
                    <input
                        type="checkbox"
                        checked={basedirLock}
                        onChange={(e) => setBasedirLock(e.target.checked)}
                        disabled={isLoading}
                    />
                    <span>Lock base directory</span>
                </label>
                <div className="tabvars-form-hint">
                    Prevents OSC 7 auto-detection from updating the directory
                </div>
            </div>

            <div className="tabvars-form-field">
                <label className="tabvars-form-label">Display Order</label>
                <input
                    type="number"
                    className="tabvars-form-input tabvars-form-input-small"
                    value={displayOrder}
                    onChange={(e) => setDisplayOrder(e.target.value)}
                    placeholder="0"
                    disabled={isLoading}
                />
                <div className="tabvars-form-hint">Lower numbers appear first in menus</div>
            </div>

            <div className="tabvars-form-actions">
                <button
                    className="tabvars-button tabvars-button-secondary"
                    onClick={onCancel}
                    disabled={isLoading}
                >
                    Cancel
                </button>
                <button
                    className="tabvars-button tabvars-button-primary"
                    onClick={handleSubmit}
                    disabled={!canSubmit}
                >
                    {isLoading ? (
                        <>
                            <i className="fa-sharp fa-solid fa-spinner fa-spin" />
                            Adding...
                        </>
                    ) : (
                        "Add Preset"
                    )}
                </button>
            </div>
        </div>
    );
});
AddPresetForm.displayName = "AddPresetForm";

interface EditPresetFormProps {
    presetKey: string;
    presetData: TabVarPreset;
    isLoading: boolean;
    onCancel: () => void;
    onSave: (data: TabVarPreset) => void;
    onDelete: () => void;
}

const EditPresetForm = memo(
    ({ presetKey, presetData, isLoading, onCancel, onSave, onDelete }: EditPresetFormProps) => {
        const [displayName, setDisplayName] = useState(presetData["display:name"] || "");
        const [basedir, setBasedir] = useState(presetData["tab:basedir"] || "");
        const [basedirLock, setBasedirLock] = useState(presetData["tab:basedirlock"] || false);
        const [displayOrder, setDisplayOrder] = useState(
            presetData["display:order"]?.toString() || ""
        );
        const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

        const isDisplayNameTooLong = displayName.length > 256;

        const handleBrowseDirectory = useCallback(async () => {
            const result = await getApi().showOpenDialog({
                title: "Select Base Directory",
                defaultPath: basedir || "~",
                properties: ["openDirectory"],
            });
            if (result && result.length > 0) {
                setBasedir(result[0]);
            }
        }, [basedir]);

        const handleSave = useCallback(() => {
            const data: TabVarPreset = {};
            if (basedir) {
                data["tab:basedir"] = basedir;
            }
            if (basedirLock) {
                data["tab:basedirlock"] = true;
            }
            if (displayName) {
                data["display:name"] = displayName;
            }
            if (displayOrder && !isNaN(Number(displayOrder))) {
                data["display:order"] = Number(displayOrder);
            }
            onSave(data);
        }, [displayName, basedir, basedirLock, displayOrder, onSave]);

        const handleDeleteClick = useCallback(() => {
            setShowDeleteConfirm(true);
        }, []);

        const handleConfirmDelete = useCallback(() => {
            onDelete();
        }, [onDelete]);

        const handleCancelDelete = useCallback(() => {
            setShowDeleteConfirm(false);
        }, []);

        return (
            <div className="tabvars-form">
                <div className="tabvars-form-header">
                    <i className="fa-sharp fa-solid fa-folder-tree" />
                    <h3 className="tabvars-form-title">{presetKey}</h3>
                </div>

                <div className="tabvars-form-field">
                    <label className="tabvars-form-label">Display Name</label>
                    <input
                        type="text"
                        className={cn("tabvars-form-input tabvars-form-input-full", {
                            "tabvars-form-input-error": isDisplayNameTooLong,
                        })}
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="My Project"
                        disabled={isLoading}
                    />
                    <div className="tabvars-form-hint">
                        Friendly name shown in menus (max 256 chars)
                    </div>
                </div>

                <div className="tabvars-form-field">
                    <label className="tabvars-form-label">Base Directory</label>
                    <div className="tabvars-form-directory">
                        <input
                            type="text"
                            className="tabvars-form-input tabvars-form-input-full"
                            value={basedir}
                            onChange={(e) => setBasedir(e.target.value)}
                            placeholder="/path/to/project"
                            disabled={isLoading}
                        />
                        <button
                            className="tabvars-browse-button"
                            onClick={handleBrowseDirectory}
                            disabled={isLoading}
                            type="button"
                        >
                            <i className="fa-sharp fa-solid fa-folder-open" />
                            Browse
                        </button>
                    </div>
                    <div className="tabvars-form-hint">Absolute path to the project directory</div>
                </div>

                <div className="tabvars-form-field">
                    <label className="tabvars-form-checkbox-label">
                        <input
                            type="checkbox"
                            checked={basedirLock}
                            onChange={(e) => setBasedirLock(e.target.checked)}
                            disabled={isLoading}
                        />
                        <span>Lock base directory</span>
                    </label>
                    <div className="tabvars-form-hint">
                        Prevents OSC 7 auto-detection from updating the directory
                    </div>
                </div>

                <div className="tabvars-form-field">
                    <label className="tabvars-form-label">Display Order</label>
                    <input
                        type="number"
                        className="tabvars-form-input tabvars-form-input-small"
                        value={displayOrder}
                        onChange={(e) => setDisplayOrder(e.target.value)}
                        placeholder="0"
                        disabled={isLoading}
                    />
                    <div className="tabvars-form-hint">Lower numbers appear first in menus</div>
                </div>

                {showDeleteConfirm ? (
                    <div className="tabvars-delete-confirm">
                        <div className="tabvars-delete-confirm-text">
                            <i className="fa-sharp fa-solid fa-triangle-exclamation" />
                            <span>
                                Delete <strong>{presetKey}</strong>? This cannot be undone.
                            </span>
                        </div>
                        <div className="tabvars-delete-confirm-actions">
                            <button
                                className="tabvars-button tabvars-button-secondary"
                                onClick={handleCancelDelete}
                                disabled={isLoading}
                            >
                                Cancel
                            </button>
                            <button
                                className="tabvars-button tabvars-button-danger"
                                onClick={handleConfirmDelete}
                                disabled={isLoading}
                            >
                                {isLoading ? (
                                    <>
                                        <i className="fa-sharp fa-solid fa-spinner fa-spin" />
                                        Deleting...
                                    </>
                                ) : (
                                    <>
                                        <i className="fa-sharp fa-solid fa-trash" />
                                        Delete
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="tabvars-form-actions tabvars-form-actions-spread">
                        <button
                            className="tabvars-button tabvars-button-danger-outline"
                            onClick={handleDeleteClick}
                            disabled={isLoading}
                        >
                            <i className="fa-sharp fa-solid fa-trash" />
                            Delete
                        </button>
                        <div className="tabvars-form-actions">
                            <button
                                className="tabvars-button tabvars-button-secondary"
                                onClick={onCancel}
                                disabled={isLoading}
                            >
                                Cancel
                            </button>
                            <button
                                className="tabvars-button tabvars-button-primary"
                                onClick={handleSave}
                                disabled={isLoading || isDisplayNameTooLong}
                            >
                                {isLoading ? (
                                    <>
                                        <i className="fa-sharp fa-solid fa-spinner fa-spin" />
                                        Saving...
                                    </>
                                ) : (
                                    "Save"
                                )}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        );
    }
);
EditPresetForm.displayName = "EditPresetForm";

interface TabVarsContentProps {
    model: WaveConfigViewModel;
}

export const TabVarsContent = memo(({ model }: TabVarsContentProps) => {
    const [presetsData, setPresetsData] = useState<TabVarsData>({});
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [isAddingNew, setIsAddingNew] = useState(false);
    const [selectedPreset, setSelectedPreset] = useState<string | null>(null);

    // Load presets data
    const loadPresets = useCallback(async () => {
        setIsLoading(true);
        setErrorMessage(null);

        try {
            const fullPath = `${model.configDir}/presets/tabvars.json`;
            const fileData = await RpcApi.FileReadCommand(TabRpcClient, {
                info: { path: fullPath },
            });
            const content = fileData?.data64 ? base64ToString(fileData.data64) : "";

            if (content.trim() === "") {
                setPresetsData({});
            } else {
                const parsed = JSON.parse(content);
                setPresetsData(parsed);
            }
        } catch (err: any) {
            // File not found is OK - just means no presets yet
            if (err.message?.includes("not found") || err.message?.includes("ENOENT")) {
                setPresetsData({});
            } else {
                setErrorMessage(`Failed to load presets: ${err.message || String(err)}`);
            }
        } finally {
            setIsLoading(false);
        }
    }, [model.configDir]);

    // Save presets data
    const savePresets = useCallback(
        async (data: TabVarsData) => {
            setIsSaving(true);
            setErrorMessage(null);

            try {
                const fullPath = `${model.configDir}/presets/tabvars.json`;
                const formatted = JSON.stringify(data, null, 2);
                await RpcApi.FileWriteCommand(TabRpcClient, {
                    info: { path: fullPath },
                    data64: stringToBase64(formatted),
                });
                setPresetsData(data);
            } catch (err: any) {
                setErrorMessage(`Failed to save presets: ${err.message || String(err)}`);
            } finally {
                setIsSaving(false);
            }
        },
        [model.configDir]
    );

    // Initial load
    useEffect(() => {
        loadPresets();
    }, [loadPresets]);

    // Sort presets by display:order, then by name
    const sortedPresets = useMemo(() => {
        return Object.entries(presetsData)
            .map(([key, data]) => ({ key, data }))
            .sort((a, b) => {
                const orderA = a.data["display:order"] ?? Infinity;
                const orderB = b.data["display:order"] ?? Infinity;
                if (orderA !== orderB) {
                    return orderA - orderB;
                }
                return a.key.localeCompare(b.key);
            });
    }, [presetsData]);

    // Handlers
    const handleSelectPreset = useCallback((key: string) => {
        setSelectedPreset(key);
        setIsAddingNew(false);
    }, []);

    const handleStartAddingPreset = useCallback(() => {
        setIsAddingNew(true);
        setSelectedPreset(null);
    }, []);

    const handleCancelAdd = useCallback(() => {
        setIsAddingNew(false);
    }, []);

    const handleCancelEdit = useCallback(() => {
        setSelectedPreset(null);
    }, []);

    const handleAddPreset = useCallback(
        async (presetName: string, data: TabVarPreset) => {
            const fullKey = `tabvar@${presetName}`;

            // Check for duplicates
            if (presetsData[fullKey]) {
                setErrorMessage(`Preset "${fullKey}" already exists`);
                return;
            }

            const newData = { ...presetsData, [fullKey]: data };
            await savePresets(newData);

            if (!errorMessage) {
                setIsAddingNew(false);
            }
        },
        [presetsData, savePresets, errorMessage]
    );

    const handleSavePreset = useCallback(
        async (data: TabVarPreset) => {
            if (!selectedPreset) return;

            const newData = { ...presetsData, [selectedPreset]: data };
            await savePresets(newData);

            if (!errorMessage) {
                setSelectedPreset(null);
            }
        },
        [selectedPreset, presetsData, savePresets, errorMessage]
    );

    const handleDeletePreset = useCallback(async () => {
        if (!selectedPreset) return;

        const newData = { ...presetsData };
        delete newData[selectedPreset];
        await savePresets(newData);

        if (!errorMessage) {
            setSelectedPreset(null);
        }
    }, [selectedPreset, presetsData, savePresets, errorMessage]);

    // Render content
    const renderContent = () => {
        if (isAddingNew) {
            return (
                <AddPresetForm
                    isLoading={isSaving}
                    onCancel={handleCancelAdd}
                    onSubmit={handleAddPreset}
                />
            );
        }

        if (selectedPreset && presetsData[selectedPreset]) {
            return (
                <EditPresetForm
                    presetKey={selectedPreset}
                    presetData={presetsData[selectedPreset]}
                    isLoading={isSaving}
                    onCancel={handleCancelEdit}
                    onSave={handleSavePreset}
                    onDelete={handleDeletePreset}
                />
            );
        }

        if (sortedPresets.length === 0) {
            return <EmptyState onAddPreset={handleStartAddingPreset} />;
        }

        return (
            <PresetListView
                presets={sortedPresets}
                onSelectPreset={handleSelectPreset}
                onAddPreset={handleStartAddingPreset}
            />
        );
    };

    if (isLoading && Object.keys(presetsData).length === 0) {
        return (
            <div className="tabvars-content">
                <LoadingSpinner message="Loading presets..." />
            </div>
        );
    }

    return (
        <div className="tabvars-content">
            {errorMessage && (
                <div className="tabvars-error-container">
                    <ErrorDisplay message={errorMessage} />
                    <button
                        className="tabvars-error-dismiss"
                        onClick={() => setErrorMessage(null)}
                    >
                        <i className="fa-sharp fa-solid fa-times" />
                    </button>
                </div>
            )}
            {renderContent()}
        </div>
    );
});

TabVarsContent.displayName = "TabVarsContent";
