// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Connections Visual Content
 *
 * A visual component for managing SSH/WSL connection configurations.
 * Features a two-panel layout with a sidebar for connection list and
 * a main panel for editing connection settings grouped by category.
 */

import { atoms, getApi } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { isWindows } from "@/util/platformutil";
import { cn } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

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

/**
 * Validates a connection name for security and format requirements.
 * @param name The connection name to validate
 * @returns Object with valid boolean and optional error message
 */
function validateConnectionName(name: string): { valid: boolean; error?: string } {
    // Check for empty or whitespace-only names
    if (!name || !name.trim()) {
        return { valid: false, error: "Connection name cannot be empty" };
    }

    const trimmedName = name.trim();

    // Check maximum length (256 characters)
    if (trimmedName.length > 256) {
        return { valid: false, error: "Connection name must be 256 characters or less" };
    }

    // Check for path traversal sequences
    if (trimmedName.includes("..") || trimmedName.includes("./")) {
        return { valid: false, error: "Connection name cannot contain path traversal sequences (.. or ./)" };
    }

    // Allowed characters: alphanumeric, @, :, ., -, _, / (for WSL paths)
    // This regex matches any character that is NOT in the allowed set
    const invalidCharRegex = /[^a-zA-Z0-9@:.\-_/]/;
    const match = trimmedName.match(invalidCharRegex);
    if (match) {
        return {
            valid: false,
            error: `Connection name contains invalid character: "${match[0]}". Allowed: letters, numbers, @, :, ., -, _, /`,
        };
    }

    return { valid: true };
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

interface EmptyStateProps {
    onAddConnection: () => void;
    onAutoDetect: () => void;
    isDetecting: boolean;
}

const EmptyState = memo(({ onAddConnection, onAutoDetect, isDetecting }: EmptyStateProps) => {
    return (
        <div className="connections-empty">
            <i className="fa-sharp fa-solid fa-plug" />
            <h3>No Connections</h3>
            <p>
                Wave can automatically detect available shells
                <br />
                on your system including PowerShell, WSL, and more.
            </p>
            <button
                className="connections-add-btn connections-detect-btn-primary"
                onClick={onAutoDetect}
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
                        <span>Auto-Detect Shells</span>
                    </>
                )}
            </button>
            <div className="connections-empty-divider">
                <span>Or manually add a connection</span>
            </div>
            <button className="connections-btn secondary" onClick={onAddConnection}>
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

    // Validate name on every change to enable/disable submit button
    const validation = useMemo(() => validateConnectionName(name), [name]);

    // Check if name already exists (separate from format validation)
    const isDuplicate = useMemo(() => {
        const trimmedName = name.trim();
        return trimmedName && existingNames.includes(trimmedName);
    }, [name, existingNames]);

    // Determine if submit should be disabled
    const isSubmitDisabled = !validation.valid || isDuplicate;

    const handleSubmit = useCallback(() => {
        const trimmedName = name.trim();

        // Validate connection name format
        const validationResult = validateConnectionName(trimmedName);
        if (!validationResult.valid) {
            setError(validationResult.error);
            return;
        }

        // Check for duplicates
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
                <button className="connections-btn primary" onClick={handleSubmit} disabled={isSubmitDisabled}>
                    Add Connection
                </button>
            </div>
        </div>
    );
});
AddConnectionForm.displayName = "AddConnectionForm";

// ============================================
// Shell Detection Components
// ============================================

interface DetectedShellItemProps {
    shell: DetectedShell;
    isSelected: boolean;
    isAlreadyConfigured: boolean;
    onToggle: () => void;
}

const DetectedShellItem = memo(({ shell, isSelected, isAlreadyConfigured, onToggle }: DetectedShellItemProps) => {
    const icon = shell.icon || getShellIcon(shell.shelltype);

    return (
        <div
            className={cn("connections-detect-item", {
                selected: isSelected,
                disabled: isAlreadyConfigured,
            })}
            onClick={!isAlreadyConfigured ? onToggle : undefined}
        >
            <label className="connections-detect-item-checkbox">
                <input
                    type="checkbox"
                    checked={isSelected}
                    disabled={isAlreadyConfigured}
                    onChange={onToggle}
                    aria-label={`Select ${shell.name}`}
                />
                <span className="connections-detect-item-checkmark" />
            </label>
            <div className="connections-detect-item-icon">
                <i className={`fa-sharp fa-solid fa-${icon}`} />
            </div>
            <div className="connections-detect-item-info">
                <div className="connections-detect-item-name">
                    {shell.name}
                    {shell.version && <span className="connections-detect-item-version">{shell.version}</span>}
                    {shell.isdefault && <span className="connections-detect-item-badge default">Default</span>}
                    {isAlreadyConfigured && (
                        <span className="connections-detect-item-badge configured" aria-label="Already configured">
                            Already added
                        </span>
                    )}
                </div>
                <div className="connections-detect-item-path">{shell.shellpath || "System default"}</div>
            </div>
        </div>
    );
});
DetectedShellItem.displayName = "DetectedShellItem";

function getShellIcon(shelltype: string): string {
    switch (shelltype?.toLowerCase()) {
        case "pwsh":
        case "powershell":
            return "terminal";
        case "bash":
        case "zsh":
        case "fish":
        case "sh":
            return "dollar-sign";
        case "cmd":
            return "window";
        case "wsl":
            return "linux";
        default:
            return "terminal";
    }
}

interface DetectedShellsPanelProps {
    shells: DetectedShell[];
    selectedShells: Set<string>;
    configuredShellPaths: Set<string>;
    isLoading: boolean;
    error: string | null;
    onToggleShell: (shellId: string) => void;
    onSelectAll: () => void;
    onSelectNone: () => void;
    onAddSelected: () => void;
    onClose: () => void;
    onRetry: () => void;
}

const DetectedShellsPanel = memo(
    ({
        shells,
        selectedShells,
        configuredShellPaths,
        isLoading,
        error,
        onToggleShell,
        onSelectAll,
        onSelectNone,
        onAddSelected,
        onClose,
        onRetry,
    }: DetectedShellsPanelProps) => {
        const panelRef = useRef<HTMLDivElement>(null);

        // Handle Escape key
        useEffect(() => {
            const handleKeyDown = (e: KeyboardEvent) => {
                if (e.key === "Escape") {
                    onClose();
                }
            };
            document.addEventListener("keydown", handleKeyDown);
            return () => document.removeEventListener("keydown", handleKeyDown);
        }, [onClose]);

        // Count available (not already configured) shells
        const availableShells = useMemo(() => {
            return shells.filter((s) => !configuredShellPaths.has(s.shellpath));
        }, [shells, configuredShellPaths]);

        const selectedCount = selectedShells.size;
        const totalAvailable = availableShells.length;

        // Render loading state
        if (isLoading) {
            return (
                <div className="connections-detect-panel" role="dialog" aria-label="Detecting shells" ref={panelRef}>
                    <div className="connections-detect-panel-header">
                        <button className="connections-back-btn" onClick={onClose}>
                            <i className="fa-sharp fa-solid fa-arrow-left" />
                            <span>Back</span>
                        </button>
                        <h3>Detecting Shells</h3>
                        <button className="connections-detect-close" onClick={onClose} aria-label="Close">
                            <i className="fa-sharp fa-solid fa-times" />
                        </button>
                    </div>
                    <div className="connections-detect-loading">
                        <i className="fa-sharp fa-solid fa-spinner fa-spin" />
                        <span>Detecting available shells...</span>
                    </div>
                </div>
            );
        }

        // Render error state
        if (error) {
            return (
                <div className="connections-detect-panel" role="dialog" aria-label="Detection error" ref={panelRef}>
                    <div className="connections-detect-panel-header">
                        <button className="connections-back-btn" onClick={onClose}>
                            <i className="fa-sharp fa-solid fa-arrow-left" />
                            <span>Back</span>
                        </button>
                        <h3>Detection Error</h3>
                        <button className="connections-detect-close" onClick={onClose} aria-label="Close">
                            <i className="fa-sharp fa-solid fa-times" />
                        </button>
                    </div>
                    <div className="connections-detect-error">
                        <i className="fa-sharp fa-solid fa-triangle-exclamation" />
                        <span>{error}</span>
                        <button className="connections-btn primary" onClick={onRetry}>
                            <i className="fa-sharp fa-solid fa-rotate" />
                            <span>Retry</span>
                        </button>
                    </div>
                </div>
            );
        }

        // Render empty state
        if (shells.length === 0) {
            return (
                <div className="connections-detect-panel" role="dialog" aria-label="No shells detected" ref={panelRef}>
                    <div className="connections-detect-panel-header">
                        <button className="connections-back-btn" onClick={onClose}>
                            <i className="fa-sharp fa-solid fa-arrow-left" />
                            <span>Back</span>
                        </button>
                        <h3>Detected Shells</h3>
                        <button className="connections-detect-close" onClick={onClose} aria-label="Close">
                            <i className="fa-sharp fa-solid fa-times" />
                        </button>
                    </div>
                    <div className="connections-detect-empty">
                        <i className="fa-sharp fa-solid fa-terminal" />
                        <span>No shells detected on this system</span>
                        <button className="connections-btn secondary" onClick={onRetry}>
                            <i className="fa-sharp fa-solid fa-rotate" />
                            <span>Scan Again</span>
                        </button>
                    </div>
                </div>
            );
        }

        return (
            <div className="connections-detect-panel" role="dialog" aria-label="Detected shells" ref={panelRef}>
                <div className="connections-detect-panel-header">
                    <button className="connections-back-btn" onClick={onClose}>
                        <i className="fa-sharp fa-solid fa-arrow-left" />
                        <span>Back</span>
                    </button>
                    <h3>Detected Shells ({shells.length})</h3>
                    <button className="connections-detect-close" onClick={onClose} aria-label="Close">
                        <i className="fa-sharp fa-solid fa-times" />
                    </button>
                </div>

                <div className="connections-detect-list" aria-live="polite">
                    {shells.map((shell) => (
                        <DetectedShellItem
                            key={shell.id}
                            shell={shell}
                            isSelected={selectedShells.has(shell.id)}
                            isAlreadyConfigured={configuredShellPaths.has(shell.shellpath)}
                            onToggle={() => onToggleShell(shell.id)}
                        />
                    ))}
                </div>

                <div className="connections-detect-footer">
                    <div className="connections-detect-footer-left">
                        <button
                            className="connections-btn secondary"
                            onClick={onSelectAll}
                            disabled={selectedCount === totalAvailable}
                        >
                            Select All
                        </button>
                        <button
                            className="connections-btn secondary"
                            onClick={onSelectNone}
                            disabled={selectedCount === 0}
                        >
                            Select None
                        </button>
                    </div>
                    <div className="connections-detect-footer-right">
                        <button
                            className="connections-btn primary"
                            onClick={onAddSelected}
                            disabled={selectedCount === 0}
                        >
                            <i className="fa-sharp fa-solid fa-plus" />
                            <span>Add Selected ({selectedCount})</span>
                        </button>
                    </div>
                </div>
            </div>
        );
    }
);
DetectedShellsPanel.displayName = "DetectedShellsPanel";

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

    // Shell detection state
    const [isDetecting, setIsDetecting] = useState(false);
    const [showDetectionPanel, setShowDetectionPanel] = useState(false);
    const [detectedShells, setDetectedShells] = useState<DetectedShell[]>([]);
    const [selectedShells, setSelectedShells] = useState<Set<string>>(new Set());
    const [detectionError, setDetectionError] = useState<string | null>(null);

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

    // Get configured shell paths for duplicate detection
    const configuredShellPaths = useMemo(() => {
        const paths = new Set<string>();
        for (const conn of connections) {
            if (conn.config["conn:shellpath"]) {
                paths.add(conn.config["conn:shellpath"]);
            }
        }
        return paths;
    }, [connections]);

    const selectedConnectionInfo = useMemo(() => {
        return connections.find((c) => c.name === selectedConnection) || null;
    }, [connections, selectedConnection]);

    // Clear selection if the selected connection no longer exists
    useEffect(() => {
        if (selectedConnection && !existingNames.includes(selectedConnection)) {
            setSelectedConnection(null);
        }
    }, [selectedConnection, existingNames]);

    // Auto-detect handlers
    const handleAutoDetect = useCallback(async (rescan: boolean = false) => {
        setIsDetecting(true);
        setDetectionError(null);
        setShowDetectionPanel(true);

        try {
            const result = await RpcApi.DetectAvailableShellsCommand(TabRpcClient, {
                connectionname: "", // Empty for local detection
                rescan: rescan,
            });

            if (result.error) {
                setDetectionError(result.error);
                setDetectedShells([]);
            } else {
                setDetectedShells(result.shells || []);
                // Auto-select shells that are not already configured
                const autoSelected = new Set<string>();
                for (const shell of result.shells || []) {
                    if (!configuredShellPaths.has(shell.shellpath)) {
                        autoSelected.add(shell.id);
                    }
                }
                setSelectedShells(autoSelected);
            }
        } catch (err) {
            setDetectionError(`Detection failed: ${err.message || String(err)}`);
            setDetectedShells([]);
        } finally {
            setIsDetecting(false);
        }
    }, [configuredShellPaths]);

    const handleToggleShell = useCallback((shellId: string) => {
        setSelectedShells((prev) => {
            const next = new Set(prev);
            if (next.has(shellId)) {
                next.delete(shellId);
            } else {
                next.add(shellId);
            }
            return next;
        });
    }, []);

    const handleSelectAllShells = useCallback(() => {
        const allAvailable = new Set<string>();
        for (const shell of detectedShells) {
            if (!configuredShellPaths.has(shell.shellpath)) {
                allAvailable.add(shell.id);
            }
        }
        setSelectedShells(allAvailable);
    }, [detectedShells, configuredShellPaths]);

    const handleSelectNoneShells = useCallback(() => {
        setSelectedShells(new Set());
    }, []);

    const handleCloseDetectionPanel = useCallback(() => {
        setShowDetectionPanel(false);
        setDetectedShells([]);
        setSelectedShells(new Set());
        setDetectionError(null);
    }, []);

    const handleAddSelectedShells = useCallback(async () => {
        if (selectedShells.size === 0) return;

        setIsLoading(true);
        setError(null);

        let addedCount = 0;
        let skippedCount = 0;

        try {
            for (const shellId of selectedShells) {
                const shell = detectedShells.find((s) => s.id === shellId);
                if (!shell) continue;

                // Determine connection name
                let connName: string;
                if (shell.shelltype === "wsl") {
                    // For WSL, use wsl://distroName format
                    connName = `wsl://${shell.name}`;
                } else {
                    // For regular shells, use the display name
                    connName = shell.name;
                }

                // Validate connection name before adding
                const validation = validateConnectionName(connName);
                if (!validation.valid) {
                    console.warn(
                        `[connections] Skipping shell "${shell.name}": ${validation.error}`
                    );
                    skippedCount++;
                    continue;
                }

                // Create connection config with shell path
                const connConfig: ConnKeywords = {};
                if (shell.shellpath) {
                    connConfig["conn:shellpath"] = shell.shellpath;
                }

                const data: ConnConfigRequest = {
                    host: connName,
                    metamaptype: connConfig as MetaType,
                };
                await RpcApi.SetConnectionsConfigCommand(TabRpcClient, data);
                addedCount++;
            }

            // Close the panel after successful add
            handleCloseDetectionPanel();

            // Show warning if some shells were skipped
            if (skippedCount > 0) {
                console.warn(
                    `[connections] Added ${addedCount} shell(s), skipped ${skippedCount} due to invalid names`
                );
            }
        } catch (err) {
            setError(`Failed to add shells: ${err.message || String(err)}`);
        } finally {
            setIsLoading(false);
        }
    }, [selectedShells, detectedShells, handleCloseDetectionPanel]);

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
            // Read the connections file, remove the connection, and write back
            const configDir = getApi().getConfigDir();
            const fullPath = `${configDir}/connections.json`;

            // Read current connections
            let connectionsData: { [key: string]: ConnKeywords } = {};
            try {
                const fileData = await RpcApi.FileReadCommand(TabRpcClient, {
                    info: { path: fullPath },
                });
                if (fileData?.data64) {
                    const content = atob(fileData.data64);
                    if (content.trim()) {
                        connectionsData = JSON.parse(content);
                    }
                }
            } catch {
                // File doesn't exist or is empty - nothing to delete
                setSelectedConnection(null);
                return;
            }

            // Remove the connection
            delete connectionsData[selectedConnection];

            // Write back
            const encoded = btoa(JSON.stringify(connectionsData, null, 2));
            await RpcApi.FileWriteCommand(TabRpcClient, {
                info: { path: fullPath },
                data64: encoded,
            });

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
        // Show detection panel if active
        if (showDetectionPanel) {
            return (
                <DetectedShellsPanel
                    shells={detectedShells}
                    selectedShells={selectedShells}
                    configuredShellPaths={configuredShellPaths}
                    isLoading={isDetecting}
                    error={detectionError}
                    onToggleShell={handleToggleShell}
                    onSelectAll={handleSelectAllShells}
                    onSelectNone={handleSelectNoneShells}
                    onAddSelected={handleAddSelectedShells}
                    onClose={handleCloseDetectionPanel}
                    onRetry={() => handleAutoDetect(true)}
                />
            );
        }

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
            return (
                <EmptyState
                    onAddConnection={() => setIsAddingNew(true)}
                    onAutoDetect={() => handleAutoDetect(false)}
                    isDetecting={isDetecting}
                />
            );
        }

        return (
            <div className="connections-list-container">
                <div className="connections-list-header">
                    <h3>Connections</h3>
                    <div className="connections-list-header-actions">
                        <button
                            className="connections-detect-btn"
                            onClick={() => handleAutoDetect(false)}
                            disabled={isDetecting}
                            title="Auto-detect shells"
                            aria-label="Auto-detect shells"
                        >
                            {isDetecting ? (
                                <i className="fa-sharp fa-solid fa-spinner fa-spin" />
                            ) : (
                                <i className="fa-sharp fa-solid fa-wand-magic-sparkles" />
                            )}
                        </button>
                        <button className="connections-add-btn small" onClick={() => setIsAddingNew(true)}>
                            <i className="fa-sharp fa-solid fa-plus" />
                            <span>Add</span>
                        </button>
                    </div>
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
