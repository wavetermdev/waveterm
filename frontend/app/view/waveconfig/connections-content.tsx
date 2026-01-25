// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Connections Visual Content
 *
 * A visual component for managing SSH/WSL connection configurations.
 * Features a two-panel layout with a sidebar for connection list and
 * a main panel for editing connection settings grouped by category.
 */

import { atoms } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { isWindows } from "@/util/platformutil";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

import "./connections-content.scss";

// ============================================
// Types
// ============================================

type ConnectionType = "ssh" | "wsl";

interface ConnectionInfo {
    name: string;
    type: ConnectionType;
    config: ConnKeywords;
}

interface SettingFieldDef {
    key: keyof ConnKeywords;
    label: string;
    type: "boolean" | "string" | "number" | "string[]" | "env";
    description?: string;
    placeholder?: string;
}

interface SettingCategory {
    id: string;
    label: string;
    icon: string;
    fields: SettingFieldDef[];
    showFor?: ConnectionType[];
}

// ============================================
// Setting Definitions
// ============================================

const SETTING_CATEGORIES: SettingCategory[] = [
    {
        id: "connection",
        label: "Connection",
        icon: "plug",
        fields: [
            {
                key: "conn:wshenabled",
                label: "Enable wsh",
                type: "boolean",
                description: "Allow wsh shell extensions for this connection",
            },
            {
                key: "conn:askbeforewshinstall",
                label: "Ask before wsh install",
                type: "boolean",
                description: "Prompt before installing wsh on this connection",
            },
            {
                key: "conn:wshpath",
                label: "wsh path",
                type: "string",
                placeholder: "~/.waveterm/bin/wsh",
                description: "Path to wsh executable on the connection",
            },
            {
                key: "conn:shellpath",
                label: "Shell path",
                type: "string",
                placeholder: "Default shell",
                description: "Path to shell executable on the connection",
            },
            {
                key: "conn:ignoresshconfig",
                label: "Ignore SSH config",
                type: "boolean",
                description: "Ignore ~/.ssh/config for this connection",
            },
        ],
    },
    {
        id: "ssh",
        label: "SSH Settings",
        icon: "key",
        showFor: ["ssh"],
        fields: [
            {
                key: "ssh:user",
                label: "Username",
                type: "string",
                placeholder: "Current user",
                description: "SSH username for this connection",
            },
            {
                key: "ssh:hostname",
                label: "Hostname",
                type: "string",
                placeholder: "Resolved from host",
                description: "Real hostname or IP address",
            },
            {
                key: "ssh:port",
                label: "Port",
                type: "string",
                placeholder: "22",
                description: "SSH port number",
            },
            {
                key: "ssh:identityfile",
                label: "Identity files",
                type: "string[]",
                description: "Paths to SSH identity files (one per line)",
            },
            {
                key: "ssh:passwordsecretname",
                label: "Password secret name",
                type: "string",
                description: "Name of secret containing SSH password",
            },
            {
                key: "ssh:batchmode",
                label: "Batch mode",
                type: "boolean",
                description: "Disable password/passphrase prompts",
            },
            {
                key: "ssh:pubkeyauthentication",
                label: "Public key authentication",
                type: "boolean",
                description: "Enable public key authentication",
            },
            {
                key: "ssh:passwordauthentication",
                label: "Password authentication",
                type: "boolean",
                description: "Enable password authentication",
            },
            {
                key: "ssh:kbdinteractiveauthentication",
                label: "Keyboard-interactive auth",
                type: "boolean",
                description: "Enable keyboard-interactive authentication",
            },
            {
                key: "ssh:preferredauthentications",
                label: "Preferred authentications",
                type: "string[]",
                description: "Order of authentication methods (one per line)",
            },
            {
                key: "ssh:addkeystoagent",
                label: "Add keys to agent",
                type: "boolean",
                description: "Add keys to SSH agent when used",
            },
            {
                key: "ssh:identityagent",
                label: "Identity agent",
                type: "string",
                description: "Path to SSH agent socket",
            },
            {
                key: "ssh:identitiesonly",
                label: "Identities only",
                type: "boolean",
                description: "Only use specified identity files",
            },
            {
                key: "ssh:proxyjump",
                label: "Proxy jump",
                type: "string[]",
                description: "Jump proxies for TCP forwarding (one per line)",
            },
            {
                key: "ssh:userknownhostsfile",
                label: "User known hosts file",
                type: "string[]",
                description: "Paths to user known hosts files (one per line)",
            },
            {
                key: "ssh:globalknownhostsfile",
                label: "Global known hosts file",
                type: "string[]",
                description: "Paths to global known hosts files (one per line)",
            },
        ],
    },
    {
        id: "terminal",
        label: "Terminal",
        icon: "terminal",
        fields: [
            {
                key: "term:fontsize",
                label: "Font size",
                type: "number",
                placeholder: "Use global setting",
                description: "Override terminal font size for this connection",
            },
            {
                key: "term:fontfamily",
                label: "Font family",
                type: "string",
                placeholder: "Use global setting",
                description: "Override terminal font family for this connection",
            },
            {
                key: "term:theme",
                label: "Theme",
                type: "string",
                placeholder: "Use global setting",
                description: "Override terminal theme for this connection",
            },
        ],
    },
    {
        id: "shell",
        label: "Shell Scripts",
        icon: "scroll",
        fields: [
            {
                key: "cmd:env",
                label: "Environment variables",
                type: "env",
                description: "Environment variables to set (KEY=VALUE format, one per line)",
            },
            {
                key: "cmd:initscript",
                label: "Init script (all shells)",
                type: "string",
                placeholder: "Script path or inline script",
                description: "Script to run when initializing any shell",
            },
            {
                key: "cmd:initscript.sh",
                label: "Init script (POSIX)",
                type: "string",
                placeholder: "Script path or inline script",
                description: "Script to run for bash/zsh shells",
            },
            {
                key: "cmd:initscript.bash",
                label: "Init script (bash)",
                type: "string",
                placeholder: "Script path or inline script",
                description: "Script to run for bash shell",
            },
            {
                key: "cmd:initscript.zsh",
                label: "Init script (zsh)",
                type: "string",
                placeholder: "Script path or inline script",
                description: "Script to run for zsh shell",
            },
            {
                key: "cmd:initscript.pwsh",
                label: "Init script (pwsh)",
                type: "string",
                placeholder: "Script path or inline script",
                description: "Script to run for PowerShell",
            },
            {
                key: "cmd:initscript.fish",
                label: "Init script (fish)",
                type: "string",
                placeholder: "Script path or inline script",
                description: "Script to run for fish shell",
            },
        ],
    },
    {
        id: "display",
        label: "Display",
        icon: "eye",
        fields: [
            {
                key: "display:hidden",
                label: "Hidden",
                type: "boolean",
                description: "Hide this connection from the dropdown list",
            },
            {
                key: "display:order",
                label: "Order",
                type: "number",
                placeholder: "0",
                description: "Sort order in the dropdown (lower = higher priority)",
            },
        ],
    },
];

