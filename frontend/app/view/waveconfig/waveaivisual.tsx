// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms, getApi } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import {
    computeModeStatus,
    isLocalEndpoint,
    ModeStatus,
    ProviderStatusBadge,
} from "@/app/view/waveconfig/provider-status-badge";
import { base64ToString, cn, stringToBase64 } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

import "./waveai-visual.scss";

// ============================================
// Types
// ============================================

type TokenMode = "secret" | "direct";

interface ModeFormData {
    key: string;
    "display:name": string;
    "display:order"?: number;
    "display:icon"?: string;
    "display:description"?: string;
    "ai:provider"?: string;
    "ai:apitype"?: string;
    "ai:model"?: string;
    "ai:thinkinglevel"?: string;
    "ai:endpoint"?: string;
    "ai:azureapiversion"?: string;
    "ai:apitoken"?: string;
    "ai:apitokensecretname"?: string;
    "ai:azureresourcename"?: string;
    "ai:azuredeployment"?: string;
    "ai:capabilities"?: string[];
    "ai:switchcompat"?: string[];
}

// Provider options
const PROVIDER_OPTIONS = [
    { value: "", label: "-- Select Provider --" },
    { value: "wave", label: "Wave (Cloud)" },
    { value: "openai", label: "OpenAI" },
    { value: "google", label: "Google AI (Gemini)" },
    { value: "openrouter", label: "OpenRouter" },
    { value: "azure", label: "Azure OpenAI" },
    { value: "azure-legacy", label: "Azure OpenAI (Legacy)" },
    { value: "custom", label: "Custom Endpoint" },
];

// API type options
const API_TYPE_OPTIONS = [
    { value: "", label: "-- Auto-detect --" },
    { value: "openai-chat", label: "OpenAI Chat (/v1/chat/completions)" },
    { value: "openai-responses", label: "OpenAI Responses (/v1/responses)" },
    { value: "google-gemini", label: "Google Gemini" },
    { value: "anthropic", label: "Anthropic Messages API" },
];

// Thinking level options
const THINKING_LEVEL_OPTIONS = [
    { value: "", label: "-- Not Set --" },
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
];

// Capability options
const CAPABILITY_OPTIONS = [
    { value: "tools", label: "Tools", description: "Enable AI tool usage" },
    { value: "images", label: "Images", description: "Allow image attachments" },
    { value: "pdfs", label: "PDFs", description: "Allow PDF attachments" },
];

// ============================================
// Helper Functions
// ============================================

function getProviderLabel(provider: string | undefined): string {
    const option = PROVIDER_OPTIONS.find((o) => o.value === provider);
    return option?.label || provider || "Unknown";
}

function getDefaultSecretName(provider: string | undefined): string {
    switch (provider) {
        case "openai":
            return "OPENAI_KEY";
        case "google":
            return "GOOGLE_AI_KEY";
        case "openrouter":
            return "OPENROUTER_KEY";
        case "azure":
        case "azure-legacy":
            return "AZURE_OPENAI_KEY";
        default:
            return "";
    }
}

function isDefaultMode(modeKey: string): boolean {
    return modeKey.startsWith("waveai@");
}

function isTemplateMode(modeKey: string): boolean {
    return modeKey.startsWith("provider@");
}

function modeKeyToFormData(key: string, mode: AIModeConfigType): ModeFormData {
    return {
        key,
        "display:name": mode["display:name"] || "",
        "display:order": mode["display:order"],
        "display:icon": mode["display:icon"] || "",
        "display:description": mode["display:description"] || "",
        "ai:provider": mode["ai:provider"] || "",
        "ai:apitype": mode["ai:apitype"] || "",
        "ai:model": mode["ai:model"] || "",
        "ai:thinkinglevel": mode["ai:thinkinglevel"] || "",
        "ai:endpoint": mode["ai:endpoint"] || "",
        "ai:azureapiversion": mode["ai:azureapiversion"] || "",
        "ai:apitoken": mode["ai:apitoken"] || "",
        "ai:apitokensecretname": mode["ai:apitokensecretname"] || "",
        "ai:azureresourcename": mode["ai:azureresourcename"] || "",
        "ai:azuredeployment": mode["ai:azuredeployment"] || "",
        "ai:capabilities": mode["ai:capabilities"] || [],
        "ai:switchcompat": mode["ai:switchcompat"] || [],
    };
}

function formDataToModeConfig(form: ModeFormData): AIModeConfigType {
    const config: AIModeConfigType = {
        "display:name": form["display:name"],
    };

    if (form["display:order"] != null) config["display:order"] = form["display:order"];
    if (form["display:icon"]) config["display:icon"] = form["display:icon"];
    if (form["display:description"]) config["display:description"] = form["display:description"];
    if (form["ai:provider"]) config["ai:provider"] = form["ai:provider"];
    if (form["ai:apitype"]) config["ai:apitype"] = form["ai:apitype"];
    if (form["ai:model"]) config["ai:model"] = form["ai:model"];
    if (form["ai:thinkinglevel"]) config["ai:thinkinglevel"] = form["ai:thinkinglevel"];
    if (form["ai:endpoint"]) config["ai:endpoint"] = form["ai:endpoint"];
    if (form["ai:azureapiversion"]) config["ai:azureapiversion"] = form["ai:azureapiversion"];
    if (form["ai:apitoken"]) config["ai:apitoken"] = form["ai:apitoken"];
    if (form["ai:apitokensecretname"]) config["ai:apitokensecretname"] = form["ai:apitokensecretname"];
    if (form["ai:azureresourcename"]) config["ai:azureresourcename"] = form["ai:azureresourcename"];
    if (form["ai:azuredeployment"]) config["ai:azuredeployment"] = form["ai:azuredeployment"];
    if (form["ai:capabilities"] && form["ai:capabilities"].length > 0) {
        config["ai:capabilities"] = form["ai:capabilities"];
    }
    if (form["ai:switchcompat"] && form["ai:switchcompat"].length > 0) {
        config["ai:switchcompat"] = form["ai:switchcompat"];
    }

    return config;
}

// ============================================
// Mode List Item Component
// ============================================

interface ModeListItemProps {
    modeKey: string;
    mode: AIModeConfigType;
    isSelected: boolean;
    onSelect: () => void;
    status?: ModeStatus;
    onNavigateToSecrets?: () => void;
}

