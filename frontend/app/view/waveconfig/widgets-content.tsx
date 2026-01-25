// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Widgets Content
 *
 * Visual component for managing sidebar widgets configuration.
 * Displays a list of widgets with icon preview, allows reordering,
 * editing properties, and adding/removing custom widgets.
 */

import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { atoms, globalStore } from "@/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn, makeIconClass, stringToBase64 } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

import "./widgets-content.scss";

interface WidgetsContentProps {
    model: WaveConfigViewModel;
}

interface WidgetEntry {
    key: string;
    config: WidgetConfigType;
    isDefault: boolean;
    isUserOverride: boolean;
}

// Sort widgets by display order
function sortWidgets(widgets: WidgetEntry[]): WidgetEntry[] {
    return [...widgets].sort((a, b) => {
        const orderA = a.config["display:order"] ?? 0;
        const orderB = b.config["display:order"] ?? 0;
        return orderA - orderB;
    });
}

// Default icon options for widgets
const iconOptions = [
    "square-terminal",
    "folder",
    "globe",
    "sparkles",
    "chart-line",
    "code",
    "file",
    "cog",
    "book",
    "database",
    "cloud",
    "lock",
    "key",
    "star",
    "heart",
    "bell",
    "flag",
    "bookmark",
    "calendar",
    "clock",
    "compass",
    "download",
    "upload",
    "edit",
    "eye",
    "filter",
    "home",
    "image",
    "link",
    "list",
    "map",
    "music",
    "palette",
    "phone",
    "play",
    "power",
    "print",
    "search",
    "send",
    "server",
    "share",
    "shield",
    "shopping-cart",
    "sliders",
    "tag",
    "trash",
    "user",
    "video",
    "wifi",
    "wrench",
];

// Color presets
const colorPresets = [
    "#ef4444", // red
    "#f97316", // orange
    "#f59e0b", // amber
    "#eab308", // yellow
    "#84cc16", // lime
    "#22c55e", // green
    "#10b981", // emerald
    "#14b8a6", // teal
    "#06b6d4", // cyan
    "#0ea5e9", // sky
    "#3b82f6", // blue
    "#6366f1", // indigo
    "#8b5cf6", // violet
    "#a855f7", // purple
    "#d946ef", // fuchsia
    "#ec4899", // pink
    "#f43f5e", // rose
    "#ffffff", // white
    "#94a3b8", // slate
];

const LoadingSpinner = memo(({ message }: { message: string }) => {
    return (
        <div className="widgets-loading">
            <i className="fa-sharp fa-solid fa-spinner fa-spin" />
            <span>{message}</span>
        </div>
    );
});
LoadingSpinner.displayName = "LoadingSpinner";

const EmptyState = memo(({ onAddWidget }: { onAddWidget: () => void }) => {
    return (
        <div className="widgets-empty">
            <i className="fa-sharp fa-solid fa-puzzle-piece empty-icon" />
            <h3 className="empty-title">No Custom Widgets</h3>
            <p className="empty-description">Add a custom widget to extend your sidebar</p>
            <button className="widgets-add-btn primary" onClick={onAddWidget}>
                <i className="fa-sharp fa-solid fa-plus" />
                <span>Add New Widget</span>
            </button>
        </div>
    );
});
EmptyState.displayName = "EmptyState";

interface WidgetIconPreviewProps {
    icon: string;
    color?: string;
    size?: "small" | "medium" | "large";
}

const WidgetIconPreview = memo(({ icon, color, size = "medium" }: WidgetIconPreviewProps) => {
    const sizeClass = `icon-${size}`;
    return (
        <div className={cn("widget-icon-preview", sizeClass)} style={{ color: color || "inherit" }}>
            <i className={makeIconClass(icon, true, { defaultIcon: "puzzle-piece" })} />
        </div>
    );
});
WidgetIconPreview.displayName = "WidgetIconPreview";

interface WidgetListItemProps {
    widget: WidgetEntry;
    isSelected: boolean;
    onSelect: () => void;
    onToggleVisibility: () => void;
    onMoveUp: () => void;
    onMoveDown: () => void;
    canMoveUp: boolean;
    canMoveDown: boolean;
}