// ============================================
// Helper Functions
// ============================================

function getConnectionType(name: string): ConnectionType {
    return name.startsWith("wsl://") ? "wsl" : "ssh";
}

function parseConnections(connections: { [key: string]: ConnKeywords }): ConnectionInfo[] {
    if (!connections) return [];

    return Object.entries(connections).map(([name, config]) => ({
        name,
        type: getConnectionType(name),
        config: config || {},
    }));
}

function parseEnvString(envStr: string): { [key: string]: string } {
    const env: { [key: string]: string } = {};
    const lines = envStr.split("\n").filter((line) => line.trim());
    for (const line of lines) {
        const eqIndex = line.indexOf("=");
        if (eqIndex > 0) {
            const key = line.substring(0, eqIndex).trim();
            const value = line.substring(eqIndex + 1).trim();
            if (key) {
                env[key] = value;
            }
        }
    }
    return env;
}

function envToString(env: { [key: string]: string } | undefined): string {
    if (!env) return "";
    return Object.entries(env)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n");
}

function arrayToString(arr: string[] | undefined): string {
    if (!arr) return "";
    return arr.join("\n");
}

function stringToArray(str: string): string[] {
    return str
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s);
}

// ============================================
// Components
// ============================================

const LoadingSpinner = memo(({ message }: { message: string }) => {
    return (
        <div className="connections-loading">
            <i className="fa-sharp fa-solid fa-spinner fa-spin" />
            <span>{message}</span>
        </div>
    );
});
LoadingSpinner.displayName = "LoadingSpinner";

