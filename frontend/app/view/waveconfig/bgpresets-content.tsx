// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Background Presets Visual Content
 *
 * Provides a visual interface for managing tab background presets (bg@*).
 * Features:
 * - Grid view of all presets with live CSS preview
 * - Add new preset with color/gradient/URL input
 * - Edit existing presets
 * - Opacity slider with live preview
 * - Blend mode dropdown
 * - Delete functionality
 */

import { ColorControl } from "@/app/element/settings/color-control";
import { SelectControl, type SelectOption } from "@/app/element/settings/select-control";
import { SliderControl } from "@/app/element/settings/slider-control";
import { TextControl } from "@/app/element/settings/text-control";
import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { getApi } from "@/app/store/global";
import { base64ToString, stringToBase64 } from "@/util/util";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

import "./bgpresets-content.scss";

// Regex for validating preset names: bg@[a-zA-Z0-9_-]+
const BgPresetNameRegex = /^bg@[a-zA-Z0-9_-]+$/;

// Available blend modes
const BLEND_MODE_OPTIONS: SelectOption[] = [
    { value: "", label: "None" },
    { value: "normal", label: "Normal" },
    { value: "multiply", label: "Multiply" },
    { value: "screen", label: "Screen" },
    { value: "overlay", label: "Overlay" },
    { value: "darken", label: "Darken" },
    { value: "lighten", label: "Lighten" },
    { value: "color-dodge", label: "Color Dodge" },
    { value: "color-burn", label: "Color Burn" },
    { value: "hard-light", label: "Hard Light" },
    { value: "soft-light", label: "Soft Light" },
];

// Background type options for the input selector
type BgType = "color" | "gradient" | "url";

interface BgPreset {
    bg?: string;
    "bg:opacity"?: number;
    "bg:blendmode"?: string;
    "bg:bordercolor"?: string;
    "bg:activebordercolor"?: string;
    "display:name"?: string;
    "display:order"?: number;
}

interface BgPresetsData {
    [key: string]: BgPreset;
}

// Helper to determine background type from value
function detectBgType(bg: string | undefined): BgType {
    if (!bg) return "color";
    if (bg.startsWith("url(")) return "url";
    if (bg.includes("gradient")) return "gradient";
    return "color";
}

// Helper to extract color from a simple color value
function extractColor(bg: string | undefined): string {
    if (!bg) return "#000000";
    // If it's a hex color, return as-is
    if (/^#[0-9A-Fa-f]{3,6}$/.test(bg)) return bg;
    // For gradients/urls, return black
    return "#000000";
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
        <div className="bgpresets-empty">
            <i className="fa-sharp fa-solid fa-palette" />
            <h3>No Background Presets</h3>
            <p>Add a background preset to customize your tab appearances</p>
            <button className="bgpresets-add-button" onClick={onAddPreset}>
                <i className="fa-sharp fa-solid fa-plus" />
                <span>Add New Preset</span>
            </button>
        </div>
    );
});
EmptyState.displayName = "EmptyState";

interface PresetCardProps {
    presetKey: string;
    preset: BgPreset;
    onSelect: (key: string) => void;
    onDelete: (key: string) => void;
}

const PresetCard = memo(({ presetKey, preset, onSelect, onDelete }: PresetCardProps) => {
    const displayName = preset["display:name"] || presetKey.replace("bg@", "");
    const bgValue = preset.bg || "#333333";
    const opacity = preset["bg:opacity"] ?? 1;
    const blendMode = preset["bg:blendmode"] || "normal";

    // Build preview style
    const previewStyle: React.CSSProperties = {
        background: bgValue,
        opacity: opacity,
        backgroundBlendMode: blendMode as any,
    };

    const handleDeleteClick = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation();
            onDelete(presetKey);
        },
        [presetKey, onDelete]
    );

    return (
        <div className="bgpreset-card" onClick={() => onSelect(presetKey)}>
            <div className="bgpreset-card-preview" style={previewStyle}>
                <div className="bgpreset-card-overlay" />
            </div>
            <div className="bgpreset-card-info">
                <span className="bgpreset-card-name">{displayName}</span>
                <span className="bgpreset-card-key">{presetKey}</span>
            </div>
            <button
                className="bgpreset-card-delete"
                onClick={handleDeleteClick}
                title="Delete preset"
            >
                <i className="fa-sharp fa-solid fa-trash" />
            </button>
        </div>
    );
});
PresetCard.displayName = "PresetCard";

