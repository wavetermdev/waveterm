// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { makeIconClass } from "@/util/util";
import clsx from "clsx";
import { atom, useAtom, useAtomValue } from "jotai";
import * as React from "react";
import {
    deleteProvider,
    fetchProviders,
    providerLoadingAtom,
    providerTestingAtom,
    providersAtom,
    saveProvider,
    testProvider,
} from "../models/provider-model";
import type { SaveProviderRequest, TestProviderResult, ZeroAiProviderInfo } from "../types";
import "./provider-settings.scss";

export interface ProviderSettingsProps {
    className?: string;
    onProviderSelect?: (provider: ZeroAiProviderInfo) => void;
    selectedProviderId?: string;
}

type FormMode = "idle" | "add" | "edit";

const emptyForm: SaveProviderRequest = {
    providerId: "",
    displayName: "",
    cliCommand: "",
    cliPath: "",
    cliArgs: [],
    envVars: {},
    supportsStreaming: false,
    defaultModel: "",
    availableModels: [],
    authRequired: false,
};

const formAtom = atom<SaveProviderRequest>(emptyForm) as import("jotai").PrimitiveAtom<SaveProviderRequest>;
const formModeAtom = atom<FormMode>("idle") as import("jotai").PrimitiveAtom<FormMode>;
const formErrorAtom = atom<string>("") as import("jotai").PrimitiveAtom<string>;
const testResultAtom = atom<TestProviderResult | null>(
    null
) as import("jotai").PrimitiveAtom<TestProviderResult | null>;

export const ProviderSettings = React.memo(
    ({ className, onProviderSelect, selectedProviderId }: ProviderSettingsProps) => {
        const providers = useAtomValue(providersAtom);
        const loading = useAtomValue(providerLoadingAtom);
        const testingId = useAtomValue(providerTestingAtom);
        const [formMode, setFormMode] = useAtom(formModeAtom);
        const [form, setForm] = useAtom(formAtom);
        const [formError, setFormError] = useAtom(formErrorAtom);
        const [testResult, setTestResult] = useAtom(testResultAtom);

        React.useEffect(() => {
            fetchProviders();
        }, []);

        const handleAdd = React.useCallback(() => {
            setFormMode("add");
            setForm(emptyForm);
            setFormError("");
            setTestResult(null);
        }, [setFormMode, setForm, setFormError, setTestResult]);

        const handleEdit = React.useCallback(
            (provider: ZeroAiProviderInfo) => {
                setFormMode("edit");
                setFormError("");
                setTestResult(null);
                setForm({
                    providerId: provider.id,
                    displayName: provider.displayName,
                    cliCommand: provider.cliCommand,
                    cliPath: provider.cliPath,
                    cliArgs: provider.cliArgs,
                    envVars: provider.envVars,
                    supportsStreaming: provider.supportsStreaming,
                    defaultModel: provider.defaultModel,
                    availableModels: provider.availableModels,
                    authRequired: provider.authRequired,
                });
            },
            [setFormMode, setForm, setFormError, setTestResult]
        );

        const handleSave = React.useCallback(async () => {
            if (!form.displayName.trim()) {
                setFormError("Display name is required");
                return;
            }
            if (!form.cliCommand.trim()) {
                setFormError("CLI command is required");
                return;
            }

            const request = { ...form };
            if (formMode === "add") {
                request.providerId = form.displayName
                    .toLowerCase()
                    .replace(/\s+/g, "-")
                    .replace(/[^a-z0-9-]/g, "");
            }

            try {
                await saveProvider(request);
                setFormMode("idle");
                setForm(emptyForm);
            } catch (err) {
                setFormError(`Failed to save: ${err}`);
            }
        }, [form, formMode, setFormMode, setForm, setFormError]);

        const handleDelete = React.useCallback(
            async (providerId: string) => {
                try {
                    await deleteProvider(providerId);
                } catch (err) {
                    setFormError(`Failed to delete: ${err}`);
                }
            },
            [setFormError]
        );

        const handleTest = React.useCallback(
            async (providerId: string) => {
                try {
                    const result = await testProvider(providerId);
                    setTestResult(result);
                } catch (err) {
                    setTestResult({ success: false, version: "", error: String(err), latencyMs: 0 });
                }
            },
            [setTestResult]
        );

        const handleCancel = React.useCallback(() => {
            setFormMode("idle");
            setForm(emptyForm);
            setFormError("");
            setTestResult(null);
        }, [setFormMode, setForm, setFormError, setTestResult]);

        return (
            <div className={clsx("provider-settings", className)}>
                <div className="provider-settings-header">
                    <h3 className="provider-settings-title">
                        <i className={makeIconClass("fa-solid fa-plug", false)} />
                        Custom Providers
                    </h3>
                    {formMode === "idle" && (
                        <button className="provider-add-btn" onClick={handleAdd}>
                            <i className={makeIconClass("fa-solid fa-plus", false)} />
                            Add Provider
                        </button>
                    )}
                </div>

                {formError && <div className="provider-error">{formError}</div>}

                {formMode !== "idle" && (
                    <ProviderForm
                        form={form}
                        formMode={formMode}
                        onFormChange={setForm}
                        onSave={handleSave}
                        onCancel={handleCancel}
                        onTest={formMode === "edit" ? () => handleTest(form.providerId) : undefined}
                        testing={testingId === form.providerId}
                        testResult={testResult}
                    />
                )}

                <div className="provider-list">
                    {loading && <div className="provider-loading">Loading...</div>}
                    {!loading && providers.length === 0 && (
                        <div className="provider-empty">
                            <i className={makeIconClass("fa-solid fa-plug", false)} />
                            <p>No custom providers configured</p>
                            <p className="provider-empty-hint">
                                Add a CLI-based AI provider like Ollama, LM Studio, or custom scripts
                            </p>
                        </div>
                    )}
                    {!loading &&
                        providers.map((provider) => (
                            <ProviderCard
                                key={provider.id}
                                provider={provider}
                                selected={provider.id === selectedProviderId}
                                onSelect={onProviderSelect}
                                onEdit={handleEdit}
                                onDelete={handleDelete}
                                onTest={handleTest}
                                testing={testingId === provider.id}
                            />
                        ))}
                </div>
            </div>
        );
    }
);
ProviderSettings.displayName = "ProviderSettings";

