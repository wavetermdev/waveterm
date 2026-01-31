// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Shells Content
 *
 * Visual component for managing local shell profiles.
 * Features:
 * - List of detected and user-configured shells
 * - Auto-detection of available shells
 * - Autodetected badge for system-discovered shells
 * - Edit, duplicate, delete, and hide actions
 * - Separate from SSH/WSL connections
 */

import { atoms } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { cn, makeIconClass } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

import "./shells-content.scss";

interface ShellsContentProps {
    model: WaveConfigViewModel;
}

interface ShellEntry {
    id: string;
    profile: ShellProfileType;
}

// Icon options for shells
const shellIconOptions = [
    { value: "terminal", label: "Terminal" },
    { value: "brands@linux", label: "Linux" },
    { value: "brands@ubuntu", label: "Ubuntu" },
    { value: "brands@debian", label: "Debian" },
    { value: "brands@fedora", label: "Fedora" },
    { value: "brands@windows", label: "Windows" },
    { value: "brands@git-alt", label: "Git" },
];

// Sort shells by display order, then by name
function sortShells(shells: ShellEntry[]): ShellEntry[] {
    return [...shells].sort((a, b) => {
        const orderA = a.profile["display:order"] ?? 0;
        const orderB = b.profile["display:order"] ?? 0;
        if (orderA !== orderB) return orderA - orderB;
        const nameA = a.profile["display:name"] || a.id;
        const nameB = b.profile["display:name"] || b.id;
        return nameA.localeCompare(nameB);
    });
}

// Get icon class for a shell profile
function getShellIconClass(profile: ShellProfileType, profileId: string): string {
    if (profile["display:icon"]) {
        return makeIconClass(profile["display:icon"], true, { defaultIcon: "terminal" });
    }

    // WSL distros
    if (profile["shell:iswsl"] || profileId.startsWith("wsl:")) {
        const distro = (profile["shell:wsldistro"] || profileId.substring(4)).toLowerCase();
        if (distro.includes("ubuntu")) return "fa-brands fa-ubuntu";
        if (distro.includes("debian")) return "fa-brands fa-debian";
        if (distro.includes("fedora")) return "fa-brands fa-fedora";
        return "fa-brands fa-linux";
    }

    // Shell types
    const shellType = profile["shell:type"]?.toLowerCase() || profileId.toLowerCase();
    if (shellType === "cmd") return "fa-brands fa-windows";
    if (shellType.includes("pwsh") || shellType.includes("powershell")) return "fa-sharp fa-solid fa-terminal";
    if (shellType.includes("git")) return "fa-brands fa-git-alt";

    return "fa-sharp fa-solid fa-terminal";
}

const LoadingSpinner = memo(({ message }: { message: string }) => (
    <div className="shells-loading">
        <i className="fa-sharp fa-solid fa-spinner fa-spin" />
        <span>{message}</span>
    </div>
));
LoadingSpinner.displayName = "LoadingSpinner";

interface EmptyStateProps {
    onDetect: () => void;
    onAdd: () => void;
    isDetecting: boolean;
}

const EmptyState = memo(({ onDetect, onAdd, isDetecting }: EmptyStateProps) => (
    <div className="shells-empty">
        <i className="fa-sharp fa-solid fa-terminal empty-icon" />
        <h3 className="empty-title">No Shell Profiles</h3>
        <p className="empty-description">
            Detect available shells on your system or add a custom shell profile.
        </p>
        <button
            className="shells-btn primary"
            onClick={onDetect}
            disabled={isDetecting}
        >
            {isDetecting ? (
                <>
                    <i className="fa-sharp fa-solid fa-spinner fa-spin" />
                    <span>Detecting...</span>
                </>
            ) : (
                <>
                    <i className="fa-sharp fa-solid fa-wand-magic-sparkles" />
                    <span>Detect Shells</span>
                </>
            )}
        </button>
        <button className="shells-btn secondary" onClick={onAdd}>
            <i className="fa-sharp fa-solid fa-plus" />
            <span>Add Shell Profile</span>
        </button>
    </div>
));
EmptyState.displayName = "EmptyState";

