// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * OMP Configurator
 *
 * Visual theme configurator for Oh-My-Posh themes.
 * Allows editing the current OMP configuration with preview.
 */

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn } from "@/util/util";
import { memo, useCallback, useEffect, useState } from "react";

import type { PreviewBackground } from "../preview-background-toggle";
import { ActionButtons } from "./action-buttons";
import { AdvancedSection } from "./advanced-section";
import { OmpBlockEditor } from "./omp-block-editor";
import { OmpConfigPreview } from "./omp-config-preview";
import { reinitOmpInAllTerminals } from "./omp-utils";

import "./omp-configurator.scss";

interface OmpConfiguratorProps {
    previewBackground: PreviewBackground;
    onConfigChange?: () => void;
}

interface OmpConfiguratorState {
    // Loading states
    loading: boolean;
    saving: boolean;
    error: string | null;

    // Config state
    originalConfig: OmpConfigData | null;
    editedConfig: OmpConfigData | null;
    hasChanges: boolean;

    // Path info
    configPath: string | null;
    configFormat: string | null;
    configSource: string | null;
    backupExists: boolean;

    // UI state
    selectedBlockIndex: number;
    selectedSegmentIndex: number;
}

/**
 * Deep compare two configs to detect changes
 */
function hasConfigChanges(original: OmpConfigData | null, edited: OmpConfigData | null): boolean {
    if (!original || !edited) return false;
    return JSON.stringify(original) !== JSON.stringify(edited);
}