const WidgetListItem = memo(
    ({
        widget,
        isSelected,
        onSelect,
        onToggleVisibility,
        onMoveUp,
        onMoveDown,
        canMoveUp,
        canMoveDown,
    }: WidgetListItemProps) => {
        const isHidden = widget.config["display:hidden"] ?? false;

        return (
            <div
                className={cn("widget-list-item", {
                    selected: isSelected,
                    hidden: isHidden,
                    "is-default": widget.isDefault,
                })}
                onClick={onSelect}
            >
                <div className="widget-reorder-buttons">
                    <button
                        className="reorder-btn"
                        onClick={(e) => {
                            e.stopPropagation();
                            onMoveUp();
                        }}
                        disabled={!canMoveUp}
                        title="Move up"
                    >
                        <i className="fa-sharp fa-solid fa-chevron-up" />
                    </button>
                    <button
                        className="reorder-btn"
                        onClick={(e) => {
                            e.stopPropagation();
                            onMoveDown();
                        }}
                        disabled={!canMoveDown}
                        title="Move down"
                    >
                        <i className="fa-sharp fa-solid fa-chevron-down" />
                    </button>
                </div>
                <WidgetIconPreview icon={widget.config.icon} color={widget.config.color} />
                <div className="widget-info">
                    <div className="widget-label">{widget.config.label || widget.key}</div>
                    <div className="widget-key">{widget.key}</div>
                </div>
                <div className="widget-badges">
                    {widget.isDefault && <span className="badge default">default</span>}
                    {widget.isUserOverride && <span className="badge override">customized</span>}
                </div>
                <button
                    className={cn("visibility-btn", { hidden: isHidden })}
                    onClick={(e) => {
                        e.stopPropagation();
                        onToggleVisibility();
                    }}
                    title={isHidden ? "Show widget" : "Hide widget"}
                >
                    <i className={`fa-sharp fa-solid ${isHidden ? "fa-eye-slash" : "fa-eye"}`} />
                </button>
            </div>
        );
    }
);
WidgetListItem.displayName = "WidgetListItem";

interface IconSelectorProps {
    value: string;
    onChange: (icon: string) => void;
}