interface ShellListItemProps {
    shell: ShellEntry;
    isSelected: boolean;
    isDefault: boolean;
    onSelect: () => void;
}

const ShellListItem = memo(({ shell, isSelected, isDefault, onSelect }: ShellListItemProps) => {
    const iconClass = getShellIconClass(shell.profile, shell.id);
    const isHidden = shell.profile.hidden;
    const isAutodetected = shell.profile.autodetected;
    const displayName = shell.profile["display:name"] || shell.id;

    return (
        <div
            className={cn("shell-list-item", {
                selected: isSelected,
                hidden: isHidden,
                default: isDefault,
            })}
            onClick={onSelect}
        >
            <div className="shell-icon">
                <i className={iconClass} />
            </div>
            <div className="shell-info">
                <div className="shell-name">
                    {displayName}
                    {isDefault && <span className="shell-default-badge">default</span>}
                </div>
                <div className="shell-path">{shell.profile["shell:path"] || "System default"}</div>
            </div>
            <div className="shell-badges">
                {isAutodetected && !shell.profile.usermodified && (
                    <span className="shell-badge autodetected">autodetected</span>
                )}
                {shell.profile.usermodified && (
                    <span className="shell-badge modified">modified</span>
                )}
            </div>
            {isHidden && <i className="fa-sharp fa-solid fa-eye-slash shell-hidden-icon" />}
            <i className="fa-sharp fa-solid fa-chevron-right shell-arrow" />
        </div>
    );
});
ShellListItem.displayName = "ShellListItem";

interface ShellEditorProps {
    shell: ShellEntry | null;
    isNew: boolean;
    defaultShellId: string;
    onSave: (id: string, profile: ShellProfileType) => void;
    onDelete: () => void;
    onDuplicate: () => void;
    onSetDefault: () => void;
    onCancel: () => void;
}