interface PresetGridProps {
    presets: BgPresetsData;
    onSelectPreset: (key: string) => void;
    onDeletePreset: (key: string) => void;
    onAddPreset: () => void;
}

const PresetGrid = memo(({ presets, onSelectPreset, onDeletePreset, onAddPreset }: PresetGridProps) => {
    // Sort presets by display:order, then by key
    const sortedKeys = useMemo(() => {
        return Object.keys(presets).sort((a, b) => {
            const orderA = presets[a]["display:order"] ?? 999;
            const orderB = presets[b]["display:order"] ?? 999;
            if (orderA !== orderB) return orderA - orderB;
            return a.localeCompare(b);
        });
    }, [presets]);

    return (
        <div className="bgpresets-grid-container">
            <div className="bgpresets-grid">
                {sortedKeys.map((key) => (
                    <PresetCard
                        key={key}
                        presetKey={key}
                        preset={presets[key]}
                        onSelect={onSelectPreset}
                        onDelete={onDeletePreset}
                    />
                ))}
                <button className="bgpreset-add-card" onClick={onAddPreset}>
                    <i className="fa-sharp fa-solid fa-plus" />
                    <span>Add Preset</span>
                </button>
            </div>
        </div>
    );
});
PresetGrid.displayName = "PresetGrid";

interface PresetEditorProps {
    presetKey: string | null;
    preset: BgPreset;
    isNew: boolean;
    isLoading: boolean;
    onSave: (key: string, preset: BgPreset) => void;
    onCancel: () => void;
    existingKeys: string[];
}