const IconSelector = memo(({ value, onChange }: IconSelectorProps) => {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState("");

    const filteredIcons = useMemo(() => {
        if (!search) return iconOptions;
        return iconOptions.filter((icon) => icon.toLowerCase().includes(search.toLowerCase()));
    }, [search]);

    return (
        <div className="icon-selector">
            <button className="icon-selector-trigger" onClick={() => setIsOpen(!isOpen)}>
                <WidgetIconPreview icon={value || "puzzle-piece"} size="small" />
                <span>{value || "Select icon"}</span>
                <i className={`fa-sharp fa-solid fa-chevron-${isOpen ? "up" : "down"}`} />
            </button>
            {isOpen && (
                <div className="icon-selector-dropdown">
                    <div className="icon-search">
                        <i className="fa-sharp fa-solid fa-search" />
                        <input
                            type="text"
                            placeholder="Search icons..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            autoFocus
                        />
                    </div>
                    <div className="icon-grid">
                        {filteredIcons.map((icon) => (
                            <button
                                key={icon}
                                className={cn("icon-option", { selected: icon === value })}
                                onClick={() => {
                                    onChange(icon);
                                    setIsOpen(false);
                                    setSearch("");
                                }}
                                title={icon}
                            >
                                <i className={makeIconClass(icon, false)} />
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
});
IconSelector.displayName = "IconSelector";

interface ColorSelectorProps {
    value: string;
    onChange: (color: string) => void;
}

const ColorSelector = memo(({ value, onChange }: ColorSelectorProps) => {
    const [isOpen, setIsOpen] = useState(false);
    const [customColor, setCustomColor] = useState(value || "");

    return (
        <div className="color-selector">
            <button className="color-selector-trigger" onClick={() => setIsOpen(!isOpen)}>
                <div className="color-preview" style={{ backgroundColor: value || "#ffffff" }} />
                <span>{value || "No color"}</span>
                <i className={`fa-sharp fa-solid fa-chevron-${isOpen ? "up" : "down"}`} />
            </button>
            {isOpen && (
                <div className="color-selector-dropdown">
                    <div className="color-presets">
                        {colorPresets.map((color) => (
                            <button
                                key={color}
                                className={cn("color-option", { selected: color === value })}
                                style={{ backgroundColor: color }}
                                onClick={() => {
                                    onChange(color);
                                    setIsOpen(false);
                                }}
                                title={color}
                            />
                        ))}
                    </div>
                    <div className="color-custom">
                        <label>Custom color:</label>
                        <input
                            type="text"
                            placeholder="#hex or color name"
                            value={customColor}
                            onChange={(e) => setCustomColor(e.target.value)}
                            onBlur={() => {
                                if (customColor) {
                                    onChange(customColor);
                                }
                            }}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && customColor) {
                                    onChange(customColor);
                                    setIsOpen(false);
                                }
                            }}
                        />
                        <button
                            className="color-clear"
                            onClick={() => {
                                onChange("");
                                setCustomColor("");
                                setIsOpen(false);
                            }}
                        >
                            Clear
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
});
ColorSelector.displayName = "ColorSelector";

interface WidgetEditorProps {
    widget: WidgetEntry | null;
    isNew: boolean;
    onSave: (key: string, config: Partial<WidgetConfigType>) => void;
    onDelete: () => void;
    onCancel: () => void;
}

const WidgetEditor = memo(({ widget, isNew, onSave, onDelete, onCancel }: WidgetEditorProps) => {
    const [key, setKey] = useState(widget?.key?.replace(/^(def)?widget@/, "") || "");
    const [label, setLabel] = useState(widget?.config?.label || "");
    const [icon, setIcon] = useState(widget?.config?.icon || "puzzle-piece");
    const [color, setColor] = useState(widget?.config?.color || "");
    const [description, setDescription] = useState(widget?.config?.description || "");
    const [magnified, setMagnified] = useState(widget?.config?.magnified || false);
    const [viewType, setViewType] = useState(widget?.config?.blockdef?.meta?.view || "term");

    // Reset local state when widget prop changes
    useEffect(() => {
        setKey(widget?.key?.replace(/^(def)?widget@/, "") || "");
        setLabel(widget?.config?.label || "");
        setIcon(widget?.config?.icon || "puzzle-piece");
        setColor(widget?.config?.color || "");
        setDescription(widget?.config?.description || "");
        setMagnified(widget?.config?.magnified || false);
        setViewType(widget?.config?.blockdef?.meta?.view || "term");
    }, [widget]);

    const isDefault = widget?.isDefault ?? false;
    const canDelete = !isDefault && !isNew;
    const keyError = isNew && !key.match(/^[a-zA-Z0-9_-]+$/);

    const handleSave = useCallback(() => {
        const fullKey = isNew ? `widget@${key}` : widget.key;
        const config: Partial<WidgetConfigType> = {
            label,
            icon,
            description,
            magnified,
        };
        if (color) {
            config.color = color;
        }
        if (isNew) {
            config.blockdef = {
                meta: {
                    view: viewType,
                },
            };
        }
        onSave(fullKey, config);
    }, [isNew, key, widget, label, icon, color, description, magnified, viewType, onSave]);

    if (!widget && !isNew) {
        return (
            <div className="widget-editor-empty">
                <i className="fa-sharp fa-solid fa-hand-pointer" />
                <p>Select a widget to edit or add a new one</p>
            </div>
        );
    }

    return (
        <div className="widget-editor">
            <div className="editor-header">
                <h3>{isNew ? "Add New Widget" : `Edit Widget: ${widget?.config?.label || widget?.key}`}</h3>
                {isDefault && (
                    <span className="editor-badge">Default widget - changes create an override</span>
                )}
            </div>

            <div className="editor-preview">
                <WidgetIconPreview icon={icon} color={color} size="large" />
                <div className="preview-label">{label || key || "New Widget"}</div>
            </div>

            <div className="editor-form">
                {isNew && (
                    <div className="form-field">
                        <label>Widget Key</label>
                        <div className="key-input">
                            <span className="key-prefix">widget@</span>
                            <input
                                type="text"
                                value={key}
                                onChange={(e) => setKey(e.target.value)}
                                placeholder="my-widget"
                                className={cn({ error: keyError && key })}
                            />
                        </div>
                        {keyError && key && (
                            <span className="field-error">
                                Only letters, numbers, underscores, and hyphens allowed
                            </span>
                        )}
                    </div>
                )}

                <div className="form-field">
                    <label>Label</label>
                    <input
                        type="text"
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        placeholder="Widget label"
                    />
                </div>

                <div className="form-field">
                    <label>Icon</label>
                    <IconSelector value={icon} onChange={setIcon} />
                </div>

                <div className="form-field">
                    <label>Color</label>
                    <ColorSelector value={color} onChange={setColor} />
                </div>

                <div className="form-field">
                    <label>Description</label>
                    <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Widget description (shown in tooltip)"
                        rows={2}
                    />
                </div>

                {isNew && (
                    <div className="form-field">
                        <label>View Type</label>
                        <select value={viewType} onChange={(e) => setViewType(e.target.value)}>
                            <option value="term">Terminal</option>
                            <option value="preview">File Preview</option>
                            <option value="web">Web Browser</option>
                            <option value="waveai">Wave AI</option>
                            <option value="sysinfo">System Info</option>
                            <option value="help">Help</option>
                            <option value="tips">Tips</option>
                        </select>
                    </div>
                )}

                <div className="form-field checkbox">
                    <label>
                        <input
                            type="checkbox"
                            checked={magnified}
                            onChange={(e) => setMagnified(e.target.checked)}
                        />
                        Open magnified by default
                    </label>
                </div>
            </div>

            <div className="editor-actions">
                {canDelete && (
                    <button className="widgets-btn danger" onClick={onDelete}>
                        <i className="fa-sharp fa-solid fa-trash" />
                        Delete
                    </button>
                )}
                <div className="actions-right">
                    <button className="widgets-btn secondary" onClick={onCancel}>
                        Cancel
                    </button>
                    <button
                        className="widgets-btn primary"
                        onClick={handleSave}
                        disabled={isNew && (keyError || !key)}
                    >
                        {isNew ? "Add Widget" : "Save Changes"}
                    </button>
                </div>
            </div>
        </div>
    );
});
WidgetEditor.displayName = "WidgetEditor";

export const WidgetsContent = memo(({ model }: WidgetsContentProps) => {
    const fullConfig = useAtomValue(atoms.fullConfigAtom);
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [isAddingNew, setIsAddingNew] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Merge default and user widgets
    const widgets = useMemo(() => {
        const result: WidgetEntry[] = [];
        const defaultWidgets = fullConfig?.defaultwidgets ?? {};
        const userWidgets = fullConfig?.widgets ?? {};

        // Track which default widgets have user overrides
        const userKeys = new Set(Object.keys(userWidgets));

        // Add default widgets
        for (const [key, config] of Object.entries(defaultWidgets)) {
            const hasUserOverride = userKeys.has(key);
            const mergedConfig = hasUserOverride ? { ...config, ...userWidgets[key] } : config;
            result.push({
                key,
                config: mergedConfig,
                isDefault: true,
                isUserOverride: hasUserOverride,
            });
        }

        // Add user-only widgets (not overrides of defaults)
        for (const [key, config] of Object.entries(userWidgets)) {
            if (!defaultWidgets[key]) {
                result.push({
                    key,
                    config,
                    isDefault: false,
                    isUserOverride: false,
                });
            }
        }

        return sortWidgets(result);
    }, [fullConfig]);

    const selectedWidget = useMemo(() => {
        if (!selectedKey) return null;
        return widgets.find((w) => w.key === selectedKey) || null;
    }, [widgets, selectedKey]);

    // Save widget configuration to widgets.json
    const saveWidgetConfig = useCallback(
        async (updates: { [key: string]: WidgetConfigType | null }) => {
            setIsSaving(true);
            setError(null);

            try {
                // Get current user widgets
                const currentUserWidgets = { ...(fullConfig?.widgets ?? {}) };

                // Apply updates
                for (const [key, config] of Object.entries(updates)) {
                    if (config === null) {
                        delete currentUserWidgets[key];
                    } else {
                        currentUserWidgets[key] = {
                            ...currentUserWidgets[key],
                            ...config,
                        };
                    }
                }

                // Write to widgets.json
                const configDir = model.configDir;
                const fullPath = `${configDir}/widgets.json`;
                const content = JSON.stringify(currentUserWidgets, null, 2);

                await RpcApi.FileWriteCommand(TabRpcClient, {
                    info: { path: fullPath },
                    data64: stringToBase64(content),
                });

                model.markAsEdited();
            } catch (err) {
                setError(`Failed to save: ${err.message || String(err)}`);
            } finally {
                setIsSaving(false);
            }
        },
        [fullConfig, model]
    );

    const handleToggleVisibility = useCallback(
        async (widget: WidgetEntry) => {
            const newHidden = !(widget.config["display:hidden"] ?? false);
            await saveWidgetConfig({
                [widget.key]: {
                    ...widget.config,
                    "display:hidden": newHidden,
                },
            });
        },
        [saveWidgetConfig]
    );

    const handleMoveWidget = useCallback(
        async (widget: WidgetEntry, direction: "up" | "down") => {
            const currentIndex = widgets.findIndex((w) => w.key === widget.key);
            const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

            if (targetIndex < 0 || targetIndex >= widgets.length) return;

            const targetWidget = widgets[targetIndex];
            const currentOrder = widget.config["display:order"] ?? 0;
            const targetOrder = targetWidget.config["display:order"] ?? 0;

            // Swap orders
            await saveWidgetConfig({
                [widget.key]: {
                    ...widget.config,
                    "display:order": targetOrder,
                },
                [targetWidget.key]: {
                    ...targetWidget.config,
                    "display:order": currentOrder,
                },
            });
        },
        [widgets, saveWidgetConfig]
    );

    const handleSaveWidget = useCallback(
        async (key: string, config: Partial<WidgetConfigType>) => {
            const existingWidget = widgets.find((w) => w.key === key);
            const fullConfig: WidgetConfigType = {
                ...existingWidget?.config,
                ...config,
                blockdef: config.blockdef || existingWidget?.config?.blockdef || { meta: { view: "term" } },
            };

            // If it's a new widget, set a display order
            if (!existingWidget) {
                const maxOrder = Math.max(...widgets.map((w) => w.config["display:order"] ?? 0), 0);
                fullConfig["display:order"] = maxOrder + 1;
            }

            await saveWidgetConfig({ [key]: fullConfig });
            setSelectedKey(key);
            setIsAddingNew(false);
        },
        [widgets, saveWidgetConfig]
    );

    const handleDeleteWidget = useCallback(async () => {
        if (!selectedWidget || selectedWidget.isDefault) return;

        await saveWidgetConfig({ [selectedWidget.key]: null });
        setSelectedKey(null);
    }, [selectedWidget, saveWidgetConfig]);

    const handleCancel = useCallback(() => {
        setIsAddingNew(false);
        setSelectedKey(null);
    }, []);

    if (!fullConfig) {
        return <LoadingSpinner message="Loading widgets..." />;
    }

    return (
        <div className="widgets-content">
            {error && (
                <div className="widgets-error">
                    <i className="fa-sharp fa-solid fa-exclamation-circle" />
                    <span>{error}</span>
                    <button onClick={() => setError(null)}>
                        <i className="fa-sharp fa-solid fa-times" />
                    </button>
                </div>
            )}

            <div className="widgets-layout">
                <div className="widgets-list-panel">
                    <div className="widgets-list-header">
                        <h3>Sidebar Widgets</h3>
                        <button
                            className="widgets-add-btn"
                            onClick={() => {
                                setIsAddingNew(true);
                                setSelectedKey(null);
                            }}
                            disabled={isSaving}
                        >
                            <i className="fa-sharp fa-solid fa-plus" />
                            Add Widget
                        </button>
                    </div>

                    <div className="widgets-list">
                        {widgets.length === 0 ? (
                            <EmptyState onAddWidget={() => setIsAddingNew(true)} />
                        ) : (
                            widgets.map((widget, index) => (
                                <WidgetListItem
                                    key={widget.key}
                                    widget={widget}
                                    isSelected={selectedKey === widget.key && !isAddingNew}
                                    onSelect={() => {
                                        setSelectedKey(widget.key);
                                        setIsAddingNew(false);
                                    }}
                                    onToggleVisibility={() => handleToggleVisibility(widget)}
                                    onMoveUp={() => handleMoveWidget(widget, "up")}
                                    onMoveDown={() => handleMoveWidget(widget, "down")}
                                    canMoveUp={index > 0}
                                    canMoveDown={index < widgets.length - 1}
                                />
                            ))
                        )}
                    </div>

                    <div className="widgets-list-footer">
                        <i className="fa-sharp fa-solid fa-info-circle" />
                        <span>Default widgets can be hidden but not deleted</span>
                    </div>
                </div>

                <div className="widgets-editor-panel">
                    <WidgetEditor
                        widget={isAddingNew ? null : selectedWidget}
                        isNew={isAddingNew}
                        onSave={handleSaveWidget}
                        onDelete={handleDeleteWidget}
                        onCancel={handleCancel}
                    />
                </div>
            </div>
        </div>
    );
});

WidgetsContent.displayName = "WidgetsContent";