interface ProviderCardProps {
    provider: ZeroAiProviderInfo;
    selected?: boolean;
    onSelect?: (provider: ZeroAiProviderInfo) => void;
    onEdit: (provider: ZeroAiProviderInfo) => void;
    onDelete: (providerId: string) => void;
    onTest: (providerId: string) => void;
    testing?: boolean;
}

const ProviderCard = React.memo(
    ({ provider, selected, onSelect, onEdit, onDelete, onTest, testing }: ProviderCardProps) => (
        <div
            className={clsx("provider-card", {
                selected,
                available: provider.isAvailable,
                unavailable: !provider.isAvailable,
            })}
            onClick={() => onSelect?.(provider)}
        >
            <div className="provider-card-info">
                <div className="provider-card-name">
                    <i className={makeIconClass(provider.displayIcon || "fa-solid fa-robot", false)} />
                    <span>{provider.displayName}</span>
                    {provider.isAvailable ? (
                        <span className="provider-status-badge available">Available</span>
                    ) : (
                        <span className="provider-status-badge unavailable">Not Found</span>
                    )}
                </div>
                <div className="provider-card-details">
                    <span className="provider-card-cmd">{provider.cliCommand}</span>
                    {provider.defaultModel && <span className="provider-card-model">{provider.defaultModel}</span>}
                </div>
                {provider.envVars && Object.keys(provider.envVars).length > 0 && (
                    <div className="provider-card-env">
                        {Object.keys(provider.envVars).map((key) => (
                            <span key={key} className="provider-env-var">
                                {key}
                            </span>
                        ))}
                    </div>
                )}
            </div>
            <div className="provider-card-actions">
                <button
                    className="provider-action-btn test"
                    onClick={(e) => {
                        e.stopPropagation();
                        onTest(provider.id);
                    }}
                    disabled={testing}
                    title="Test Connection"
                >
                    {testing ? (
                        <i className={makeIconClass("fa-solid fa-spinner fa-spin", false)} />
                    ) : (
                        <i className={makeIconClass("fa-solid fa-flask", false)} />
                    )}
                </button>
                <button
                    className="provider-action-btn edit"
                    onClick={(e) => {
                        e.stopPropagation();
                        onEdit(provider);
                    }}
                    title="Edit"
                >
                    <i className={makeIconClass("fa-solid fa-pen", false)} />
                </button>
                <button
                    className="provider-action-btn delete"
                    onClick={(e) => {
                        e.stopPropagation();
                        onDelete(provider.id);
                    }}
                    title="Delete"
                >
                    <i className={makeIconClass("fa-solid fa-trash", false)} />
                </button>
            </div>
        </div>
    )
);
ProviderCard.displayName = "ProviderCard";

