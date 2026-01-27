// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Display Settings
 *
 * Compact inline controls for visual/display settings,
 * embedded in the Appearance panel's "Display Settings" collapsible section.
 */

import { ColorControl } from "@/app/element/settings/color-control";
import { FontControl } from "@/app/element/settings/font-control";
import { SliderControl } from "@/app/element/settings/slider-control";
import { ToggleControl } from "@/app/element/settings/toggle-control";
import { getSettingsKeyAtom } from "@/app/store/global";
import { settingsService } from "@/app/store/settings-service";
import { useAtomValue } from "jotai";
import { memo, useCallback } from "react";

import "./display-settings.scss";

interface DisplaySettingRowProps {
    label: string;
    description?: string;
    requiresRestart?: boolean;
    children: React.ReactNode;
}

const DisplaySettingRow = memo(({ label, description, requiresRestart, children }: DisplaySettingRowProps) => {
    return (
        <div className="display-setting-row">
            <div className="display-setting-info">
                <span className="display-setting-label">{label}</span>
                {requiresRestart && <span className="display-setting-restart">Restart required</span>}
                {description && <span className="display-setting-description">{description}</span>}
            </div>
            <div className="display-setting-control">{children}</div>
        </div>
    );
});

DisplaySettingRow.displayName = "DisplaySettingRow";

interface SubSectionProps {
    title: string;
    children: React.ReactNode;
}

const SubSection = memo(({ title, children }: SubSectionProps) => {
    return (
        <div className="display-subsection">
            <div className="display-subsection-title">{title}</div>
            <div className="display-subsection-content">{children}</div>
        </div>
    );
});

SubSection.displayName = "SubSection";

export const DisplaySettings = memo(() => {
    // Window settings
    const windowTransparent = useAtomValue(getSettingsKeyAtom("window:transparent")) ?? false;
    const windowBlur = useAtomValue(getSettingsKeyAtom("window:blur")) ?? false;
    const windowOpacity = useAtomValue(getSettingsKeyAtom("window:opacity")) ?? 1;
    const windowBgcolor = useAtomValue(getSettingsKeyAtom("window:bgcolor")) ?? "";
    const windowZoom = useAtomValue(getSettingsKeyAtom("window:zoom")) ?? 1;

    // Terminal settings
    const termFontsize = useAtomValue(getSettingsKeyAtom("term:fontsize")) ?? 12;
    const termFontfamily = useAtomValue(getSettingsKeyAtom("term:fontfamily")) ?? "";
    const termLigatures = useAtomValue(getSettingsKeyAtom("term:ligatures")) ?? false;
    const termTransparency = useAtomValue(getSettingsKeyAtom("term:transparency")) ?? 0;

    // Editor settings
    const editorFontsize = useAtomValue(getSettingsKeyAtom("editor:fontsize")) ?? 12;
    const editorMinimap = useAtomValue(getSettingsKeyAtom("editor:minimapenabled")) ?? false;

    // AI settings
    const aiFontsize = useAtomValue(getSettingsKeyAtom("ai:fontsize")) ?? 14;
    const aiFixedFontsize = useAtomValue(getSettingsKeyAtom("ai:fixedfontsize")) ?? 12;

    // Generic change handler factory
    const makeSetter = useCallback(
        (key: string) => (value: unknown) => {
            settingsService.setSetting(key, value);
        },
        []
    );

    return (
        <div className="display-settings">
            <SubSection title="Window">
                <DisplaySettingRow label="Transparent Window" requiresRestart>
                    <ToggleControl
                        value={Boolean(windowTransparent)}
                        onChange={makeSetter("window:transparent") as (v: boolean) => void}
                    />
                </DisplaySettingRow>
                <DisplaySettingRow label="Background Blur">
                    <ToggleControl
                        value={Boolean(windowBlur)}
                        onChange={makeSetter("window:blur") as (v: boolean) => void}
                    />
                </DisplaySettingRow>
                <DisplaySettingRow label="Window Opacity">
                    <SliderControl
                        value={Number(windowOpacity)}
                        onChange={makeSetter("window:opacity") as (v: number) => void}
                        min={0.1}
                        max={1}
                        step={0.05}
                    />
                </DisplaySettingRow>
                <DisplaySettingRow label="Background Color">
                    <ColorControl
                        value={String(windowBgcolor)}
                        onChange={makeSetter("window:bgcolor") as (v: string) => void}
                    />
                </DisplaySettingRow>
                <DisplaySettingRow label="Interface Zoom">
                    <SliderControl
                        value={Number(windowZoom)}
                        onChange={makeSetter("window:zoom") as (v: number) => void}
                        min={0.5}
                        max={2}
                        step={0.1}
                    />
                </DisplaySettingRow>
            </SubSection>

            <SubSection title="Terminal">
                <DisplaySettingRow label="Font Size">
                    <SliderControl
                        value={Number(termFontsize)}
                        onChange={makeSetter("term:fontsize") as (v: number) => void}
                        min={8}
                        max={24}
                        step={1}
                    />
                </DisplaySettingRow>
                <DisplaySettingRow label="Font Family">
                    <FontControl
                        value={String(termFontfamily)}
                        onChange={makeSetter("term:fontfamily") as (v: string) => void}
                        showPreview={false}
                    />
                </DisplaySettingRow>
                <DisplaySettingRow label="Font Ligatures">
                    <ToggleControl
                        value={Boolean(termLigatures)}
                        onChange={makeSetter("term:ligatures") as (v: boolean) => void}
                    />
                </DisplaySettingRow>
                <DisplaySettingRow label="Transparency">
                    <SliderControl
                        value={Number(termTransparency)}
                        onChange={makeSetter("term:transparency") as (v: number) => void}
                        min={0}
                        max={1}
                        step={0.1}
                    />
                </DisplaySettingRow>
            </SubSection>

            <SubSection title="Editor">
                <DisplaySettingRow label="Font Size">
                    <SliderControl
                        value={Number(editorFontsize)}
                        onChange={makeSetter("editor:fontsize") as (v: number) => void}
                        min={8}
                        max={24}
                        step={1}
                    />
                </DisplaySettingRow>
                <DisplaySettingRow label="Show Minimap">
                    <ToggleControl
                        value={Boolean(editorMinimap)}
                        onChange={makeSetter("editor:minimapenabled") as (v: boolean) => void}
                    />
                </DisplaySettingRow>
            </SubSection>

            <SubSection title="AI Panel">
                <DisplaySettingRow label="Text Font Size">
                    <SliderControl
                        value={Number(aiFontsize)}
                        onChange={makeSetter("ai:fontsize") as (v: number) => void}
                        min={10}
                        max={24}
                        step={1}
                    />
                </DisplaySettingRow>
                <DisplaySettingRow label="Code Font Size">
                    <SliderControl
                        value={Number(aiFixedFontsize)}
                        onChange={makeSetter("ai:fixedfontsize") as (v: number) => void}
                        min={8}
                        max={20}
                        step={1}
                    />
                </DisplaySettingRow>
            </SubSection>
        </div>
    );
});

DisplaySettings.displayName = "DisplaySettings";