const EmptyState = memo(({ onAddConnection }: { onAddConnection: () => void }) => {
    return (
        <div className="connections-empty">
            <i className="fa-sharp fa-solid fa-plug" />
            <h3>No Connections</h3>
            <p>Add a connection to get started</p>
            <button className="connections-add-btn" onClick={onAddConnection}>
                <i className="fa-sharp fa-solid fa-plus" />
                <span>Add Connection</span>
            </button>
        </div>
    );
});
EmptyState.displayName = "EmptyState";

interface ConnectionListItemProps {
    connection: ConnectionInfo;
    isSelected: boolean;
    onSelect: () => void;
}

const ConnectionListItem = memo(({ connection, isSelected, onSelect }: ConnectionListItemProps) => {
    const icon = connection.type === "wsl" ? "linux" : "server";
    const isHidden = connection.config["display:hidden"];

    return (
        <div
            className={cn("connections-list-item", { selected: isSelected, hidden: isHidden })}
            onClick={onSelect}
        >
            <i className={`fa-sharp fa-solid fa-${icon}`} />
            <span className="connections-list-item-name">{connection.name}</span>
            {isHidden && <i className="fa-sharp fa-solid fa-eye-slash connections-list-item-hidden" />}
            <i className="fa-sharp fa-solid fa-chevron-right connections-list-item-arrow" />
        </div>
    );
});
ConnectionListItem.displayName = "ConnectionListItem";

interface AddConnectionFormProps {
    onCancel: () => void;
    onSubmit: (name: string) => void;
    existingNames: string[];
}

const AddConnectionForm = memo(({ onCancel, onSubmit, existingNames }: AddConnectionFormProps) => {
    const [name, setName] = useState("");
    const [error, setError] = useState<string | null>(null);
    const showWSL = isWindows();

    const handleSubmit = useCallback(() => {
        const trimmedName = name.trim();
        if (!trimmedName) {
            setError("Connection name is required");
            return;
        }
        if (existingNames.includes(trimmedName)) {
            setError("A connection with this name already exists");
            return;
        }
        onSubmit(trimmedName);
    }, [name, existingNames, onSubmit]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Enter") {
                handleSubmit();
            } else if (e.key === "Escape") {
                onCancel();
            }
        },
        [handleSubmit, onCancel]
    );

    return (
        <div className="connections-add-form">
            <h3>Add New Connection</h3>
            <div className="connections-add-form-field">
                <label>Connection Name</label>
                <input
                    type="text"
                    value={name}
                    onChange={(e) => {
                        setName(e.target.value);
                        setError(null);
                    }}
                    onKeyDown={handleKeyDown}
                    placeholder={showWSL ? "user@host or wsl://distro" : "user@host"}
                    autoFocus
                />
                <div className="connections-add-form-hint">
                    {showWSL
                        ? "Enter SSH connection (user@host) or WSL distribution (wsl://distro)"
                        : "Enter SSH connection in format: user@host or user@host:port"}
                </div>
                {error && <div className="connections-add-form-error">{error}</div>}
            </div>
            <div className="connections-add-form-actions">
                <button className="connections-btn secondary" onClick={onCancel}>
                    Cancel
                </button>
                <button className="connections-btn primary" onClick={handleSubmit}>
                    Add Connection
                </button>
            </div>
        </div>
    );
});
AddConnectionForm.displayName = "AddConnectionForm";

interface SettingFieldProps {
    field: SettingFieldDef;
    value: any;
    onChange: (key: keyof ConnKeywords, value: any) => void;
}