const ModeListItem = memo(({ modeKey, mode, isSelected, onSelect, status, onNavigateToSecrets }: ModeListItemProps) => {
    const isDefault = isDefaultMode(modeKey);
    const isTemplate = isTemplateMode(modeKey);
    const icon = mode["display:icon"] || "sparkles";
    const isCloud = mode["waveai:cloud"];
    const isPremium = mode["waveai:premium"];

    return (
        <div
            className={cn("waveai-mode-item", {
                active: isSelected,
                "is-default": isDefault,
                "is-template": isTemplate,
            })}
            onClick={onSelect}
        >
            <div className="waveai-mode-icon">
                <i className={`fa fa-solid fa-${icon}`} />
            </div>
            <div className="waveai-mode-info">
                <div className="waveai-mode-name">{mode["display:name"]}</div>
                <div className="waveai-mode-provider">
                    {isDefault ? "Wave Cloud" : getProviderLabel(mode["ai:provider"])}
                </div>
            </div>
            <div className="waveai-mode-badges">
                {isCloud && <span className="waveai-mode-badge cloud">Cloud</span>}
                {isPremium && <span className="waveai-mode-badge premium">Premium</span>}
                {isTemplate && <span className="waveai-mode-badge template">Template</span>}
            </div>
            {status && (
                <ProviderStatusBadge
                    status={status}
                    secretName={mode["ai:apitokensecretname"]}
                    endpoint={mode["ai:endpoint"]}
                    onNavigateToSecrets={onNavigateToSecrets}
                />
            )}
            <i className="fa fa-solid fa-chevron-right waveai-mode-chevron" />
        </div>
    );
});

ModeListItem.displayName = "ModeListItem";

// ============================================
// Mode Editor Component
// ============================================

interface ModeEditorProps {
    modeKey: string;
    mode: AIModeConfigType;
    onSave: (key: string, config: AIModeConfigType) => void;
    onDelete: (key: string) => void;
    onDuplicate?: (key: string, mode: AIModeConfigType) => void;
    isLoading: boolean;
}