interface ProviderFormProps {
    form: SaveProviderRequest;
    formMode: FormMode;
    onFormChange: (form: SaveProviderRequest) => void;
    onSave: () => void;
    onCancel: () => void;
    onTest?: () => void;
    testing?: boolean;
    testResult?: TestProviderResult | null;
}

const ProviderForm = React.memo(
    ({ form, formMode, onFormChange, onSave, onCancel, onTest, testing, testResult }: ProviderFormProps) => {
        const updateField = React.useCallback(
            <K extends keyof SaveProviderRequest>(key: K, value: SaveProviderRequest[K]) => {
                onFormChange({ ...form, [key]: value });
            },
            [form, onFormChange]
        );

        return (
            <div className="provider-form">
                <div className="provider-form-title">
                    {formMode === "add" ? "Add Custom Provider" : "Edit Provider"}
                </div>

                <div className="provider-form-grid">
                    <label className="provider-form-label">
                        Display Name
                        <input
                            type="text"
                            className="provider-form-input"
                            value={form.displayName}
                            onChange={(e) => updateField("displayName", e.target.value)}
                            placeholder="e.g., Ollama, LM Studio"
                            disabled={formMode === "edit"}
                        />
                    </label>

                    <label className="provider-form-label">
                        CLI Command
                        <input
                            type="text"
                            className="provider-form-input"
                            value={form.cliCommand}
                            onChange={(e) => updateField("cliCommand", e.target.value)}
                            placeholder="e.g., ollama, lm-studio"
                        />
                    </label>

                    <label className="provider-form-label">
                        CLI Path (optional)
                        <input
                            type="text"
                            className="provider-form-input"
                            value={form.cliPath}
                            onChange={(e) => updateField("cliPath", e.target.value)}
                            placeholder="e.g., /usr/local/bin/ollama"
                        />
                    </label>

                    <label className="provider-form-label">
                        CLI Args (comma-separated)
                        <input
                            type="text"
                            className="provider-form-input"
                            value={form.cliArgs?.join(", ") ?? ""}
                            onChange={(e) =>
                                updateField(
                                    "cliArgs",
                                    e.target.value
                                        .split(",")
                                        .map((s) => s.trim())
                                        .filter(Boolean)
                                )
                            }
                            placeholder="e.g., --stdio, --model llama3"
                        />
                    </label>

                    <label className="provider-form-label">
                        Default Model (optional)
                        <input
                            type="text"
                            className="provider-form-input"
                            value={form.defaultModel}
                            onChange={(e) => updateField("defaultModel", e.target.value)}
                            placeholder="e.g., llama3"
                        />
                    </label>

                    <label className="provider-form-label checkbox-label">
                        <input
                            type="checkbox"
                            checked={form.supportsStreaming ?? false}
                            onChange={(e) => updateField("supportsStreaming", e.target.checked)}
                        />
                        Supports Streaming
                    </label>
                </div>

                {testResult && (
                    <div
                        className={clsx("provider-test-result", {
                            success: testResult.success,
                            failure: !testResult.success,
                        })}
                    >
                        {testResult.success ? (
                            <>
                                <i className={makeIconClass("fa-solid fa-check-circle", false)} />
                                <span>
                                    Connected ({testResult.latencyMs}ms)
                                    {testResult.version && ` — ${testResult.version.trim().split("\n")[0]}`}
                                </span>
                            </>
                        ) : (
                            <>
                                <i className={makeIconClass("fa-solid fa-exclamation-circle", false)} />
                                <span>{testResult.error}</span>
                            </>
                        )}
                    </div>
                )}

                <div className="provider-form-actions">
                    {onTest && (
                        <button className="provider-form-btn test" onClick={onTest} disabled={testing}>
                            {testing ? "Testing..." : "Test Connection"}
                        </button>
                    )}
                    <button className="provider-form-btn cancel" onClick={onCancel}>
                        Cancel
                    </button>
                    <button className="provider-form-btn save" onClick={onSave}>
                        {formMode === "add" ? "Add Provider" : "Save Changes"}
                    </button>
                </div>
            </div>
        );
    }
);
ProviderForm.displayName = "ProviderForm";