const SettingField = memo(({ field, value, onChange }: SettingFieldProps) => {
    const handleChange = useCallback(
        (newValue: any) => {
            onChange(field.key, newValue);
        },
        [field.key, onChange]
    );

    const renderInput = () => {
        switch (field.type) {
            case "boolean":
                return (
                    <label className="connections-toggle">
                        <input
                            type="checkbox"
                            checked={value ?? false}
                            onChange={(e) => handleChange(e.target.checked)}
                        />
                        <span className="connections-toggle-slider" />
                    </label>
                );

            case "number":
                return (
                    <input
                        type="number"
                        value={value ?? ""}
                        onChange={(e) => {
                            const num = e.target.value ? parseInt(e.target.value, 10) : undefined;
                            handleChange(isNaN(num) ? undefined : num);
                        }}
                        placeholder={field.placeholder}
                        className="connections-input"
                    />
                );

            case "string":
                return (
                    <input
                        type="text"
                        value={value ?? ""}
                        onChange={(e) => handleChange(e.target.value || undefined)}
                        placeholder={field.placeholder}
                        className="connections-input"
                    />
                );

            case "string[]":
                return (
                    <textarea
                        value={arrayToString(value)}
                        onChange={(e) => {
                            const arr = stringToArray(e.target.value);
                            handleChange(arr.length > 0 ? arr : undefined);
                        }}
                        placeholder={field.placeholder}
                        className="connections-textarea"
                        rows={3}
                    />
                );

            case "env":
                return (
                    <textarea
                        value={envToString(value)}
                        onChange={(e) => {
                            const env = parseEnvString(e.target.value);
                            handleChange(Object.keys(env).length > 0 ? env : undefined);
                        }}
                        placeholder="KEY=value&#10;ANOTHER_KEY=another value"
                        className="connections-textarea"
                        rows={4}
                    />
                );

            default:
                return null;
        }
    };

    return (
        <div className={cn("connections-field", { "connections-field-toggle": field.type === "boolean" })}>
            <div className="connections-field-header">
                <label className="connections-field-label">{field.label}</label>
                {field.type === "boolean" && renderInput()}
            </div>
            {field.description && <div className="connections-field-description">{field.description}</div>}
            {field.type !== "boolean" && <div className="connections-field-input">{renderInput()}</div>}
        </div>
    );
});
SettingField.displayName = "SettingField";

interface SettingsCategoryProps {
    category: SettingCategory;
    config: ConnKeywords;
    connectionType: ConnectionType;
    isExpanded: boolean;
    onToggle: () => void;
    onChange: (key: keyof ConnKeywords, value: any) => void;
}

const SettingsCategory = memo(
    ({ category, config, connectionType, isExpanded, onToggle, onChange }: SettingsCategoryProps) => {
        // Skip categories that don't apply to this connection type
        if (category.showFor && !category.showFor.includes(connectionType)) {
            return null;
        }

        return (
            <div className={cn("connections-category", { expanded: isExpanded })}>
                <button className="connections-category-header" onClick={onToggle}>
                    <i className={`fa-sharp fa-solid fa-${category.icon}`} />
                    <span>{category.label}</span>
                    <i className={`fa-sharp fa-solid fa-chevron-${isExpanded ? "down" : "right"}`} />
                </button>
                {isExpanded && (
                    <div className="connections-category-content">
                        {category.fields.map((field) => (
                            <SettingField
                                key={field.key}
                                field={field}
                                value={config[field.key]}
                                onChange={onChange}
                            />
                        ))}
                    </div>
                )}
            </div>
        );
    }
);
SettingsCategory.displayName = "SettingsCategory";

interface ConnectionEditorProps {
    connection: ConnectionInfo;
    onBack: () => void;
    onDelete: () => void;
    onSave: (config: ConnKeywords) => void;
}