const ModeEditor = memo(({ modeKey, mode, onSave, onDelete, onDuplicate, isLoading }: ModeEditorProps) => {
    const isDefault = isDefaultMode(modeKey);
    const isTemplate = isTemplateMode(modeKey);
    const isReadOnly = isDefault || isTemplate;
    const [form, setForm] = useState<ModeFormData>(() => modeKeyToFormData(modeKey, mode));
    const [tokenMode, setTokenMode] = useState<TokenMode>(() =>
        form["ai:apitoken"] ? "direct" : "secret"
    );
    const [hasChanges, setHasChanges] = useState(false);

    // Reset form when mode changes
    useEffect(() => {
        const newForm = modeKeyToFormData(modeKey, mode);
        setForm(newForm);
        setTokenMode(newForm["ai:apitoken"] ? "direct" : "secret");
        setHasChanges(false);
    }, [modeKey, mode]);

    const updateField = useCallback(<K extends keyof ModeFormData>(field: K, value: ModeFormData[K]) => {
        setForm((prev) => ({ ...prev, [field]: value }));
        setHasChanges(true);
    }, []);

    const handleCapabilityChange = useCallback((capability: string, checked: boolean) => {
        setForm((prev) => {
            const caps = new Set(prev["ai:capabilities"] || []);
            if (checked) {
                caps.add(capability);
            } else {
                caps.delete(capability);
            }
            return { ...prev, "ai:capabilities": Array.from(caps) };
        });
        setHasChanges(true);
    }, []);

    const handleSave = useCallback(() => {
        // Clear the token field that isn't being used
        const saveForm = { ...form };
        if (tokenMode === "secret") {
            saveForm["ai:apitoken"] = "";
        } else {
            saveForm["ai:apitokensecretname"] = "";
        }
        onSave(modeKey, formDataToModeConfig(saveForm));
        setHasChanges(false);
    }, [form, tokenMode, modeKey, onSave]);

    const handleDelete = useCallback(() => {
        if (window.confirm(`Are you sure you want to delete the mode "${form["display:name"]}"?`)) {
            onDelete(modeKey);
        }
    }, [modeKey, form, onDelete]);

    const handleDuplicate = useCallback(() => {
        if (onDuplicate) {
            onDuplicate(modeKey, mode);
        }
    }, [modeKey, mode, onDuplicate]);

    // Determine which fields to show based on provider
    const provider = form["ai:provider"];
    const showEndpoint = provider === "custom" || !provider;
    const showApiType = provider === "custom" || !provider;
    const showAzureResource = provider === "azure" || provider === "azure-legacy";
    const showAzureDeployment = provider === "azure-legacy";
    const showAzureApiVersion = provider === "azure-legacy";
    const showModel = provider !== "wave";
    const showTokenConfig = provider !== "wave" && provider !== "";

    return (
        <div className="waveai-mode-editor">
            <div className="waveai-editor-header">
                <div className="waveai-editor-title">
                    <div className="waveai-editor-icon">
                        <i className={`fa fa-solid fa-${form["display:icon"] || "sparkles"}`} />
                    </div>
                    <div>
                        <div className="waveai-editor-name">{form["display:name"] || "New Mode"}</div>
                        <div className="waveai-editor-key">{modeKey}</div>
                    </div>
                </div>
                <div className="waveai-editor-actions">
                    {isTemplate && onDuplicate && (
                        <button
                            className="waveai-duplicate-btn"
                            onClick={handleDuplicate}
                            disabled={isLoading}
                        >
                            <i className="fa fa-solid fa-copy" />
                            Duplicate & Edit
                        </button>
                    )}
                    {!isReadOnly && (
                        <button
                            className="waveai-delete-btn"
                            onClick={handleDelete}
                            disabled={isLoading}
                        >
                            <i className="fa fa-solid fa-trash" />
                            Delete
                        </button>
                    )}
                    {!isReadOnly && (
                        <button
                            className="waveai-save-btn"
                            onClick={handleSave}
                            disabled={isLoading || !hasChanges || !form["display:name"]}
                        >
                            {isLoading ? (
                                <>
                                    <i className="fa fa-solid fa-spinner fa-spin" />
                                    Saving...
                                </>
                            ) : (
                                <>
                                    <i className="fa fa-solid fa-save" />
                                    Save Changes
                                </>
                            )}
                        </button>
                    )}
                </div>
            </div>

            <div className="waveai-editor-content">
                {isDefault && (
                    <div className="waveai-readonly-notice">
                        <i className="fa fa-solid fa-info-circle" />
                        This is a built-in Wave Cloud mode and cannot be edited. Create a new mode to customize.
                    </div>
                )}
                {isTemplate && (
                    <div className="waveai-readonly-notice template">
                        <i className="fa fa-solid fa-cube" />
                        This is a pre-configured template. Click "Duplicate & Edit" to create your own customized version.
                    </div>
                )}

                {/* Display Settings Section */}
                <div className="waveai-form-section">
                    <div className="waveai-form-section-header">
                        <i className="fa fa-solid fa-palette" />
                        Display Settings
                    </div>
                    <div className="waveai-form-section-content">
                        <div className="waveai-form-row">
                            <div className="waveai-form-field">
                                <label className="waveai-field-label">
                                    Name <span className="required">*</span>
                                </label>
                                <input
                                    type="text"
                                    className="waveai-input"
                                    value={form["display:name"]}
                                    onChange={(e) => updateField("display:name", e.target.value)}
                                    placeholder="My AI Mode"
                                    disabled={isReadOnly}
                                />
                            </div>
                            <div className="waveai-form-field half">
                                <label className="waveai-field-label">Display Order</label>
                                <input
                                    type="number"
                                    className="waveai-input"
                                    value={form["display:order"] ?? ""}
                                    onChange={(e) =>
                                        updateField(
                                            "display:order",
                                            e.target.value ? parseInt(e.target.value, 10) : undefined
                                        )
                                    }
                                    placeholder="0"
                                    disabled={isReadOnly}
                                />
                                <div className="waveai-field-help">Lower numbers appear first</div>
                            </div>
                        </div>
                        <div className="waveai-form-row">
                            <div className="waveai-form-field half">
                                <label className="waveai-field-label">Icon</label>
                                <div className="waveai-icon-picker">
                                    <div className="waveai-icon-preview">
                                        <i className={`fa fa-solid fa-${form["display:icon"] || "sparkles"}`} />
                                    </div>
                                    <input
                                        type="text"
                                        className="waveai-input mono"
                                        value={form["display:icon"] || ""}
                                        onChange={(e) => updateField("display:icon", e.target.value)}
                                        placeholder="sparkles"
                                        disabled={isReadOnly}
                                    />
                                </div>
                                <div className="waveai-field-help">FontAwesome icon name (without fa- prefix)</div>
                            </div>
                        </div>
                        <div className="waveai-form-row">
                            <div className="waveai-form-field">
                                <label className="waveai-field-label">Description</label>
                                <textarea
                                    className="waveai-textarea"
                                    value={form["display:description"] || ""}
                                    onChange={(e) => updateField("display:description", e.target.value)}
                                    placeholder="Description of this AI mode..."
                                    disabled={isReadOnly}
                                    rows={2}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Provider Settings Section */}
                <div className="waveai-form-section">
                    <div className="waveai-form-section-header">
                        <i className="fa fa-solid fa-plug" />
                        Provider Settings
                    </div>
                    <div className="waveai-form-section-content">
                        <div className="waveai-form-row">
                            <div className="waveai-form-field half">
                                <label className="waveai-field-label">Provider</label>
                                <select
                                    className="waveai-select"
                                    value={form["ai:provider"] || ""}
                                    onChange={(e) => updateField("ai:provider", e.target.value)}
                                    disabled={isReadOnly}
                                >
                                    {PROVIDER_OPTIONS.map((opt) => (
                                        <option key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            {showApiType && (
                                <div className="waveai-form-field half">
                                    <label className="waveai-field-label">API Type</label>
                                    <select
                                        className="waveai-select"
                                        value={form["ai:apitype"] || ""}
                                        onChange={(e) => updateField("ai:apitype", e.target.value)}
                                        disabled={isReadOnly}
                                    >
                                        {API_TYPE_OPTIONS.map((opt) => (
                                            <option key={opt.value} value={opt.value}>
                                                {opt.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </div>

                        {showModel && (
                            <div className="waveai-form-row">
                                <div className="waveai-form-field">
                                    <label className="waveai-field-label">Model</label>
                                    <input
                                        type="text"
                                        className="waveai-input mono"
                                        value={form["ai:model"] || ""}
                                        onChange={(e) => updateField("ai:model", e.target.value)}
                                        placeholder="gpt-4o, llama3.3:70b, gemini-pro..."
                                        disabled={isReadOnly}
                                    />
                                </div>
                            </div>
                        )}

                        {showEndpoint && (
                            <div className="waveai-form-row">
                                <div className="waveai-form-field">
                                    <label className="waveai-field-label">Endpoint URL</label>
                                    <input
                                        type="text"
                                        className="waveai-input mono"
                                        value={form["ai:endpoint"] || ""}
                                        onChange={(e) => updateField("ai:endpoint", e.target.value)}
                                        placeholder="http://localhost:11434/v1/chat/completions"
                                        disabled={isReadOnly}
                                    />
                                    <div className="waveai-field-help">Full URL including path</div>
                                </div>
                            </div>
                        )}

                        {showAzureResource && (
                            <div className="waveai-form-row">
                                <div className="waveai-form-field">
                                    <label className="waveai-field-label">Azure Resource Name</label>
                                    <input
                                        type="text"
                                        className="waveai-input"
                                        value={form["ai:azureresourcename"] || ""}
                                        onChange={(e) => updateField("ai:azureresourcename", e.target.value)}
                                        placeholder="your-resource-name"
                                        disabled={isReadOnly}
                                    />
                                </div>
                            </div>
                        )}

                        {showAzureDeployment && (
                            <div className="waveai-form-row">
                                <div className="waveai-form-field half">
                                    <label className="waveai-field-label">Azure Deployment</label>
                                    <input
                                        type="text"
                                        className="waveai-input"
                                        value={form["ai:azuredeployment"] || ""}
                                        onChange={(e) => updateField("ai:azuredeployment", e.target.value)}
                                        placeholder="your-deployment-name"
                                        disabled={isReadOnly}
                                    />
                                </div>
                                {showAzureApiVersion && (
                                    <div className="waveai-form-field half">
                                        <label className="waveai-field-label">API Version</label>
                                        <input
                                            type="text"
                                            className="waveai-input"
                                            value={form["ai:azureapiversion"] || ""}
                                            onChange={(e) => updateField("ai:azureapiversion", e.target.value)}
                                            placeholder="2025-04-01-preview"
                                            disabled={isReadOnly}
                                        />
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="waveai-form-row">
                            <div className="waveai-form-field half">
                                <label className="waveai-field-label">Thinking Level</label>
                                <select
                                    className="waveai-select"
                                    value={form["ai:thinkinglevel"] || ""}
                                    onChange={(e) => updateField("ai:thinkinglevel", e.target.value)}
                                    disabled={isReadOnly}
                                >
                                    {THINKING_LEVEL_OPTIONS.map((opt) => (
                                        <option key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>
                </div>

                {/* API Token Section */}
                {showTokenConfig && (
                    <div className="waveai-form-section">
                        <div className="waveai-form-section-header">
                            <i className="fa fa-solid fa-key" />
                            Authentication
                        </div>
                        <div className="waveai-form-section-content">
                            <div className="waveai-token-mode">
                                <label
                                    className={cn("waveai-token-option", { active: tokenMode === "secret" })}
                                    onClick={() => {
                                        setTokenMode("secret");
                                        setHasChanges(true);
                                    }}
                                >
                                    <input
                                        type="radio"
                                        name="tokenMode"
                                        checked={tokenMode === "secret"}
                                        onChange={() => {}}
                                        disabled={isReadOnly}
                                    />
                                    <span>Use Secret (Recommended)</span>
                                </label>
                                <label
                                    className={cn("waveai-token-option", { active: tokenMode === "direct" })}
                                    onClick={() => {
                                        setTokenMode("direct");
                                        setHasChanges(true);
                                    }}
                                >
                                    <input
                                        type="radio"
                                        name="tokenMode"
                                        checked={tokenMode === "direct"}
                                        onChange={() => {}}
                                        disabled={isReadOnly}
                                    />
                                    <span>Direct Token</span>
                                </label>
                            </div>

                            {tokenMode === "secret" ? (
                                <div className="waveai-form-row">
                                    <div className="waveai-form-field">
                                        <label className="waveai-field-label">Secret Name</label>
                                        <input
                                            type="text"
                                            className="waveai-input mono"
                                            value={form["ai:apitokensecretname"] || ""}
                                            onChange={(e) => updateField("ai:apitokensecretname", e.target.value)}
                                            placeholder={getDefaultSecretName(provider) || "MY_API_KEY"}
                                            disabled={isReadOnly}
                                        />
                                        <div className="waveai-field-help">
                                            Reference to a secret stored in Wave's secret manager.
                                            {provider && getDefaultSecretName(provider) && (
                                                <> Default for {getProviderLabel(provider)}: <code>{getDefaultSecretName(provider)}</code></>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="waveai-form-row">
                                    <div className="waveai-form-field">
                                        <label className="waveai-field-label">API Token</label>
                                        <input
                                            type="password"
                                            className="waveai-input mono"
                                            value={form["ai:apitoken"] || ""}
                                            onChange={(e) => updateField("ai:apitoken", e.target.value)}
                                            placeholder="sk-..."
                                            disabled={isReadOnly}
                                        />
                                        <div className="waveai-field-help">
                                            Not recommended - tokens are stored in plaintext. Use secrets instead.
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Capabilities Section */}
                <div className="waveai-form-section">
                    <div className="waveai-form-section-header">
                        <i className="fa fa-solid fa-wand-magic-sparkles" />
                        Capabilities
                    </div>
                    <div className="waveai-form-section-content">
                        <div className="waveai-checkbox-group">
                            {CAPABILITY_OPTIONS.map((cap) => (
                                <label key={cap.value} className="waveai-checkbox">
                                    <input
                                        type="checkbox"
                                        checked={form["ai:capabilities"]?.includes(cap.value) || false}
                                        onChange={(e) => handleCapabilityChange(cap.value, e.target.checked)}
                                        disabled={isReadOnly}
                                    />
                                    <span className="waveai-checkbox-label">{cap.label}</span>
                                </label>
                            ))}
                        </div>
                        <div className="waveai-field-help" style={{ marginTop: 8 }}>
                            Capabilities control what features the AI mode supports. Most modes should have "Tools" enabled.
                        </div>
                    </div>
                </div>

                {/* Switch Compatibility Section */}
                <div className="waveai-form-section">
                    <div className="waveai-form-section-header">
                        <i className="fa fa-solid fa-shuffle" />
                        Switch Compatibility
                    </div>
                    <div className="waveai-form-section-content">
                        <div className="waveai-form-row">
                            <div className="waveai-form-field">
                                <label className="waveai-field-label">Compatible Mode Keys</label>
                                <input
                                    type="text"
                                    className="waveai-input mono"
                                    value={(form["ai:switchcompat"] || []).join(", ")}
                                    onChange={(e) => {
                                        const values = e.target.value
                                            .split(",")
                                            .map((s) => s.trim())
                                            .filter((s) => s.length > 0);
                                        updateField("ai:switchcompat", values);
                                    }}
                                    placeholder="mode-key-1, mode-key-2"
                                    disabled={isReadOnly}
                                />
                                <div className="waveai-field-help">
                                    Comma-separated list of mode keys that this mode can switch to mid-conversation.
                                    Used for grouping compatible modes in the AI panel.
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
});

ModeEditor.displayName = "ModeEditor";

// ============================================
// Add Mode Form Component
// ============================================

interface AddModeFormProps {
    onSave: (key: string, config: AIModeConfigType) => void;
    onCancel: () => void;
    isLoading: boolean;
    existingKeys: Set<string>;
}

const AddModeForm = memo(({ onSave, onCancel, isLoading, existingKeys }: AddModeFormProps) => {
    const [modeKey, setModeKey] = useState("");
    const [form, setForm] = useState<ModeFormData>(() => ({
        key: "",
        "display:name": "",
        "ai:provider": "",
        "ai:capabilities": ["tools"],
    }));
    const [tokenMode, setTokenMode] = useState<TokenMode>("secret");

    const keyError = useMemo(() => {
        if (!modeKey) return null;
        if (!/^[a-zA-Z0-9_@.-]+$/.test(modeKey)) {
            return "Key can only contain letters, numbers, underscores, @, dots, and hyphens";
        }
        if (existingKeys.has(modeKey)) {
            return "A mode with this key already exists";
        }
        return null;
    }, [modeKey, existingKeys]);

    const canSave = modeKey && !keyError && form["display:name"];

    const updateField = useCallback(<K extends keyof ModeFormData>(field: K, value: ModeFormData[K]) => {
        setForm((prev) => ({ ...prev, [field]: value }));
    }, []);

    const handleCapabilityChange = useCallback((capability: string, checked: boolean) => {
        setForm((prev) => {
            const caps = new Set(prev["ai:capabilities"] || []);
            if (checked) {
                caps.add(capability);
            } else {
                caps.delete(capability);
            }
            return { ...prev, "ai:capabilities": Array.from(caps) };
        });
    }, []);

    const handleSave = useCallback(() => {
        if (!canSave) return;
        const saveForm = { ...form };
        if (tokenMode === "secret") {
            saveForm["ai:apitoken"] = "";
        } else {
            saveForm["ai:apitokensecretname"] = "";
        }
        onSave(modeKey, formDataToModeConfig(saveForm));
    }, [form, tokenMode, modeKey, canSave, onSave]);

    const provider = form["ai:provider"];
    const showEndpoint = provider === "custom" || !provider;
    const showApiType = provider === "custom" || !provider;
    const showAzureResource = provider === "azure" || provider === "azure-legacy";
    const showAzureDeployment = provider === "azure-legacy";
    const showAzureApiVersion = provider === "azure-legacy";
    const showModel = provider !== "wave";
    const showTokenConfig = provider !== "wave" && provider !== "";

    return (
        <div className="waveai-mode-editor">
            <div className="waveai-editor-header">
                <div className="waveai-editor-title">
                    <div className="waveai-editor-icon">
                        <i className={`fa fa-solid fa-${form["display:icon"] || "plus"}`} />
                    </div>
                    <div>
                        <div className="waveai-editor-name">New AI Mode</div>
                        <div className="waveai-editor-key">{modeKey || "enter-mode-key"}</div>
                    </div>
                </div>
                <div className="waveai-editor-actions">
                    <button className="waveai-delete-btn" onClick={onCancel} disabled={isLoading}>
                        Cancel
                    </button>
                    <button
                        className="waveai-save-btn"
                        onClick={handleSave}
                        disabled={isLoading || !canSave}
                    >
                        {isLoading ? (
                            <>
                                <i className="fa fa-solid fa-spinner fa-spin" />
                                Creating...
                            </>
                        ) : (
                            <>
                                <i className="fa fa-solid fa-plus" />
                                Create Mode
                            </>
                        )}
                    </button>
                </div>
            </div>

            <div className="waveai-editor-content">
                {/* Mode Key Section */}
                <div className="waveai-form-section">
                    <div className="waveai-form-section-header">
                        <i className="fa fa-solid fa-fingerprint" />
                        Mode Identifier
                    </div>
                    <div className="waveai-form-section-content">
                        <div className="waveai-form-row">
                            <div className="waveai-form-field">
                                <label className="waveai-field-label">
                                    Mode Key <span className="required">*</span>
                                </label>
                                <input
                                    type="text"
                                    className="waveai-input mono"
                                    value={modeKey}
                                    onChange={(e) => setModeKey(e.target.value)}
                                    placeholder="my-custom-mode"
                                />
                                {keyError ? (
                                    <div className="waveai-field-help" style={{ color: "var(--error-color)" }}>
                                        {keyError}
                                    </div>
                                ) : (
                                    <div className="waveai-field-help">
                                        Unique identifier for this mode. Used in settings and CLI.
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Display Settings Section */}
                <div className="waveai-form-section">
                    <div className="waveai-form-section-header">
                        <i className="fa fa-solid fa-palette" />
                        Display Settings
                    </div>
                    <div className="waveai-form-section-content">
                        <div className="waveai-form-row">
                            <div className="waveai-form-field">
                                <label className="waveai-field-label">
                                    Name <span className="required">*</span>
                                </label>
                                <input
                                    type="text"
                                    className="waveai-input"
                                    value={form["display:name"]}
                                    onChange={(e) => updateField("display:name", e.target.value)}
                                    placeholder="My AI Mode"
                                />
                            </div>
                            <div className="waveai-form-field half">
                                <label className="waveai-field-label">Display Order</label>
                                <input
                                    type="number"
                                    className="waveai-input"
                                    value={form["display:order"] ?? ""}
                                    onChange={(e) =>
                                        updateField(
                                            "display:order",
                                            e.target.value ? parseInt(e.target.value, 10) : undefined
                                        )
                                    }
                                    placeholder="0"
                                />
                            </div>
                        </div>
                        <div className="waveai-form-row">
                            <div className="waveai-form-field half">
                                <label className="waveai-field-label">Icon</label>
                                <div className="waveai-icon-picker">
                                    <div className="waveai-icon-preview">
                                        <i className={`fa fa-solid fa-${form["display:icon"] || "sparkles"}`} />
                                    </div>
                                    <input
                                        type="text"
                                        className="waveai-input mono"
                                        value={form["display:icon"] || ""}
                                        onChange={(e) => updateField("display:icon", e.target.value)}
                                        placeholder="sparkles"
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="waveai-form-row">
                            <div className="waveai-form-field">
                                <label className="waveai-field-label">Description</label>
                                <textarea
                                    className="waveai-textarea"
                                    value={form["display:description"] || ""}
                                    onChange={(e) => updateField("display:description", e.target.value)}
                                    placeholder="Description of this AI mode..."
                                    rows={2}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Provider Settings Section */}
                <div className="waveai-form-section">
                    <div className="waveai-form-section-header">
                        <i className="fa fa-solid fa-plug" />
                        Provider Settings
                    </div>
                    <div className="waveai-form-section-content">
                        <div className="waveai-form-row">
                            <div className="waveai-form-field half">
                                <label className="waveai-field-label">Provider</label>
                                <select
                                    className="waveai-select"
                                    value={form["ai:provider"] || ""}
                                    onChange={(e) => updateField("ai:provider", e.target.value)}
                                >
                                    {PROVIDER_OPTIONS.map((opt) => (
                                        <option key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            {showApiType && (
                                <div className="waveai-form-field half">
                                    <label className="waveai-field-label">API Type</label>
                                    <select
                                        className="waveai-select"
                                        value={form["ai:apitype"] || ""}
                                        onChange={(e) => updateField("ai:apitype", e.target.value)}
                                    >
                                        {API_TYPE_OPTIONS.map((opt) => (
                                            <option key={opt.value} value={opt.value}>
                                                {opt.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </div>

                        {showModel && (
                            <div className="waveai-form-row">
                                <div className="waveai-form-field">
                                    <label className="waveai-field-label">Model</label>
                                    <input
                                        type="text"
                                        className="waveai-input mono"
                                        value={form["ai:model"] || ""}
                                        onChange={(e) => updateField("ai:model", e.target.value)}
                                        placeholder="gpt-4o, llama3.3:70b, gemini-pro..."
                                    />
                                </div>
                            </div>
                        )}

                        {showEndpoint && (
                            <div className="waveai-form-row">
                                <div className="waveai-form-field">
                                    <label className="waveai-field-label">Endpoint URL</label>
                                    <input
                                        type="text"
                                        className="waveai-input mono"
                                        value={form["ai:endpoint"] || ""}
                                        onChange={(e) => updateField("ai:endpoint", e.target.value)}
                                        placeholder="http://localhost:11434/v1/chat/completions"
                                    />
                                </div>
                            </div>
                        )}

                        {showAzureResource && (
                            <div className="waveai-form-row">
                                <div className="waveai-form-field">
                                    <label className="waveai-field-label">Azure Resource Name</label>
                                    <input
                                        type="text"
                                        className="waveai-input"
                                        value={form["ai:azureresourcename"] || ""}
                                        onChange={(e) => updateField("ai:azureresourcename", e.target.value)}
                                        placeholder="your-resource-name"
                                    />
                                </div>
                            </div>
                        )}

                        {showAzureDeployment && (
                            <div className="waveai-form-row">
                                <div className="waveai-form-field half">
                                    <label className="waveai-field-label">Azure Deployment</label>
                                    <input
                                        type="text"
                                        className="waveai-input"
                                        value={form["ai:azuredeployment"] || ""}
                                        onChange={(e) => updateField("ai:azuredeployment", e.target.value)}
                                        placeholder="your-deployment-name"
                                    />
                                </div>
                                {showAzureApiVersion && (
                                    <div className="waveai-form-field half">
                                        <label className="waveai-field-label">API Version</label>
                                        <input
                                            type="text"
                                            className="waveai-input"
                                            value={form["ai:azureapiversion"] || ""}
                                            onChange={(e) => updateField("ai:azureapiversion", e.target.value)}
                                            placeholder="2025-04-01-preview"
                                        />
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="waveai-form-row">
                            <div className="waveai-form-field half">
                                <label className="waveai-field-label">Thinking Level</label>
                                <select
                                    className="waveai-select"
                                    value={form["ai:thinkinglevel"] || ""}
                                    onChange={(e) => updateField("ai:thinkinglevel", e.target.value)}
                                >
                                    {THINKING_LEVEL_OPTIONS.map((opt) => (
                                        <option key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>
                </div>

                {/* API Token Section */}
                {showTokenConfig && (
                    <div className="waveai-form-section">
                        <div className="waveai-form-section-header">
                            <i className="fa fa-solid fa-key" />
                            Authentication
                        </div>
                        <div className="waveai-form-section-content">
                            <div className="waveai-token-mode">
                                <label
                                    className={cn("waveai-token-option", { active: tokenMode === "secret" })}
                                    onClick={() => setTokenMode("secret")}
                                >
                                    <input
                                        type="radio"
                                        name="tokenModeNew"
                                        checked={tokenMode === "secret"}
                                        onChange={() => {}}
                                    />
                                    <span>Use Secret (Recommended)</span>
                                </label>
                                <label
                                    className={cn("waveai-token-option", { active: tokenMode === "direct" })}
                                    onClick={() => setTokenMode("direct")}
                                >
                                    <input
                                        type="radio"
                                        name="tokenModeNew"
                                        checked={tokenMode === "direct"}
                                        onChange={() => {}}
                                    />
                                    <span>Direct Token</span>
                                </label>
                            </div>

                            {tokenMode === "secret" ? (
                                <div className="waveai-form-row">
                                    <div className="waveai-form-field">
                                        <label className="waveai-field-label">Secret Name</label>
                                        <input
                                            type="text"
                                            className="waveai-input mono"
                                            value={form["ai:apitokensecretname"] || ""}
                                            onChange={(e) => updateField("ai:apitokensecretname", e.target.value)}
                                            placeholder={getDefaultSecretName(provider) || "MY_API_KEY"}
                                        />
                                        <div className="waveai-field-help">
                                            Reference to a secret stored in Wave's secret manager.
                                            {provider && getDefaultSecretName(provider) && (
                                                <> Default: <code>{getDefaultSecretName(provider)}</code></>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="waveai-form-row">
                                    <div className="waveai-form-field">
                                        <label className="waveai-field-label">API Token</label>
                                        <input
                                            type="password"
                                            className="waveai-input mono"
                                            value={form["ai:apitoken"] || ""}
                                            onChange={(e) => updateField("ai:apitoken", e.target.value)}
                                            placeholder="sk-..."
                                        />
                                        <div className="waveai-field-help">
                                            Not recommended - tokens are stored in plaintext.
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Capabilities Section */}
                <div className="waveai-form-section">
                    <div className="waveai-form-section-header">
                        <i className="fa fa-solid fa-wand-magic-sparkles" />
                        Capabilities
                    </div>
                    <div className="waveai-form-section-content">
                        <div className="waveai-checkbox-group">
                            {CAPABILITY_OPTIONS.map((cap) => (
                                <label key={cap.value} className="waveai-checkbox">
                                    <input
                                        type="checkbox"
                                        checked={form["ai:capabilities"]?.includes(cap.value) || false}
                                        onChange={(e) => handleCapabilityChange(cap.value, e.target.checked)}
                                    />
                                    <span className="waveai-checkbox-label">{cap.label}</span>
                                </label>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Switch Compatibility Section */}
                <div className="waveai-form-section">
                    <div className="waveai-form-section-header">
                        <i className="fa fa-solid fa-shuffle" />
                        Switch Compatibility
                    </div>
                    <div className="waveai-form-section-content">
                        <div className="waveai-form-row">
                            <div className="waveai-form-field">
                                <label className="waveai-field-label">Compatible Mode Keys</label>
                                <input
                                    type="text"
                                    className="waveai-input mono"
                                    value={(form["ai:switchcompat"] || []).join(", ")}
                                    onChange={(e) => {
                                        const values = e.target.value
                                            .split(",")
                                            .map((s) => s.trim())
                                            .filter((s) => s.length > 0);
                                        updateField("ai:switchcompat", values);
                                    }}
                                    placeholder="mode-key-1, mode-key-2"
                                />
                                <div className="waveai-field-help">
                                    Comma-separated list of mode keys that this mode can switch to mid-conversation.
                                    Used for grouping compatible modes in the AI panel.
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
});

AddModeForm.displayName = "AddModeForm";

// ============================================
// Main Component
// ============================================

interface WaveAIVisualContentProps {
    model: WaveConfigViewModel;
}

export const WaveAIVisualContent = memo(({ model }: WaveAIVisualContentProps) => {
    const fullConfig = useAtomValue(atoms.fullConfigAtom);
    const [selectedModeKey, setSelectedModeKey] = useState<string | null>(null);
    const [isAddingNew, setIsAddingNew] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [userModes, setUserModes] = useState<Record<string, AIModeConfigType>>({});
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [secretNames, setSecretNames] = useState<Set<string>>(new Set());

    // Get config directory
    const configDir = useMemo(() => getApi().getConfigDir(), []);

    // Load secrets on mount to determine provider status
    const loadSecrets = useCallback(async () => {
        try {
            const names = await RpcApi.GetSecretsNamesCommand(TabRpcClient);
            setSecretNames(new Set(names || []));
        } catch (err: any) {
            console.error("Failed to load secrets:", err);
            // Don't set error message, just use empty set
            setSecretNames(new Set());
        }
    }, []);

    const loadUserModes = useCallback(async () => {
        setErrorMessage(null);
        try {
            const fullPath = `${configDir}/waveai.json`;
            const fileData = await RpcApi.FileReadCommand(TabRpcClient, {
                info: { path: fullPath },
            });
            if (fileData?.data64) {
                const content = base64ToString(fileData.data64);
                if (content.trim()) {
                    const parsed = JSON.parse(content);
                    setUserModes(parsed);
                }
            }
        } catch (err: any) {
            // File doesn't exist or is empty, that's fine
            if (err.message?.includes("not found") || err.message?.includes("ENOENT")) {
                setUserModes({});
            } else {
                setErrorMessage(`Failed to load AI modes: ${err.message || String(err)}`);
            }
        }
    }, [configDir]);

    // Load user waveai.json and secrets on mount
    useEffect(() => {
        loadUserModes();
        loadSecrets();
    }, [loadUserModes, loadSecrets]);

    const saveUserModes = useCallback(async (modes: Record<string, AIModeConfigType>) => {
        setErrorMessage(null);
        try {
            const fullPath = `${configDir}/waveai.json`;
            const content = JSON.stringify(modes, null, 2);
            await RpcApi.FileWriteCommand(TabRpcClient, {
                info: { path: fullPath },
                data64: stringToBase64(content),
            });
            setUserModes(modes);
        } catch (err: any) {
            console.error("Failed to save waveai.json:", err);
            setErrorMessage(`Failed to save AI modes: ${err.message || String(err)}`);
            throw err;
        }
    }, [configDir]);

    // Combine default modes with user modes
    const allModes = useMemo(() => {
        const defaults = fullConfig?.waveai || {};
        return { ...defaults, ...userModes };
    }, [fullConfig?.waveai, userModes]);

    // Get the list of existing keys for validation
    const existingKeys = useMemo(() => new Set(Object.keys(allModes)), [allModes]);

    // Compute mode status map
    const modeStatusMap = useMemo(() => {
        const statusMap: Record<string, ModeStatus> = {};
        for (const [key, mode] of Object.entries(allModes)) {
            statusMap[key] = computeModeStatus(key, mode, secretNames);
        }
        return statusMap;
    }, [allModes, secretNames]);

    // Separate modes into categories: Wave Cloud, Commercial (templates), Local (templates), Custom
    const waveCloudModes = useMemo(() => {
        const result: [string, AIModeConfigType][] = [];
        for (const [key, mode] of Object.entries(allModes)) {
            if (isDefaultMode(key)) {
                result.push([key, mode]);
            }
        }
        return result.sort((a, b) => (a[1]["display:order"] ?? 0) - (b[1]["display:order"] ?? 0));
    }, [allModes]);

    const commercialModes = useMemo(() => {
        const result: [string, AIModeConfigType][] = [];
        for (const [key, mode] of Object.entries(allModes)) {
            if (isTemplateMode(key) && !isLocalEndpoint(mode["ai:endpoint"])) {
                result.push([key, mode]);
            }
        }
        return result.sort((a, b) => (a[1]["display:order"] ?? 0) - (b[1]["display:order"] ?? 0));
    }, [allModes]);

    const localModes = useMemo(() => {
        const result: [string, AIModeConfigType][] = [];
        for (const [key, mode] of Object.entries(allModes)) {
            if (isTemplateMode(key) && isLocalEndpoint(mode["ai:endpoint"])) {
                result.push([key, mode]);
            }
        }
        return result.sort((a, b) => (a[1]["display:order"] ?? 0) - (b[1]["display:order"] ?? 0));
    }, [allModes]);

    const customModes = useMemo(() => {
        const result: [string, AIModeConfigType][] = [];
        for (const [key, mode] of Object.entries(allModes)) {
            if (!isDefaultMode(key) && !isTemplateMode(key)) {
                result.push([key, mode]);
            }
        }
        return result.sort((a, b) => (a[1]["display:order"] ?? 0) - (b[1]["display:order"] ?? 0));
    }, [allModes]);

    const selectedMode = selectedModeKey ? allModes[selectedModeKey] : null;

    const handleSaveMode = useCallback(
        async (key: string, config: AIModeConfigType) => {
            setIsLoading(true);
            try {
                const newModes = { ...userModes, [key]: config };
                await saveUserModes(newModes);
                setIsAddingNew(false);
                setSelectedModeKey(key);
                model.markAsEdited();
            } catch (err) {
                console.error("Failed to save mode:", err);
            } finally {
                setIsLoading(false);
            }
        },
        [userModes, model]
    );

    const handleDeleteMode = useCallback(
        async (key: string) => {
            setIsLoading(true);
            try {
                const newModes = { ...userModes };
                delete newModes[key];
                await saveUserModes(newModes);
                setSelectedModeKey(null);
                model.markAsEdited();
            } catch (err) {
                console.error("Failed to delete mode:", err);
            } finally {
                setIsLoading(false);
            }
        },
        [userModes, model]
    );

    const handleAddNew = useCallback(() => {
        setSelectedModeKey(null);
        setIsAddingNew(true);
    }, []);

    const handleCancelAdd = useCallback(() => {
        setIsAddingNew(false);
    }, []);

    const handleNavigateToSecrets = useCallback(() => {
        model.navigateToSecrets();
    }, [model]);

    const handleDuplicateMode = useCallback(
        (key: string, mode: AIModeConfigType) => {
            // Generate a new key based on the display name
            const baseName = mode["display:name"] || "Mode";
            let newKey = `${baseName.toLowerCase().replace(/[^a-z0-9]/g, "-")}-copy`;
            let counter = 1;
            while (existingKeys.has(newKey)) {
                newKey = `${baseName.toLowerCase().replace(/[^a-z0-9]/g, "-")}-copy-${counter}`;
                counter++;
            }

            // Create a copy of the mode with a new name
            const newMode: AIModeConfigType = {
                ...mode,
                "display:name": `${baseName} (Copy)`,
            };

            // Save the new mode
            handleSaveMode(newKey, newMode);
        },
        [existingKeys, handleSaveMode]
    );

    return (
        <div className="waveai-visual">
            {errorMessage && (
                <div className="waveai-error-container">
                    <div className="waveai-error-message">
                        <i className="fa fa-solid fa-circle-exclamation" />
                        <span>{errorMessage}</span>
                    </div>
                    <button
                        className="waveai-error-dismiss"
                        onClick={() => setErrorMessage(null)}
                        title="Dismiss"
                    >
                        <i className="fa fa-solid fa-times" />
                    </button>
                </div>
            )}
            <div className="waveai-visual-body">
                {/* Sidebar with mode list */}
                <div className="waveai-mode-sidebar">
                    <div className="waveai-sidebar-header">
                        <span className="waveai-sidebar-title">AI Modes</span>
                        <button className="waveai-add-btn" onClick={handleAddNew}>
                            <i className="fa fa-solid fa-plus" />
                            Add Mode
                        </button>
                    </div>
                    <div className="waveai-mode-list">
                        {/* Wave Cloud modes */}
                        {waveCloudModes.length > 0 && (
                            <div className="waveai-mode-group">
                                <div className="waveai-mode-group-header">Wave Cloud</div>
                                {waveCloudModes.map(([key, mode]) => (
                                    <ModeListItem
                                        key={key}
                                        modeKey={key}
                                        mode={mode}
                                        isSelected={selectedModeKey === key && !isAddingNew}
                                        onSelect={() => {
                                            setIsAddingNew(false);
                                            setSelectedModeKey(key);
                                        }}
                                        status={modeStatusMap[key]}
                                    />
                                ))}
                            </div>
                        )}

                        {/* Commercial provider templates */}
                        {commercialModes.length > 0 && (
                            <div className="waveai-mode-group">
                                <div className="waveai-mode-group-header">Commercial Providers</div>
                                {commercialModes.map(([key, mode]) => (
                                    <ModeListItem
                                        key={key}
                                        modeKey={key}
                                        mode={mode}
                                        isSelected={selectedModeKey === key && !isAddingNew}
                                        onSelect={() => {
                                            setIsAddingNew(false);
                                            setSelectedModeKey(key);
                                        }}
                                        status={modeStatusMap[key]}
                                        onNavigateToSecrets={handleNavigateToSecrets}
                                    />
                                ))}
                            </div>
                        )}

                        {/* Local provider templates */}
                        {localModes.length > 0 && (
                            <div className="waveai-mode-group">
                                <div className="waveai-mode-group-header">Local Providers</div>
                                {localModes.map(([key, mode]) => (
                                    <ModeListItem
                                        key={key}
                                        modeKey={key}
                                        mode={mode}
                                        isSelected={selectedModeKey === key && !isAddingNew}
                                        onSelect={() => {
                                            setIsAddingNew(false);
                                            setSelectedModeKey(key);
                                        }}
                                        status={modeStatusMap[key]}
                                    />
                                ))}
                            </div>
                        )}

                        {/* User custom modes */}
                        {customModes.length > 0 && (
                            <div className="waveai-mode-group">
                                <div className="waveai-mode-group-header">Custom Modes</div>
                                {customModes.map(([key, mode]) => (
                                    <ModeListItem
                                        key={key}
                                        modeKey={key}
                                        mode={mode}
                                        isSelected={selectedModeKey === key && !isAddingNew}
                                        onSelect={() => {
                                            setIsAddingNew(false);
                                            setSelectedModeKey(key);
                                        }}
                                        status={modeStatusMap[key]}
                                        onNavigateToSecrets={handleNavigateToSecrets}
                                    />
                                ))}
                            </div>
                        )}

                        {/* Empty state */}
                        {waveCloudModes.length === 0 && commercialModes.length === 0 && localModes.length === 0 && customModes.length === 0 && (
                            <div className="waveai-empty-sidebar">
                                <i className="fa fa-solid fa-robot" />
                                <div className="waveai-empty-text">No AI modes configured</div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Editor panel */}
                {isAddingNew ? (
                    <AddModeForm
                        onSave={handleSaveMode}
                        onCancel={handleCancelAdd}
                        isLoading={isLoading}
                        existingKeys={existingKeys}
                    />
                ) : selectedMode && selectedModeKey ? (
                    <ModeEditor
                        modeKey={selectedModeKey}
                        mode={selectedMode}
                        onSave={handleSaveMode}
                        onDelete={handleDeleteMode}
                        onDuplicate={handleDuplicateMode}
                        isLoading={isLoading}
                    />
                ) : (
                    <div className="waveai-empty-editor">
                        <i className="fa fa-solid fa-robot" />
                        <div className="waveai-empty-title">Select an AI Mode</div>
                        <div className="waveai-empty-description">
                            Choose a mode from the sidebar to view or edit its configuration, or add a new custom mode.
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
});

WaveAIVisualContent.displayName = "WaveAIVisualContent";