const ShellEditor = memo(({
    shell,
    isNew,
    defaultShellId,
    onSave,
    onDelete,
    onDuplicate,
    onSetDefault,
    onCancel,
}: ShellEditorProps) => {
    const [id, setId] = useState(shell?.id || "");
    const [displayName, setDisplayName] = useState(shell?.profile["display:name"] || "");
    const [displayIcon, setDisplayIcon] = useState(shell?.profile["display:icon"] || "");
    const [shellPath, setShellPath] = useState(shell?.profile["shell:path"] || "");
    const [shellOpts, setShellOpts] = useState(shell?.profile["shell:opts"]?.join(" ") || "");
    const [shellType, setShellType] = useState(shell?.profile["shell:type"] || "");
    const [isWsl, setIsWsl] = useState(shell?.profile["shell:iswsl"] || false);
    const [wslDistro, setWslDistro] = useState(shell?.profile["shell:wsldistro"] || "");
    const [hidden, setHidden] = useState(shell?.profile.hidden || false);

    // Reset form when shell changes
    useEffect(() => {
        setId(shell?.id || "");
        setDisplayName(shell?.profile["display:name"] || "");
        setDisplayIcon(shell?.profile["display:icon"] || "");
        setShellPath(shell?.profile["shell:path"] || "");
        setShellOpts(shell?.profile["shell:opts"]?.join(" ") || "");
        setShellType(shell?.profile["shell:type"] || "");
        setIsWsl(shell?.profile["shell:iswsl"] || false);
        setWslDistro(shell?.profile["shell:wsldistro"] || "");
        setHidden(shell?.profile.hidden || false);
    }, [shell]);

    const isAutodetected = shell?.profile.autodetected && !shell?.profile.usermodified;
    const isDefault = shell?.id === defaultShellId;
    const idError = isNew && !/^[a-zA-Z0-9_:-]+$/.test(id);

    const handleSave = useCallback(() => {
        const profile: ShellProfileType = {
            "display:name": displayName || undefined,
            "display:icon": displayIcon || undefined,
            "display:order": shell?.profile["display:order"],
            "shell:path": shellPath || undefined,
            "shell:opts": shellOpts ? shellOpts.split(/\s+/).filter(Boolean) : undefined,
            "shell:type": shellType || undefined,
            "shell:iswsl": isWsl || undefined,
            "shell:wsldistro": isWsl ? wslDistro : undefined,
            autodetected: shell?.profile.autodetected,
            hidden: hidden || undefined,
            source: shell?.profile.source,
            usermodified: !isNew || shell?.profile.autodetected ? true : undefined,
        };
        onSave(isNew ? id : shell.id, profile);
    }, [
        id, displayName, displayIcon, shellPath, shellOpts, shellType,
        isWsl, wslDistro, hidden, isNew, shell, onSave,
    ]);

    if (!shell && !isNew) {
        return (
            <div className="shell-editor-empty">
                <i className="fa-sharp fa-solid fa-hand-pointer" />
                <p>Select a shell to edit or add a new one</p>
            </div>
        );
    }

    return (
        <div className="shell-editor">
            <div className="editor-header">
                <h3>{isNew ? "Add New Shell" : `Edit Shell: ${displayName || shell?.id}`}</h3>
                {isAutodetected && (
                    <span className="editor-badge autodetected">
                        <i className="fa-sharp fa-solid fa-wand-magic-sparkles" />
                        Autodetected
                    </span>
                )}
            </div>

            <div className="editor-form">
                {isNew && (
                    <div className="form-field">
                        <label>Shell ID</label>
                        <input
                            type="text"
                            value={id}
                            onChange={(e) => setId(e.target.value)}
                            placeholder="my-shell"
                            className={cn({ error: idError && id })}
                        />
                        <span className="field-hint">
                            Unique identifier (letters, numbers, underscores, hyphens, colons)
                        </span>
                        {idError && id && (
                            <span className="field-error">Invalid characters in ID</span>
                        )}
                    </div>
                )}

                <div className="form-field">
                    <label>Display Name</label>
                    <input
                        type="text"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder="PowerShell 7"
                    />
                </div>

                <div className="form-field">
                    <label>Icon</label>
                    <select
                        value={displayIcon}
                        onChange={(e) => setDisplayIcon(e.target.value)}
                    >
                        <option value="">Auto (based on shell type)</option>
                        {shellIconOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                                {opt.label}
                            </option>
                        ))}
                    </select>
                </div>

                <div className="form-field">
                    <label>Shell Path</label>
                    <input
                        type="text"
                        value={shellPath}
                        onChange={(e) => setShellPath(e.target.value)}
                        placeholder="C:\Program Files\PowerShell\7\pwsh.exe"
                    />
                    <span className="field-hint">Full path to the shell executable</span>
                </div>

                <div className="form-field">
                    <label>Shell Arguments</label>
                    <input
                        type="text"
                        value={shellOpts}
                        onChange={(e) => setShellOpts(e.target.value)}
                        placeholder="-NoLogo -NoProfile"
                    />
                    <span className="field-hint">Space-separated arguments</span>
                </div>

                <div className="form-field">
                    <label>Shell Type</label>
                    <select
                        value={shellType}
                        onChange={(e) => setShellType(e.target.value)}
                    >
                        <option value="">Auto-detect</option>
                        <option value="pwsh">PowerShell</option>
                        <option value="bash">Bash</option>
                        <option value="zsh">Zsh</option>
                        <option value="fish">Fish</option>
                        <option value="cmd">CMD</option>
                    </select>
                </div>

                <div className="form-field checkbox">
                    <label>
                        <input
                            type="checkbox"
                            checked={isWsl}
                            onChange={(e) => setIsWsl(e.target.checked)}
                        />
                        WSL Distribution
                    </label>
                </div>

                {isWsl && (
                    <div className="form-field">
                        <label>WSL Distro Name</label>
                        <input
                            type="text"
                            value={wslDistro}
                            onChange={(e) => setWslDistro(e.target.value)}
                            placeholder="Ubuntu"
                        />
                    </div>
                )}

                <div className="form-field checkbox">
                    <label>
                        <input
                            type="checkbox"
                            checked={hidden}
                            onChange={(e) => setHidden(e.target.checked)}
                        />
                        Hide from shell selector
                    </label>
                </div>
            </div>

            <div className="editor-actions">
                <div className="actions-left">
                    {!isNew && (
                        <button className="shells-btn danger" onClick={onDelete}>
                            <i className="fa-sharp fa-solid fa-trash" />
                            {isAutodetected ? "Remove" : "Delete"}
                        </button>
                    )}
                    {!isNew && (
                        <button className="shells-btn secondary" onClick={onDuplicate}>
                            <i className="fa-sharp fa-solid fa-clone" />
                            Duplicate
                        </button>
                    )}
                    {!isNew && !isDefault && (
                        <button className="shells-btn secondary" onClick={onSetDefault}>
                            <i className="fa-sharp fa-solid fa-star" />
                            Set as Default
                        </button>
                    )}
                </div>
                <div className="actions-right">
                    <button className="shells-btn secondary" onClick={onCancel}>
                        Cancel
                    </button>
                    <button
                        className="shells-btn primary"
                        onClick={handleSave}
                        disabled={isNew && (idError || !id)}
                    >
                        {isNew ? "Add Shell" : "Save Changes"}
                    </button>
                </div>
            </div>
        </div>
    );
});
ShellEditor.displayName = "ShellEditor";

