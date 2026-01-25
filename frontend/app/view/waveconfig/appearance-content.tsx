// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Appearance Content
 *
 * Unified appearance settings panel that consolidates UI theme,
 * terminal color scheme, Oh-My-Posh integration, and tab backgrounds.
 */

import { CollapsibleSection } from "@/app/element/collapsible-section";
import { OmpConfigurator } from "@/app/element/settings/omp-configurator";
import { reinitOmpInAllTerminals } from "@/app/element/settings/omp-configurator/omp-utils";
import { OmpHighContrast } from "@/app/element/settings/omp-high-contrast";
import { OmpPaletteExport } from "@/app/element/settings/omp-palette-export";
import { OmpThemeControl } from "@/app/element/settings/omptheme-control";
import { PreviewBackgroundToggle, type PreviewBackground } from "@/app/element/settings/preview-background-toggle";
import { TermThemeControl } from "@/app/element/settings/termtheme-control";
import { getSettingsKeyAtom } from "@/app/store/global";
import { settingsService } from "@/app/store/settings-service";
import { BgPresetsContent } from "@/app/view/waveconfig/bgpresets-content";
import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { useAtomValue } from "jotai";
import { memo, useCallback, useState } from "react";

import "./appearance-content.scss";

interface AppearanceContentProps {
    model: WaveConfigViewModel;
}

const THEME_OPTIONS = [
    { value: "dark", label: "Dark", icon: "moon" },
    { value: "light", label: "Light", icon: "sun" },
    { value: "light-gray", label: "Light Gray", icon: "sun" },
    { value: "light-warm", label: "Light Warm", icon: "sun" },
    { value: "system", label: "System", icon: "desktop" },
];

/**
 * UI Theme Selector - Visual cards for app themes
 */
const UIThemeSelector = memo(({ value, onChange }: { value: string; onChange: (v: string) => void }) => {
    return (
        <div className="ui-theme-selector">
            {THEME_OPTIONS.map((theme) => (
                <button
                    key={theme.value}
                    className={`theme-card ${value === theme.value ? "selected" : ""}`}
                    onClick={() => onChange(theme.value)}
                    aria-pressed={value === theme.value}
                >
                    <div className={`theme-preview ${theme.value}`}>
                        <i className={`fa fa-solid fa-${theme.icon}`} />
                    </div>
                    <span className="theme-label">{theme.label}</span>
                    {value === theme.value && (
                        <span className="theme-check">
                            <i className="fa fa-solid fa-check" />
                        </span>
                    )}
                </button>
            ))}
        </div>
    );
});

UIThemeSelector.displayName = "UIThemeSelector";

/**
 * Main Appearance Content component
 */
export const AppearanceContent = memo(({ model }: AppearanceContentProps) => {
    const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["ui-theme", "terminal-theme"]));
    const [termPreviewBg, setTermPreviewBg] = useState<PreviewBackground>("dark");
    const [ompPreviewBg, setOmpPreviewBg] = useState<PreviewBackground>("dark");

    // Get current settings
    const appTheme = (useAtomValue(getSettingsKeyAtom("app:theme")) as string) ?? "dark";
    const termTheme = (useAtomValue(getSettingsKeyAtom("term:theme")) as string) ?? "default-dark";
    const ompTheme = (useAtomValue(getSettingsKeyAtom("term:omptheme")) as string) ?? "";

    const toggleSection = useCallback((section: string) => {
        setExpandedSections((prev) => {
            const next = new Set(prev);
            if (next.has(section)) {
                next.delete(section);
            } else {
                next.add(section);
            }
            return next;
        });
    }, []);

    const handleThemeChange = useCallback((value: string) => {
        settingsService.setSetting("app:theme", value);
    }, []);

    const handleTermThemeChange = useCallback((value: string) => {
        settingsService.setSetting("term:theme", value);
    }, []);

    const handleOmpThemeChange = useCallback(async (value: string) => {
        settingsService.setSetting("term:omptheme", value);
        // Trigger OMP reinit in all active terminals after theme change
        await reinitOmpInAllTerminals();
    }, []);

    const handleOmpConfigChange = useCallback(async () => {
        // Reinit terminals when config changes (called without parameters)
        await reinitOmpInAllTerminals();
    }, []);

    return (
        <div className="appearance-content">
            <div className="appearance-header">
                <h2>Appearance</h2>
                <p className="appearance-subtitle">Customize the look and feel of Wave Terminal</p>
            </div>

            <CollapsibleSection
                title="UI Theme"
                icon="palette"
                isExpanded={expandedSections.has("ui-theme")}
                onToggle={() => toggleSection("ui-theme")}
            >
                <UIThemeSelector value={appTheme} onChange={handleThemeChange} />
            </CollapsibleSection>

            <CollapsibleSection
                title="Terminal Color Scheme"
                icon="terminal"
                isExpanded={expandedSections.has("terminal-theme")}
                onToggle={() => toggleSection("terminal-theme")}
            >
                <PreviewBackgroundToggle value={termPreviewBg} onChange={setTermPreviewBg} />
                <TermThemeControl
                    value={termTheme}
                    onChange={handleTermThemeChange}
                    previewBackground={termPreviewBg}
                />
            </CollapsibleSection>

            <CollapsibleSection
                title="Oh-My-Posh Integration"
                icon="wand-magic-sparkles"
                isExpanded={expandedSections.has("omp")}
                onToggle={() => toggleSection("omp")}
            >
                <div className="omp-section">
                    <PreviewBackgroundToggle value={ompPreviewBg} onChange={setOmpPreviewBg} />
                    <OmpThemeControl
                        value={ompTheme}
                        onChange={handleOmpThemeChange}
                        previewBackground={ompPreviewBg}
                    />
                    <div className="section-divider" />
                    <OmpHighContrast />
                    <div className="section-divider" />
                    <OmpPaletteExport />
                    <div className="section-divider" />
                    <OmpConfigurator
                        previewBackground={ompPreviewBg}
                        onConfigChange={handleOmpConfigChange}
                    />
                </div>
            </CollapsibleSection>

            <CollapsibleSection
                title="Tab Backgrounds"
                icon="image"
                isExpanded={expandedSections.has("backgrounds")}
                onToggle={() => toggleSection("backgrounds")}
            >
                <BgPresetsContent model={model} />
            </CollapsibleSection>
        </div>
    );
});

AppearanceContent.displayName = "AppearanceContent";
