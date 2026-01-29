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
import { memo, useCallback, useMemo, useState } from "react";

import "./appearance-content.scss";

interface AppearanceContentProps {
    model: WaveConfigViewModel;
}

/**
 * Main Appearance Content component
 */
export const AppearanceContent = memo(({ model }: AppearanceContentProps) => {
    const [expandedSections, setExpandedSections] = useState<Set<string>>(
        new Set(["theme", "display", "terminal-theme", "omp"])
    );
    const [termPreviewBg, setTermPreviewBg] = useState<PreviewBackground>("dark");
    const [ompPreviewBg, setOmpPreviewBg] = useState<PreviewBackground>("dark");

    // Get current settings
    const appTheme = (useAtomValue(getSettingsKeyAtom("app:theme")) as string) ?? "dark";
    const appAccent = (useAtomValue(getSettingsKeyAtom("app:accent")) as string) ?? "green";
    const termTheme = (useAtomValue(getSettingsKeyAtom("term:theme")) as string) ?? "default-dark";
    const ompTheme = (useAtomValue(getSettingsKeyAtom("term:omptheme")) as string) ?? "";
    const themeOverridesRaw = useAtomValue(getSettingsKeyAtom("app:themeoverrides")) as
        | Record<string, string>
        | undefined;
    const themeOverrides = useMemo(() => {
        if (themeOverridesRaw && typeof themeOverridesRaw === "object") {
            return themeOverridesRaw;
        }
        return {};
    }, [themeOverridesRaw]);
    const customAccentsRaw = useAtomValue(getSettingsKeyAtom("app:customaccents")) as
        | Record<string, { label: string; overrides: Record<string, string> }>
        | undefined;
    const customAccents = useMemo(() => {
        if (customAccentsRaw && typeof customAccentsRaw === "object") {
            return customAccentsRaw;
        }
        return undefined;
    }, [customAccentsRaw]);

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

    const handleOverrideChange = useCallback(
        (variable: string, value: string | null) => {
            const current = { ...themeOverrides };
            if (value === null) {
                delete current[variable];
            } else {
                current[variable] = value;
            }
            // Always save the object (even if empty) — avoids null-handling issues in backend
            settingsService.setSetting("app:themeoverrides", current);
        },
        [themeOverrides]
    );

    const handleSaveCustomAccent = useCallback(
        (name: string, overrides: Record<string, string>) => {
            let id = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
            if (!id) {
                alert("Please enter a valid name with at least one letter or number.");
                return;
            }
            const current = customAccents ? { ...customAccents } : {};
            // Avoid silently overwriting: append suffix if id already exists
            if (id in current) {
                let suffix = 2;
                while (`${id}-${suffix}` in current) suffix++;
                id = `${id}-${suffix}`;
            }
            current[id] = { label: name, overrides };
            settingsService.setSetting("app:customaccents", current);
            settingsService.setSetting("app:accent", `custom:${id}`);
            // Clear theme overrides since they're now saved in the custom accent
            settingsService.setSetting("app:themeoverrides", null);
        },
        [customAccents]
    );

    const handleDeleteCustomAccent = useCallback(
        (id: string) => {
            if (!customAccents) return;
            const current = { ...customAccents };
            delete current[id];
            const isEmpty = Object.keys(current).length === 0;
            settingsService.setSetting("app:customaccents", isEmpty ? null : current);
            // If the deleted accent was selected, switch back to green
            if (appAccent === `custom:${id}`) {
                settingsService.setSetting("app:accent", "green");
            }
        },
        [customAccents, appAccent]
    );

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
            {/* Theme: Mode, Accent, Palette grouped in a collapsible section */}
            <CollapsibleSection
                title="Theme"
                icon="palette"
                isExpanded={expandedSections.has("theme")}
                onToggle={() => toggleSection("theme")}
            >
                <div className="theme-subsections">
                    <div className="display-subsection">
                        <div className="display-subsection-title">
                            Mode
                        </div>
                        <div className="display-subsection-content">
                            <ModeSelector value={appTheme} onChange={handleThemeChange} />
                        </div>
                    </div>

                    <div className="display-subsection">
                        <div className="display-subsection-title">
                            Accent Theme
                        </div>
                        <div className="display-subsection-content">
                            <AccentSelector
                                value={appAccent}
                                onChange={handleAccentChange}
                                customAccents={customAccents}
                                themeOverrides={themeOverrides}
                                onSaveCustomAccent={handleSaveCustomAccent}
                                onDeleteCustomAccent={handleDeleteCustomAccent}
                            />
                        </div>
                    </div>

                    <div className="display-subsection">
                        <div className="display-subsection-title">
                            Color Palette Preview
                        </div>
                        <div className="display-subsection-content">
                            <ThemePalettePreview
                                themeOverrides={themeOverrides}
                                onOverrideChange={handleOverrideChange}
                            />
                        </div>
                    </div>
                </div>
            </CollapsibleSection>

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
                <div className="theme-subsections">
                    <div className="display-subsection">
                        <div className="display-subsection-title">
                            Themes
                        </div>
                        <div className="display-subsection-content">
                            <PreviewBackgroundToggle value={termPreviewBg} onChange={setTermPreviewBg} />
                            <TermThemeControl
                                value={termTheme}
                                onChange={handleTermThemeChange}
                                previewBackground={termPreviewBg}
                            />
                        </div>
                    </div>
                </div>
            </CollapsibleSection>

            <CollapsibleSection
                title="Oh-My-Posh Integration"
                icon="wand-magic-sparkles"
                isExpanded={expandedSections.has("omp")}
                onToggle={() => toggleSection("omp")}
            >
                <div className="theme-subsections">
                    <div className="display-subsection">
                        <div className="display-subsection-title">
                            Theme
                        </div>
                        <div className="display-subsection-content">
                            <PreviewBackgroundToggle value={ompPreviewBg} onChange={setOmpPreviewBg} />
                            <OmpThemeControl
                                value={ompTheme}
                                onChange={handleOmpThemeChange}
                                previewBackground={ompPreviewBg}
                            />
                        </div>
                    </div>

                    <div className="display-subsection">
                        <div className="display-subsection-title">Options</div>
                        <div className="display-subsection-content">
                            <OmpHighContrast />
                            <OmpPaletteExport />
                        </div>
                    </div>

                    <div className="display-subsection">
                        <div className="display-subsection-title">
                            Configurator
                        </div>
                        <div className="display-subsection-content">
                            <OmpConfigurator
                                previewBackground={ompPreviewBg}
                                onConfigChange={handleOmpConfigChange}
                            />
                        </div>
                    </div>
                </div>
            </CollapsibleSection>
        </div>
    );
});

AppearanceContent.displayName = "AppearanceContent";
