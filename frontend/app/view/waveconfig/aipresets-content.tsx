// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { useAtomValue } from "jotai";
import { memo, useMemo, useCallback } from "react";

import "./aipresets-content.scss";

interface AiPresetsContentProps {
    model: WaveConfigViewModel;
}

interface AiPreset {
    key: string;
    displayName?: string;
    model?: string;
    apiType?: string;
    hasToken: boolean;
}

/**
 * Parse AI presets from JSON content
 * Returns a list of presets with safe display information (no tokens)
 */
function parseAiPresets(content: string): AiPreset[] {
    if (!content || content.trim() === "" || content.trim() === "{}") {
        return [];
    }

    try {
        const parsed = JSON.parse(content);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            return [];
        }

        const presets: AiPreset[] = [];
        for (const key of Object.keys(parsed)) {
            if (!key.startsWith("ai@")) continue;

            const preset = parsed[key];
            if (typeof preset !== "object" || preset === null) continue;

            presets.push({
                key,
                displayName: preset["display:name"] || undefined,
                model: preset["ai:model"] || undefined,
                apiType: preset["ai:apitype"] || undefined,
                hasToken: Boolean(preset["ai:apitoken"]),
            });
        }

        return presets;
    } catch {
        return [];
    }
}

const DeprecationBanner = memo(() => {
    return (
        <div className="aipresets-deprecation-banner">
            <div className="banner-icon">
                <i className="fa-sharp fa-solid fa-triangle-exclamation" />
            </div>
            <div className="banner-content">
                <h3 className="banner-title">AI Presets is Deprecated</h3>
                <p className="banner-description">
                    This configuration format has been replaced by <strong>Wave AI Modes</strong>, which provides
                    a more flexible and powerful way to configure AI providers and models.
                </p>
            </div>
        </div>
    );
});
DeprecationBanner.displayName = "DeprecationBanner";

interface PresetListProps {
    presets: AiPreset[];
}

const PresetList = memo(({ presets }: PresetListProps) => {
    if (presets.length === 0) {
        return (
            <div className="aipresets-empty">
                <i className="fa-sharp fa-solid fa-robot empty-icon" />
                <p>No AI presets configured</p>
            </div>
        );
    }

    return (
        <div className="aipresets-list">
            <h4 className="list-header">Existing Presets (Read-Only)</h4>
            <div className="list-items">
                {presets.map((preset) => (
                    <div key={preset.key} className="preset-item">
                        <div className="preset-key">
                            <code>{preset.key}</code>
                        </div>
                        <div className="preset-details">
                            {preset.displayName && (
                                <span className="preset-detail">
                                    <span className="detail-label">Name:</span>
                                    <span className="detail-value">{preset.displayName}</span>
                                </span>
                            )}
                            {preset.model && (
                                <span className="preset-detail">
                                    <span className="detail-label">Model:</span>
                                    <span className="detail-value">{preset.model}</span>
                                </span>
                            )}
                            {preset.apiType && (
                                <span className="preset-detail">
                                    <span className="detail-label">API:</span>
                                    <span className="detail-value">{preset.apiType}</span>
                                </span>
                            )}
                            {preset.hasToken && (
                                <span className="preset-detail token-indicator">
                                    <i className="fa-sharp fa-solid fa-key" />
                                    <span className="detail-value">Token configured</span>
                                </span>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
});
PresetList.displayName = "PresetList";

interface ActionButtonsProps {
    model: WaveConfigViewModel;
}

const ActionButtons = memo(({ model }: ActionButtonsProps) => {
    const handleViewWaveAiModes = useCallback(() => {
        const waveAiFile = model.getConfigFiles().find((f) => f.path === "waveai.json");
        if (waveAiFile) {
            model.loadFile(waveAiFile);
        }
    }, [model]);

    return (
        <div className="aipresets-actions">
            <button className="action-btn primary" onClick={handleViewWaveAiModes}>
                <i className="fa-sharp fa-solid fa-sparkles" />
                View Wave AI Modes
            </button>
            <button
                className="action-btn secondary"
                onClick={() => {
                    // Switch to JSON view by reloading without visual component override
                    const selectedFile = model.getDeprecatedConfigFiles().find((f) => f.path === "presets/ai.json");
                    if (selectedFile) {
                        // Clear the visual component temporarily to show JSON editor
                        model.loadFile({ ...selectedFile, visualComponent: undefined });
                    }
                }}
            >
                <i className="fa-sharp fa-solid fa-code" />
                Edit Raw JSON
            </button>
        </div>
    );
});
ActionButtons.displayName = "ActionButtons";

const MigrationGuide = memo(() => {
    return (
        <div className="aipresets-migration-guide">
            <h4 className="guide-header">
                <i className="fa-sharp fa-solid fa-arrow-right-arrow-left" />
                Migration Guide
            </h4>
            <div className="guide-content">
                <p>To migrate your AI presets to Wave AI Modes:</p>
                <ol className="guide-steps">
                    <li>
                        <strong>Open Wave AI Modes</strong> - Click the button above or select the "Wave AI Modes" tab
                    </li>
                    <li>
                        <strong>Create equivalent entries</strong> - Wave AI Modes uses a simpler key format without the <code>ai@</code> prefix
                    </li>
                    <li>
                        <strong>Move your API tokens</strong> - For security, consider using the Secrets manager for API tokens instead of storing them in config files
                    </li>
                    <li>
                        <strong>Test your configuration</strong> - Verify that AI functionality works with the new modes
                    </li>
                    <li>
                        <strong>Remove old presets</strong> - Once migrated, you can safely delete this file
                    </li>
                </ol>
                <div className="guide-note">
                    <i className="fa-sharp fa-solid fa-circle-info" />
                    <span>
                        Wave AI Modes supports all providers: OpenAI, Anthropic, Azure, Ollama, and more.
                        See the <a href="https://docs.waveterm.dev/waveai-modes?ref=waveconfig" target="_blank" rel="noopener noreferrer">documentation</a> for details.
                    </span>
                </div>
            </div>
        </div>
    );
});
MigrationGuide.displayName = "MigrationGuide";

export const AiPresetsContent = memo(({ model }: AiPresetsContentProps) => {
    const fileContent = useAtomValue(model.fileContentAtom);
    const isLoading = useAtomValue(model.isLoadingAtom);

    const presets = useMemo(() => parseAiPresets(fileContent), [fileContent]);

    if (isLoading) {
        return (
            <div className="aipresets-content">
                <div className="aipresets-loading">
                    <i className="fa-sharp fa-solid fa-spinner fa-spin" />
                    <span>Loading...</span>
                </div>
            </div>
        );
    }

    return (
        <div className="aipresets-content">
            <div className="aipresets-scroll-container">
                <DeprecationBanner />
                <ActionButtons model={model} />
                <PresetList presets={presets} />
                <MigrationGuide />
            </div>
        </div>
    );
});

AiPresetsContent.displayName = "AiPresetsContent";
