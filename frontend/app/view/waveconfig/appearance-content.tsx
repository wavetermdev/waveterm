// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Appearance Content
 *
 * Unified appearance settings panel with Mode (Dark/Light/System),
 * Accent Theme selection, color palette preview, display settings,
 * terminal color scheme, and Oh-My-Posh integration.
 */

import { CollapsibleSection } from "@/app/element/collapsible-section";
import { AccentSelector } from "@/app/element/settings/accent-selector";
import { ModeSelector } from "@/app/element/settings/mode-selector";
import { OmpConfigurator } from "@/app/element/settings/omp-configurator";
import { reinitOmpInAllTerminals } from "@/app/element/settings/omp-configurator/omp-utils";
import { OmpHighContrast } from "@/app/element/settings/omp-high-contrast";
import { OmpPaletteExport } from "@/app/element/settings/omp-palette-export";
import { OmpThemeControl } from "@/app/element/settings/omptheme-control";
import { PreviewBackgroundToggle, type PreviewBackground } from "@/app/element/settings/preview-background-toggle";
import { TermThemeControl } from "@/app/element/settings/termtheme-control";
import { ThemePalettePreview } from "@/app/element/settings/theme-palette-preview";
import { getSettingsKeyAtom } from "@/app/store/global";
import { settingsService } from "@/app/store/settings-service";
import { DisplaySettings } from "@/app/view/waveconfig/display-settings";
import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { useAtomValue } from "jotai";
import { memo, useCallback, useState } from "react";

import "./appearance-content.scss";

interface AppearanceContentProps {
    model: WaveConfigViewModel;
}

/**
 * Main Appearance Content component
 */
export const AppearanceContent = memo(({ model }: AppearanceContentProps) => {
    const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["terminal-theme"]));
    const [termPreviewBg, setTermPreviewBg] = useState<PreviewBackground>("dark");
    const [ompPreviewBg, setOmpPreviewBg] = useState<PreviewBackground>("dark");

    // Get current settings
    const appTheme = (useAtomValue(getSettingsKeyAtom("app:theme")) as string) ?? "dark";
    const appAccent = (useAtomValue(getSettingsKeyAtom("app:accent")) as string) ?? "green";
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

    const handleAccentChange = useCallback((value: string) => {
        settingsService.setSetting("app:accent", value);
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
            {/* Mode and Accent are always visible (not collapsible) */}
            <div className="appearance-section">
                <div className="appearance-section-label">Mode</div>
                <ModeSelector value={appTheme} onChange={handleThemeChange} />
            </div>

            <div className="appearance-section">
                <div className="appearance-section-label">Accent Theme</div>
                <AccentSelector value={appAccent} onChange={handleAccentChange} />
            </div>

            <div className="appearance-section">
                <div className="appearance-section-label">Color Palette Preview</div>
                <ThemePalettePreview />
            </div>

            {/* Collapsible sections */}
            <CollapsibleSection
                title="Display Settings"
                icon="sliders"
                isExpanded={expandedSections.has("display")}
                onToggle={() => toggleSection("display")}
            >
                <DisplaySettings />
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
        </div>
    );
});

AppearanceContent.displayName = "AppearanceContent";