const ConnectionEditor = memo(({ connection, onBack, onDelete, onSave }: ConnectionEditorProps) => {
    const [config, setConfig] = useState<ConnKeywords>(() => ({ ...connection.config }));
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(["connection"]));
    const [hasChanges, setHasChanges] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    const handleToggleCategory = useCallback((categoryId: string) => {
        setExpandedCategories((prev) => {
            const next = new Set(prev);
            if (next.has(categoryId)) {
                next.delete(categoryId);
            } else {
                next.add(categoryId);
            }
            return next;
        });
    }, []);

    const handleFieldChange = useCallback((key: keyof ConnKeywords, value: any) => {
        setConfig((prev) => {
            const next = { ...prev };
            if (value === undefined || value === null || value === "") {
                delete next[key];
            } else {
                (next as any)[key] = value;
            }
            return next;
        });
        setHasChanges(true);
    }, []);

    const handleSave = useCallback(async () => {
        setIsSaving(true);
        try {
            await onSave(config);
            setHasChanges(false);
        } finally {
            setIsSaving(false);
        }
    }, [config, onSave]);

    const handleDelete = useCallback(async () => {
        setIsDeleting(true);
        try {
            await onDelete();
        } finally {
            setIsDeleting(false);
            setShowDeleteConfirm(false);
        }
    }, [onDelete]);

    return (
        <div className="connections-editor">
            <div className="connections-editor-header">
                <button className="connections-back-btn" onClick={onBack}>
                    <i className="fa-sharp fa-solid fa-arrow-left" />
                    <span>Back</span>
                </button>
                <div className="connections-editor-title">
                    <i
                        className={`fa-sharp fa-solid fa-${connection.type === "wsl" ? "linux" : "server"}`}
                    />
                    <span>{connection.name}</span>
                </div>
                <div className="connections-editor-actions">
                    <button
                        className="connections-btn danger"
                        onClick={() => setShowDeleteConfirm(true)}
                        disabled={isSaving || isDeleting}
                    >
                        <i className="fa-sharp fa-solid fa-trash" />
                        <span>Delete</span>
                    </button>
                    <button
                        className="connections-btn primary"
                        onClick={handleSave}
                        disabled={!hasChanges || isSaving}
                    >
                        {isSaving ? (
                            <>
                                <i className="fa-sharp fa-solid fa-spinner fa-spin" />
                                <span>Saving...</span>
                            </>
                        ) : (
                            <>
                                <i className="fa-sharp fa-solid fa-check" />
                                <span>Save</span>
                            </>
                        )}
                    </button>
                </div>
            </div>

            {showDeleteConfirm && (
                <div className="connections-delete-confirm">
                    <div className="connections-delete-confirm-content">
                        <i className="fa-sharp fa-solid fa-triangle-exclamation" />
                        <div>
                            <strong>Delete connection?</strong>
                            <p>This will remove "{connection.name}" from your connections configuration.</p>
                        </div>
                    </div>
                    <div className="connections-delete-confirm-actions">
                        <button
                            className="connections-btn secondary"
                            onClick={() => setShowDeleteConfirm(false)}
                            disabled={isDeleting}
                        >
                            Cancel
                        </button>
                        <button className="connections-btn danger" onClick={handleDelete} disabled={isDeleting}>
                            {isDeleting ? "Deleting..." : "Delete"}
                        </button>
                    </div>
                </div>
            )}

            <div className="connections-editor-content">
                {SETTING_CATEGORIES.map((category) => (
                    <SettingsCategory
                        key={category.id}
                        category={category}
                        config={config}
                        connectionType={connection.type}
                        isExpanded={expandedCategories.has(category.id)}
                        onToggle={() => handleToggleCategory(category.id)}
                        onChange={handleFieldChange}
                    />
                ))}
            </div>
        </div>
    );
});
ConnectionEditor.displayName = "ConnectionEditor";

interface ConnectionsContentProps {
    model: WaveConfigViewModel;
}