const PresetEditor = memo(
    ({ presetKey, preset, isNew, isLoading, onSave, onCancel, existingKeys }: PresetEditorProps) => {
        const [newKey, setNewKey] = useState(presetKey || "bg@");
        const [bg, setBg] = useState(preset.bg || "");
        const [bgType, setBgType] = useState<BgType>(detectBgType(preset.bg));
        const [opacity, setOpacity] = useState(preset["bg:opacity"] ?? 1);
        const [blendMode, setBlendMode] = useState(preset["bg:blendmode"] || "");
        const [borderColor, setBorderColor] = useState(preset["bg:bordercolor"] || "");
        const [activeBorderColor, setActiveBorderColor] = useState(preset["bg:activebordercolor"] || "");
        const [displayName, setDisplayName] = useState(preset["display:name"] || "");
        const [displayOrder, setDisplayOrder] = useState(preset["display:order"]?.toString() || "");
        const [validationError, setValidationError] = useState<string | null>(null);

        // Reset state when preset changes
        useEffect(() => {
            setNewKey(presetKey || "bg@");
            setBg(preset.bg || "");
            setBgType(detectBgType(preset.bg));
            setOpacity(preset["bg:opacity"] ?? 1);
            setBlendMode(preset["bg:blendmode"] || "");
            setBorderColor(preset["bg:bordercolor"] || "");
            setActiveBorderColor(preset["bg:activebordercolor"] || "");
            setDisplayName(preset["display:name"] || "");
            setDisplayOrder(preset["display:order"]?.toString() || "");
            setValidationError(null);
        }, [presetKey, preset]);

        const handleBgTypeChange = useCallback((value: string) => {
            const type = value as BgType;
            setBgType(type);
            // Reset bg value based on type
            if (type === "color") {
                setBg("#333333");
            } else if (type === "gradient") {
                setBg("linear-gradient(135deg, #667eea 0%, #764ba2 100%)");
            } else {
                setBg("url()");
            }
        }, []);

        const handleColorChange = useCallback((color: string) => {
            setBg(color);
        }, []);

        const handleSubmit = useCallback(() => {
            // Validate key
            const keyToUse = isNew ? newKey : presetKey!;

            if (!BgPresetNameRegex.test(keyToUse)) {
                setValidationError("Preset name must match pattern: bg@[a-zA-Z0-9_-]+");
                return;
            }

            if (isNew && existingKeys.includes(keyToUse)) {
                setValidationError(`Preset "${keyToUse}" already exists`);
                return;
            }

            if (!bg.trim()) {
                setValidationError("Background value is required");
                return;
            }

            // Build preset object
            const newPreset: BgPreset = {};
            if (bg) newPreset.bg = bg;
            if (opacity !== 1) newPreset["bg:opacity"] = opacity;
            if (blendMode) newPreset["bg:blendmode"] = blendMode;
            if (borderColor) newPreset["bg:bordercolor"] = borderColor;
            if (activeBorderColor) newPreset["bg:activebordercolor"] = activeBorderColor;
            if (displayName) newPreset["display:name"] = displayName;
            if (displayOrder) {
                const order = parseInt(displayOrder, 10);
                if (!isNaN(order)) newPreset["display:order"] = order;
            }

            onSave(keyToUse, newPreset);
        }, [isNew, newKey, presetKey, bg, opacity, blendMode, borderColor, activeBorderColor, displayName, displayOrder, existingKeys, onSave]);

        // Build preview style
        const previewStyle: React.CSSProperties = {
            background: bg || "#333333",
            opacity: opacity,
            backgroundBlendMode: blendMode as any || "normal",
        };

        const bgTypeOptions: SelectOption[] = [
            { value: "color", label: "Solid Color" },
            { value: "gradient", label: "Gradient" },
            { value: "url", label: "Image URL" },
        ];

        return (
            <div className="bgpreset-editor">
                <div className="bgpreset-editor-header">
                    <h3>{isNew ? "Add New Preset" : `Edit ${displayName || presetKey}`}</h3>
                </div>

                {validationError && (
                    <div className="bgpreset-editor-error">
                        <ErrorDisplay message={validationError} />
                    </div>
                )}

                <div className="bgpreset-editor-content">
                    {/* Live Preview */}
                    <div className="bgpreset-editor-preview-section">
                        <label className="bgpreset-editor-label">Preview</label>
                        <div className="bgpreset-editor-preview" style={previewStyle}>
                            <div className="bgpreset-editor-preview-text">
                                <span className="preview-title">Terminal Block</span>
                                <span className="preview-subtitle">Preview of background appearance</span>
                            </div>
                        </div>
                    </div>

                    {/* Preset Key (only for new presets) */}
                    {isNew && (
                        <div className="bgpreset-editor-field">
                            <label className="bgpreset-editor-label">Preset Key</label>
                            <TextControl
                                value={newKey}
                                onChange={setNewKey}
                                placeholder="bg@my-preset"
                            />
                            <span className="bgpreset-editor-hint">
                                Must start with "bg@" followed by letters, numbers, underscores, or hyphens
                            </span>
                        </div>
                    )}

                    {/* Display Name */}
                    <div className="bgpreset-editor-field">
                        <label className="bgpreset-editor-label">Display Name</label>
                        <TextControl
                            value={displayName}
                            onChange={setDisplayName}
                            placeholder="My Custom Background"
                        />
                    </div>

                    {/* Background Type */}
                    <div className="bgpreset-editor-field">
                        <label className="bgpreset-editor-label">Background Type</label>
                        <SelectControl
                            value={bgType}
                            onChange={handleBgTypeChange}
                            options={bgTypeOptions}
                        />
                    </div>

                    {/* Background Value based on type */}
                    <div className="bgpreset-editor-field">
                        <label className="bgpreset-editor-label">Background Value</label>
                        {bgType === "color" && (
                            <ColorControl
                                value={extractColor(bg)}
                                onChange={handleColorChange}
                            />
                        )}
                        {bgType === "gradient" && (
                            <TextControl
                                value={bg}
                                onChange={setBg}
                                placeholder="linear-gradient(135deg, #667eea 0%, #764ba2 100%)"
                                multiline
                                rows={2}
                            />
                        )}
                        {bgType === "url" && (
                            <TextControl
                                value={bg}
                                onChange={setBg}
                                placeholder="url(https://example.com/image.jpg)"
                            />
                        )}
                    </div>

                    {/* Opacity Slider */}
                    <div className="bgpreset-editor-field">
                        <label className="bgpreset-editor-label">Opacity</label>
                        <SliderControl
                            value={opacity}
                            onChange={setOpacity}
                            min={0}
                            max={1}
                            step={0.05}
                            precision={2}
                        />
                    </div>

                    {/* Blend Mode */}
                    <div className="bgpreset-editor-field">
                        <label className="bgpreset-editor-label">Blend Mode</label>
                        <SelectControl
                            value={blendMode}
                            onChange={setBlendMode}
                            options={BLEND_MODE_OPTIONS}
                            placeholder="Select blend mode..."
                        />
                    </div>

                    {/* Border Colors */}
                    <div className="bgpreset-editor-field-row">
                        <div className="bgpreset-editor-field">
                            <label className="bgpreset-editor-label">Border Color</label>
                            <ColorControl
                                value={borderColor || "#000000"}
                                onChange={setBorderColor}
                            />
                        </div>
                        <div className="bgpreset-editor-field">
                            <label className="bgpreset-editor-label">Active Border Color</label>
                            <ColorControl
                                value={activeBorderColor || "#000000"}
                                onChange={setActiveBorderColor}
                            />
                        </div>
                    </div>

                    {/* Display Order */}
                    <div className="bgpreset-editor-field">
                        <label className="bgpreset-editor-label">Display Order</label>
                        <TextControl
                            value={displayOrder}
                            onChange={setDisplayOrder}
                            placeholder="0"
                        />
                        <span className="bgpreset-editor-hint">
                            Lower numbers appear first in the context menu
                        </span>
                    </div>
                </div>

                <div className="bgpreset-editor-actions">
                    <button
                        className="bgpreset-editor-cancel"
                        onClick={onCancel}
                        disabled={isLoading}
                    >
                        Cancel
                    </button>
                    <button
                        className="bgpreset-editor-save"
                        onClick={handleSubmit}
                        disabled={isLoading}
                    >
                        {isLoading ? (
                            <>
                                <i className="fa-sharp fa-solid fa-spinner fa-spin" />
                                Saving...
                            </>
                        ) : isNew ? (
                            "Add Preset"
                        ) : (
                            "Save Changes"
                        )}
                    </button>
                </div>
            </div>
        );
    }
);
PresetEditor.displayName = "PresetEditor";