export const ShellsContent = memo(({ model }: ShellsContentProps) => {
    const fullConfig = useAtomValue(atoms.fullConfigAtom);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [isAddingNew, setIsAddingNew] = useState(false);
    const [isDetecting, setIsDetecting] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Get shell profiles from settings
    const shells = useMemo(() => {
        const profiles = fullConfig?.settings?.["shell:profiles"] ?? {};
        const entries: ShellEntry[] = Object.entries(profiles).map(([id, profile]) => ({
            id,
            profile,
        }));
        return sortShells(entries);
    }, [fullConfig]);

    const defaultShellId = fullConfig?.settings?.["shell:default"] || "pwsh";

    const selectedShell = useMemo(() => {
        if (!selectedId) return null;
        return shells.find((s) => s.id === selectedId) || null;
    }, [shells, selectedId]);

    // Handle auto-detection
    const handleDetect = useCallback(async () => {
        setIsDetecting(true);
        setError(null);

        try {
            const result = await RpcApi.MergeShellProfilesCommand(TabRpcClient, { rescan: true });
            if (result.error) {
                setError(result.error);
            } else if (result.added > 0) {
                // Success - shells were added
            }
        } catch (err) {
            setError(`Detection failed: ${err.message || String(err)}`);
        } finally {
            setIsDetecting(false);
        }
    }, []);

    // Save a shell profile
    const handleSave = useCallback(async (id: string, profile: ShellProfileType) => {
        setIsSaving(true);
        setError(null);

        try {
            await RpcApi.SetShellProfileCommand(TabRpcClient, {
                profileid: id,
                profile: {
                    profileid: id,
                    "display:name": profile["display:name"],
                    "display:icon": profile["display:icon"],
                    "display:order": profile["display:order"],
                    "shell:path": profile["shell:path"],
                    "shell:opts": profile["shell:opts"],
                    "shell:type": profile["shell:type"],
                    "shell:iswsl": profile["shell:iswsl"],
                    "shell:wsldistro": profile["shell:wsldistro"],
                    autodetected: profile.autodetected,
                    hidden: profile.hidden,
                    source: profile.source,
                    usermodified: profile.usermodified,
                },
            });
            setSelectedId(id);
            setIsAddingNew(false);
        } catch (err) {
            setError(`Failed to save: ${err.message || String(err)}`);
        } finally {
            setIsSaving(false);
        }
    }, []);

    // Delete a shell profile
    const handleDelete = useCallback(async () => {
        if (!selectedShell) return;

        setIsSaving(true);
        setError(null);

        try {
            await RpcApi.DeleteShellProfileCommand(TabRpcClient, {
                profileid: selectedShell.id,
            });
            setSelectedId(null);
        } catch (err) {
            setError(`Failed to delete: ${err.message || String(err)}`);
        } finally {
            setIsSaving(false);
        }
    }, [selectedShell]);

    // Duplicate a shell profile
    const handleDuplicate = useCallback(async () => {
        if (!selectedShell) return;

        const newId = `${selectedShell.id}-copy`;
        const newProfile: ShellProfileType = {
            ...selectedShell.profile,
            "display:name": `${selectedShell.profile["display:name"] || selectedShell.id} (Copy)`,
            autodetected: false,
            usermodified: false,
        };

        await handleSave(newId, newProfile);
    }, [selectedShell, handleSave]);

    // Set as default shell
    const handleSetDefault = useCallback(async () => {
        if (!selectedShell) return;

        setIsSaving(true);
        setError(null);

        try {
            await RpcApi.SetConfigCommand(TabRpcClient, {
                "shell:default": selectedShell.id,
            });
        } catch (err) {
            setError(`Failed to set default: ${err.message || String(err)}`);
        } finally {
            setIsSaving(false);
        }
    }, [selectedShell]);

    const handleCancel = useCallback(() => {
        setIsAddingNew(false);
        setSelectedId(null);
    }, []);

    if (!fullConfig) {
        return <LoadingSpinner message="Loading shell profiles..." />;
    }

    return (
        <div className="shells-content">
            {error && (
                <div className="shells-error">
                    <i className="fa-sharp fa-solid fa-exclamation-circle" />
                    <span>{error}</span>
                    <button onClick={() => setError(null)}>
                        <i className="fa-sharp fa-solid fa-times" />
                    </button>
                </div>
            )}

            <div className="shells-layout">
                <div className="shells-list-panel">
                    <div className="shells-list-header">
                        <h3>Shell Profiles</h3>
                        <div className="shells-header-actions">
                            <button
                                className="shells-detect-btn"
                                onClick={handleDetect}
                                disabled={isDetecting || isSaving}
                                title="Detect available shells"
                            >
                                {isDetecting ? (
                                    <i className="fa-sharp fa-solid fa-spinner fa-spin" />
                                ) : (
                                    <i className="fa-sharp fa-solid fa-wand-magic-sparkles" />
                                )}
                            </button>
                            <button
                                className="shells-add-btn"
                                onClick={() => {
                                    setIsAddingNew(true);
                                    setSelectedId(null);
                                }}
                                disabled={isSaving}
                            >
                                <i className="fa-sharp fa-solid fa-plus" />
                                Add
                            </button>
                        </div>
                    </div>

                    <div className="shells-list">
                        {shells.length === 0 ? (
                            <EmptyState
                                onDetect={handleDetect}
                                onAdd={() => setIsAddingNew(true)}
                                isDetecting={isDetecting}
                            />
                        ) : (
                            shells.map((shell) => (
                                <ShellListItem
                                    key={shell.id}
                                    shell={shell}
                                    isSelected={selectedId === shell.id && !isAddingNew}
                                    isDefault={shell.id === defaultShellId}
                                    onSelect={() => {
                                        setSelectedId(shell.id);
                                        setIsAddingNew(false);
                                    }}
                                />
                            ))
                        )}
                    </div>

                    <div className="shells-list-footer">
                        <i className="fa-sharp fa-solid fa-info-circle" />
                        <span>Autodetected shells are refreshed on startup</span>
                    </div>
                </div>

                <div className="shells-editor-panel">
                    <ShellEditor
                        shell={isAddingNew ? null : selectedShell}
                        isNew={isAddingNew}
                        defaultShellId={defaultShellId}
                        onSave={handleSave}
                        onDelete={handleDelete}
                        onDuplicate={handleDuplicate}
                        onSetDefault={handleSetDefault}
                        onCancel={handleCancel}
                    />
                </div>
            </div>
        </div>
    );
});

ShellsContent.displayName = "ShellsContent";