export const ConnectionsContent = memo(({ model }: ConnectionsContentProps) => {
    const fullConfig = useAtomValue(atoms.fullConfigAtom);
    const [selectedConnection, setSelectedConnection] = useState<string | null>(null);
    const [isAddingNew, setIsAddingNew] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Parse connections from fullConfig
    const connections = useMemo(() => {
        return parseConnections(fullConfig?.connections || {});
    }, [fullConfig?.connections]);

    // Sort connections by display:order, then by name
    const sortedConnections = useMemo(() => {
        return [...connections].sort((a, b) => {
            const orderA = a.config["display:order"] ?? 0;
            const orderB = b.config["display:order"] ?? 0;
            if (orderA !== orderB) return orderA - orderB;
            return a.name.localeCompare(b.name);
        });
    }, [connections]);

    const existingNames = useMemo(() => connections.map((c) => c.name), [connections]);

    const selectedConnectionInfo = useMemo(() => {
        return connections.find((c) => c.name === selectedConnection) || null;
    }, [connections, selectedConnection]);

    // Clear selection if the selected connection no longer exists
    useEffect(() => {
        if (selectedConnection && !existingNames.includes(selectedConnection)) {
            setSelectedConnection(null);
        }
    }, [selectedConnection, existingNames]);

    const handleAddConnection = useCallback(async (name: string) => {
        setIsLoading(true);
        setError(null);
        try {
            // Create empty connection config
            const data: ConnConfigRequest = {
                host: name,
                metamaptype: {},
            };
            await RpcApi.SetConnectionsConfigCommand(TabRpcClient, data);
            setIsAddingNew(false);
            setSelectedConnection(name);
        } catch (err) {
            setError(`Failed to add connection: ${err.message || String(err)}`);
        } finally {
            setIsLoading(false);
        }
    }, []);

    const handleSaveConnection = useCallback(async (config: ConnKeywords) => {
        if (!selectedConnection) return;

        setError(null);
        try {
            const data: ConnConfigRequest = {
                host: selectedConnection,
                metamaptype: config as MetaType,
            };
            await RpcApi.SetConnectionsConfigCommand(TabRpcClient, data);
        } catch (err) {
            setError(`Failed to save connection: ${err.message || String(err)}`);
            throw err;
        }
    }, [selectedConnection]);

    const handleDeleteConnection = useCallback(async () => {
        if (!selectedConnection) return;

        setError(null);
        try {
            // Setting metamaptype to null/empty should delete the connection
            // We need to set all fields to null to remove them
            const data: ConnConfigRequest = {
                host: selectedConnection,
                metamaptype: null as any,
            };
            await RpcApi.SetConnectionsConfigCommand(TabRpcClient, data);
            setSelectedConnection(null);
        } catch (err) {
            setError(`Failed to delete connection: ${err.message || String(err)}`);
            throw err;
        }
    }, [selectedConnection]);

    const handleBack = useCallback(() => {
        setSelectedConnection(null);
    }, []);

    // Render content based on state
    const renderContent = () => {
        if (isAddingNew) {
            return (
                <AddConnectionForm
                    onCancel={() => setIsAddingNew(false)}
                    onSubmit={handleAddConnection}
                    existingNames={existingNames}
                />
            );
        }

        if (selectedConnectionInfo) {
            return (
                <ConnectionEditor
                    connection={selectedConnectionInfo}
                    onBack={handleBack}
                    onDelete={handleDeleteConnection}
                    onSave={handleSaveConnection}
                />
            );
        }

        if (connections.length === 0) {
            return <EmptyState onAddConnection={() => setIsAddingNew(true)} />;
        }

        return (
            <div className="connections-list-container">
                <div className="connections-list-header">
                    <h3>Connections</h3>
                    <button className="connections-add-btn small" onClick={() => setIsAddingNew(true)}>
                        <i className="fa-sharp fa-solid fa-plus" />
                        <span>Add</span>
                    </button>
                </div>
                <div className="connections-list">
                    {sortedConnections.map((conn) => (
                        <ConnectionListItem
                            key={conn.name}
                            connection={conn}
                            isSelected={selectedConnection === conn.name}
                            onSelect={() => setSelectedConnection(conn.name)}
                        />
                    ))}
                </div>
                <div className="connections-cli-info">
                    <div className="connections-cli-info-header">
                        <i className="fa-sharp fa-solid fa-terminal" />
                        <span>CLI Access</span>
                    </div>
                    <div className="connections-cli-info-commands">
                        wsh conn list
                        <br />
                        wsh conn show [name]
                        <br />
                        wsh ssh [user@host]
                    </div>
                </div>
            </div>
        );
    };

    if (isLoading && connections.length === 0) {
        return (
            <div className="connections-content">
                <LoadingSpinner message="Loading connections..." />
            </div>
        );
    }

    return (
        <div className="connections-content">
            {error && (
                <div className="connections-error">
                    <span>{error}</span>
                    <button onClick={() => setError(null)}>
                        <i className="fa-sharp fa-solid fa-times" />
                    </button>
                </div>
            )}
            {renderContent()}
        </div>
    );
});

ConnectionsContent.displayName = "ConnectionsContent";