interface BgPresetsContentProps {
    model: WaveConfigViewModel;
}

export const BgPresetsContent = memo(({ model }: BgPresetsContentProps) => {
    const [presets, setPresets] = useState<BgPresetsData>({});
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
    const [isAddingNew, setIsAddingNew] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [presetToDelete, setPresetToDelete] = useState<string | null>(null);

    const configDir = useMemo(() => getApi().getConfigDir(), []);

    // Load presets from file
    const loadPresets = useCallback(async () => {
        setIsLoading(true);
        setErrorMessage(null);

        try {
            const fullPath = `${configDir}/presets/bg.json`;
            const fileData = await RpcApi.FileReadCommand(TabRpcClient, {
                info: { path: fullPath },
            });
            const content = fileData?.data64 ? base64ToString(fileData.data64) : "";

            if (content.trim()) {
                const parsed = JSON.parse(content);
                setPresets(parsed);
            } else {
                setPresets({});
            }
        } catch (err: any) {
            // File might not exist yet, that's okay
            if (err.message?.includes("not found") || err.message?.includes("ENOENT")) {
                setPresets({});
            } else {
                setErrorMessage(`Failed to load presets: ${err.message || String(err)}`);
            }
        } finally {
            setIsLoading(false);
        }
    }, [configDir]);

    // Save presets to file
    const savePresets = useCallback(async (newPresets: BgPresetsData) => {
        setIsSaving(true);
        setErrorMessage(null);

        try {
            const fullPath = `${configDir}/presets/bg.json`;
            const content = JSON.stringify(newPresets, null, 2);
            await RpcApi.FileWriteCommand(TabRpcClient, {
                info: { path: fullPath },
                data64: stringToBase64(content),
            });
            setPresets(newPresets);
            model.markAsEdited();
        } catch (err: any) {
            setErrorMessage(`Failed to save presets: ${err.message || String(err)}`);
        } finally {
            setIsSaving(false);
        }
    }, [configDir, model]);

    // Initial load
    useEffect(() => {
        loadPresets();
    }, [loadPresets]);

    const handleSelectPreset = useCallback((key: string) => {
        setSelectedPreset(key);
        setIsAddingNew(false);
    }, []);

    const handleAddPreset = useCallback(() => {
        setSelectedPreset(null);
        setIsAddingNew(true);
    }, []);

    const handleDeletePreset = useCallback((key: string) => {
        setPresetToDelete(key);
        setShowDeleteConfirm(true);
    }, []);

    const handleConfirmDelete = useCallback(async () => {
        if (!presetToDelete) return;

        const newPresets = { ...presets };
        delete newPresets[presetToDelete];
        await savePresets(newPresets);

        if (selectedPreset === presetToDelete) {
            setSelectedPreset(null);
        }
        setShowDeleteConfirm(false);
        setPresetToDelete(null);
    }, [presets, savePresets, selectedPreset, presetToDelete]);

    const handleCancelDelete = useCallback(() => {
        setShowDeleteConfirm(false);
        setPresetToDelete(null);
    }, []);

    const handleSavePreset = useCallback(async (key: string, preset: BgPreset) => {
        const newPresets = { ...presets, [key]: preset };
        await savePresets(newPresets);
        setSelectedPreset(null);
        setIsAddingNew(false);
    }, [presets, savePresets]);

    const handleCancelEdit = useCallback(() => {
        setSelectedPreset(null);
        setIsAddingNew(false);
    }, []);

    const existingKeys = useMemo(() => Object.keys(presets), [presets]);

    if (isLoading) {
        return (
            <div className="bgpresets-content">
                <LoadingSpinner message="Loading presets..." />
            </div>
        );
    }

    const hasPresets = Object.keys(presets).length > 0;
    const showEditor = selectedPreset !== null || isAddingNew;
    const editingPreset = selectedPreset ? presets[selectedPreset] : {};

    return (
        <div className="bgpresets-content">
            {errorMessage && (
                <div className="bgpresets-error">
                    <ErrorDisplay message={errorMessage} />
                </div>
            )}

            {showDeleteConfirm && presetToDelete && (
                <div className="bgpresets-delete-confirm">
                    <div className="bgpresets-delete-confirm-text">
                        <i className="fa-sharp fa-solid fa-triangle-exclamation" />
                        <span>
                            Delete <strong>{presetToDelete}</strong>? This cannot be undone.
                        </span>
                    </div>
                    <div className="bgpresets-delete-confirm-actions">
                        <button
                            className="bgpresets-button bgpresets-button-secondary"
                            onClick={handleCancelDelete}
                            disabled={isSaving}
                        >
                            Cancel
                        </button>
                        <button
                            className="bgpresets-button bgpresets-button-danger"
                            onClick={handleConfirmDelete}
                            disabled={isSaving}
                        >
                            {isSaving ? (
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
            )}

            {showEditor ? (
                <PresetEditor
                    presetKey={selectedPreset}
                    preset={editingPreset}
                    isNew={isAddingNew}
                    isLoading={isSaving}
                    onSave={handleSavePreset}
                    onCancel={handleCancelEdit}
                    existingKeys={existingKeys}
                />
            ) : !hasPresets ? (
                <EmptyState onAddPreset={handleAddPreset} />
            ) : (
                <PresetGrid
                    presets={presets}
                    onSelectPreset={handleSelectPreset}
                    onDeletePreset={handleDeletePreset}
                    onAddPreset={handleAddPreset}
                />
            )}
        </div>
    );
});

BgPresetsContent.displayName = "BgPresetsContent";