export const OmpConfigurator = memo(({ previewBackground, onConfigChange }: OmpConfiguratorProps) => {
    const [state, setState] = useState<OmpConfiguratorState>({
        loading: true,
        saving: false,
        error: null,
        originalConfig: null,
        editedConfig: null,
        hasChanges: false,
        configPath: null,
        configFormat: null,
        configSource: null,
        backupExists: false,
        selectedBlockIndex: 0,
        selectedSegmentIndex: 0,
    });

    const loadConfig = useCallback(async () => {
        setState((s) => ({ ...s, loading: true, error: null }));
        try {
            const result = await RpcApi.OmpReadConfigCommand(TabRpcClient);
            if (result.error) {
                // "OMP config not found" means OMP isn't installed/configured yet.
                // Fall through to the "no config" UI instead of showing an error.
                const isNotFound = result.error.toLowerCase().includes("config not found");
                if (isNotFound) {
                    setState((s) => ({
                        ...s,
                        loading: false,
                        error: null,
                        originalConfig: null,
                        editedConfig: null,
                        configPath: result.configpath,
                    }));
                    return;
                }
                setState((s) => ({
                    ...s,
                    loading: false,
                    error: result.error,
                    configPath: result.configpath,
                }));
                return;
            }
            setState((s) => ({
                ...s,
                loading: false,
                originalConfig: result.config ?? null,
                editedConfig: result.config ? structuredClone(result.config) : null,
                hasChanges: false,
                configPath: result.configpath,
                configFormat: result.format,
                configSource: result.source,
                backupExists: result.backupexists,
            }));
        } catch (err) {
            setState((s) => ({
                ...s,
                loading: false,
                error: String(err),
            }));
        }
    }, []);

    // Load config on mount
    useEffect(() => {
        loadConfig();
    }, [loadConfig]);

    const handleSave = useCallback(async () => {
        if (!state.editedConfig || !state.hasChanges) return;

        setState((s) => ({ ...s, saving: true, error: null }));
        try {
            const result = await RpcApi.OmpWriteConfigCommand(TabRpcClient, {
                config: state.editedConfig,
                createbackup: true,
            });

            if (result.error) {
                setState((s) => ({ ...s, saving: false, error: result.error }));
                return;
            }

            setState((s) => ({
                ...s,
                saving: false,
                originalConfig: structuredClone(s.editedConfig),
                hasChanges: false,
                backupExists: true,
            }));

            // Reinit OMP in all terminals
            await reinitOmpInAllTerminals();
            onConfigChange?.();
        } catch (err) {
            setState((s) => ({ ...s, saving: false, error: String(err) }));
        }
    }, [state.editedConfig, state.hasChanges, onConfigChange]);

    const handleCancel = useCallback(() => {
        setState((s) => ({
            ...s,
            editedConfig: s.originalConfig ? structuredClone(s.originalConfig) : null,
            hasChanges: false,
            selectedBlockIndex: 0,
            selectedSegmentIndex: 0,
            error: null,
        }));
    }, []);

    const handleConfigUpdate = useCallback((updatedConfig: OmpConfigData) => {
        setState((s) => {
            const hasChanges = hasConfigChanges(s.originalConfig, updatedConfig);
            return {
                ...s,
                editedConfig: updatedConfig,
                hasChanges,
            };
        });
    }, []);

    const handleBlockSelect = useCallback((blockIndex: number) => {
        setState((s) => ({
            ...s,
            selectedBlockIndex: blockIndex,
            selectedSegmentIndex: 0,
        }));
    }, []);

    const handleSegmentSelect = useCallback((blockIndex: number, segmentIndex: number) => {
        setState((s) => ({
            ...s,
            selectedBlockIndex: blockIndex,
            selectedSegmentIndex: segmentIndex,
        }));
    }, []);

    const handleImport = useCallback((importedConfig: OmpConfigData) => {
        setState((s) => ({
            ...s,
            editedConfig: importedConfig,
            hasChanges: true,
        }));
    }, []);

    // Loading state
    if (state.loading) {
        return (
            <div className="omp-configurator loading">
                <div className="omp-loading">
                    <i className="fa fa-solid fa-spinner fa-spin" />
                    <span>Loading configuration...</span>
                </div>
            </div>
        );
    }

    // No config found
    if (!state.editedConfig && !state.error) {
        return (
            <div className="omp-configurator no-config">
                <div className="omp-no-config">
                    <i className="fa fa-solid fa-terminal" />
                    <div className="no-config-title">No Oh-My-Posh Configuration Found</div>
                    <div className="no-config-message">
                        To use the theme configurator, you need to set up Oh-My-Posh first. The configurator
                        will load your theme from the $POSH_THEME environment variable.
                    </div>
                    <div className="no-config-actions">
                        <a
                            href="https://ohmyposh.dev/docs/installation/customize"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn-primary"
                        >
                            <i className="fa fa-solid fa-external-link" />
                            Setup Guide
                        </a>
                        <button className="btn-secondary" onClick={loadConfig}>
                            <i className="fa fa-solid fa-rotate" />
                            Refresh
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // Non-JSON config warning
    if (state.configFormat && state.configFormat !== "json") {
        return (
            <div className="omp-configurator warning">
                <div className="omp-warning">
                    <i className="fa fa-solid fa-info-circle" />
                    <div className="warning-title">{state.configFormat.toUpperCase()} Configuration Detected</div>
                    <div className="warning-message">
                        The visual configurator currently supports JSON configurations only. Your config at{" "}
                        <code>{state.configPath}</code> is in {state.configFormat.toUpperCase()} format.
                    </div>
                    <div className="warning-tip">
                        <strong>Tip:</strong> You can convert your config to JSON using:
                        <code>oh-my-posh config export --format json</code>
                    </div>
                </div>
            </div>
        );
    }

    // Error state
    if (state.error && !state.editedConfig) {
        return (
            <div className="omp-configurator error">
                <div className="omp-error">
                    <i className="fa fa-solid fa-circle-exclamation" />
                    <div className="error-title">Failed to Load Configuration</div>
                    <div className="error-message">{state.error}</div>
                    <button className="btn-secondary" onClick={loadConfig}>
                        <i className="fa fa-solid fa-rotate" />
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className={cn("omp-configurator", { "has-changes": state.hasChanges })}>
            <div className="omp-configurator-header">
                <div className="header-title">
                    <i className="fa fa-solid fa-wand-magic-sparkles" />
                    <span>Theme Configurator</span>
                </div>
                <div className="header-path">
                    <span className="path-label">Config:</span>
                    <span className="path-value" title={state.configPath ?? undefined}>
                        {state.configPath?.split(/[/\\]/).pop() ?? "Unknown"}
                    </span>
                    {state.configSource === "POSH_THEME" && (
                        <span className="path-source" title="Loaded from $POSH_THEME environment variable">
                            $POSH_THEME
                        </span>
                    )}
                </div>
            </div>

            {/* Error banner for save errors */}
            {state.error && state.editedConfig && (
                <div className="omp-error-banner">
                    <i className="fa fa-solid fa-circle-exclamation" />
                    <span>{state.error}</span>
                    <button onClick={() => setState((s) => ({ ...s, error: null }))}>
                        <i className="fa fa-solid fa-times" />
                    </button>
                </div>
            )}

            {/* Unsaved changes banner */}
            {state.hasChanges && (
                <div className="omp-unsaved-banner">
                    <i className="fa fa-solid fa-exclamation-circle" />
                    <span>You have unsaved changes</span>
                </div>
            )}

            {/* Config preview */}
            <OmpConfigPreview config={state.editedConfig} previewBackground={previewBackground} />

            {/* Block editor */}
            <OmpBlockEditor
                config={state.editedConfig}
                selectedBlockIndex={state.selectedBlockIndex}
                selectedSegmentIndex={state.selectedSegmentIndex}
                onBlockSelect={handleBlockSelect}
                onSegmentSelect={handleSegmentSelect}
                onConfigUpdate={handleConfigUpdate}
            />

            {/* Action buttons */}
            <ActionButtons
                hasChanges={state.hasChanges}
                saving={state.saving}
                onSave={handleSave}
                onCancel={handleCancel}
            />

            {/* Advanced section */}
            <AdvancedSection
                config={state.editedConfig}
                configPath={state.configPath}
                backupExists={state.backupExists}
                onImport={handleImport}
                onReload={loadConfig}
            />
        </div>
    );
});

OmpConfigurator.displayName = "OmpConfigurator";
