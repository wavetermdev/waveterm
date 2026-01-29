// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Display Settings
 *
 * Visual/display settings for the Appearance panel's "Display Settings" collapsible section.
 * Reuses the same SettingControl component as the General tab for consistent UI
 * (modified indicator, reset button, same row layout).
 */

import { SettingControl } from "@/app/element/settings/setting-control";
import { ColorControl } from "@/app/element/settings/color-control";
import { FontControl } from "@/app/element/settings/font-control";
import { SliderControl } from "@/app/element/settings/slider-control";
import { ToggleControl } from "@/app/element/settings/toggle-control";
import { getSettingsKeyAtom } from "@/app/store/global";
import { settingsService } from "@/app/store/settings-service";
import { useAtomValue } from "jotai";
import { memo, useCallback } from "react";

import "./display-settings.scss";

// Default values for display settings (used for modified detection and reset)
const DEFAULTS: Record<string, boolean | number | string> = {
    "window:transparent": false,
    "window:blur": false,
    "window:opacity": 1,
    "window:bgcolor": "",
    "window:zoom": 1,
    "term:fontsize": 12,
    "term:fontfamily": "",
    "term:ligatures": false,
    "term:transparency": 0,
    "editor:fontsize": 12,
    "editor:minimapenabled": false,
    "ai:fontsize": 14,
    "ai:fixedfontsize": 12,
};

interface SubSectionProps {
    title: string;
    children: React.ReactNode;
}

const SubSection = memo(({ title, children }: SubSectionProps) => (
    <div className="display-subsection">
        <div className="display-subsection-title">{title}</div>
        <div className="display-subsection-content">{children}</div>
    </div>
));

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

    const makeSetter = useCallback(
        (key: string) => (value: unknown) => {
            settingsService.setSetting(key, value);
        },
        []
    );

    const makeOnChange = useCallback(
        (key: string) => makeSetter(key) as (value: boolean | number | string | string[] | null) => void,
        [makeSetter]
    );

    const isModified = useCallback((key: string, value: unknown): boolean => {
        const def = DEFAULTS[key];
        return value !== def && value !== undefined && value !== null;
    }, []);

    return (
        <div className="display-settings">
            <SubSection title="Window">
                <SettingControl
                    settingKey="window:transparent"
                    label="Transparent Window"
                    description=""
                    value={windowTransparent as boolean}
                    defaultValue={DEFAULTS["window:transparent"]}
                    onChange={makeOnChange("window:transparent")}
                    isModified={isModified("window:transparent", windowTransparent)}
                    requiresRestart
                >
                    <ToggleControl
                        value={Boolean(windowTransparent)}
                        onChange={makeSetter("window:transparent") as (v: boolean) => void}
                    />
                </SettingControl>
                <SettingControl
                    settingKey="window:blur"
                    label="Background Blur"
                    description=""
                    value={windowBlur as boolean}
                    defaultValue={DEFAULTS["window:blur"]}
                    onChange={makeOnChange("window:blur")}
                    isModified={isModified("window:blur", windowBlur)}
                >
                    <ToggleControl
                        value={Boolean(windowBlur)}
                        onChange={makeSetter("window:blur") as (v: boolean) => void}
                    />
                </SettingControl>
                <SettingControl
                    settingKey="window:opacity"
                    label="Window Opacity"
                    description=""
                    value={windowOpacity as number}
                    defaultValue={DEFAULTS["window:opacity"]}
                    onChange={makeOnChange("window:opacity")}
                    isModified={isModified("window:opacity", windowOpacity)}
                >
                    <SliderControl
                        value={Number(windowOpacity)}
                        onChange={makeSetter("window:opacity") as (v: number) => void}
                        min={0.1}
                        max={1}
                        step={0.05}
                    />
                </SettingControl>
                <SettingControl
                    settingKey="window:bgcolor"
                    label="Background Color"
                    description=""
                    value={windowBgcolor as string}
                    defaultValue={DEFAULTS["window:bgcolor"]}
                    onChange={makeOnChange("window:bgcolor")}
                    isModified={isModified("window:bgcolor", windowBgcolor)}
                >
                    <ColorControl
                        value={String(windowBgcolor)}
                        onChange={makeSetter("window:bgcolor") as (v: string) => void}
                    />
                </SettingControl>
                <SettingControl
                    settingKey="window:zoom"
                    label="Interface Zoom"
                    description=""
                    value={windowZoom as number}
                    defaultValue={DEFAULTS["window:zoom"]}
                    onChange={makeOnChange("window:zoom")}
                    isModified={isModified("window:zoom", windowZoom)}
                >
                    <SliderControl
                        value={Number(windowZoom)}
                        onChange={makeSetter("window:zoom") as (v: number) => void}
                        min={0.5}
                        max={2}
                        step={0.1}
                    />
                </SettingControl>
            </SubSection>

            <SubSection title="Terminal">
                <SettingControl
                    settingKey="term:fontsize"
                    label="Font Size"
                    description=""
                    value={termFontsize as number}
                    defaultValue={DEFAULTS["term:fontsize"]}
                    onChange={makeOnChange("term:fontsize")}
                    isModified={isModified("term:fontsize", termFontsize)}
                >
                    <SliderControl
                        value={Number(termFontsize)}
                        onChange={makeSetter("term:fontsize") as (v: number) => void}
                        min={8}
                        max={24}
                        step={1}
                    />
                </SettingControl>
                <SettingControl
                    settingKey="term:fontfamily"
                    label="Font Family"
                    description=""
                    value={termFontfamily as string}
                    defaultValue={DEFAULTS["term:fontfamily"]}
                    onChange={makeOnChange("term:fontfamily")}
                    isModified={isModified("term:fontfamily", termFontfamily)}
                >
                    <FontControl
                        value={String(termFontfamily)}
                        onChange={makeSetter("term:fontfamily") as (v: string) => void}
                        showPreview={false}
                    />
                </SettingControl>
                <SettingControl
                    settingKey="term:ligatures"
                    label="Font Ligatures"
                    description=""
                    value={termLigatures as boolean}
                    defaultValue={DEFAULTS["term:ligatures"]}
                    onChange={makeOnChange("term:ligatures")}
                    isModified={isModified("term:ligatures", termLigatures)}
                >
                    <ToggleControl
                        value={Boolean(termLigatures)}
                        onChange={makeSetter("term:ligatures") as (v: boolean) => void}
                    />
                </SettingControl>
                <SettingControl
                    settingKey="term:transparency"
                    label="Transparency"
                    description=""
                    value={termTransparency as number}
                    defaultValue={DEFAULTS["term:transparency"]}
                    onChange={makeOnChange("term:transparency")}
                    isModified={isModified("term:transparency", termTransparency)}
                >
                    <SliderControl
                        value={Number(termTransparency)}
                        onChange={makeSetter("term:transparency") as (v: number) => void}
                        min={0}
                        max={1}
                        step={0.1}
                    />
                </SettingControl>
            </SubSection>

            <SubSection title="Editor">
                <SettingControl
                    settingKey="editor:fontsize"
                    label="Font Size"
                    description=""
                    value={editorFontsize as number}
                    defaultValue={DEFAULTS["editor:fontsize"]}
                    onChange={makeOnChange("editor:fontsize")}
                    isModified={isModified("editor:fontsize", editorFontsize)}
                >
                    <SliderControl
                        value={Number(editorFontsize)}
                        onChange={makeSetter("editor:fontsize") as (v: number) => void}
                        min={8}
                        max={24}
                        step={1}
                    />
                </SettingControl>
                <SettingControl
                    settingKey="editor:minimapenabled"
                    label="Show Minimap"
                    description=""
                    value={editorMinimap as boolean}
                    defaultValue={DEFAULTS["editor:minimapenabled"]}
                    onChange={makeOnChange("editor:minimapenabled")}
                    isModified={isModified("editor:minimapenabled", editorMinimap)}
                >
                    <ToggleControl
                        value={Boolean(editorMinimap)}
                        onChange={makeSetter("editor:minimapenabled") as (v: boolean) => void}
                    />
                </SettingControl>
            </SubSection>

            <SubSection title="AI Panel">
                <SettingControl
                    settingKey="ai:fontsize"
                    label="Text Font Size"
                    description=""
                    value={aiFontsize as number}
                    defaultValue={DEFAULTS["ai:fontsize"]}
                    onChange={makeOnChange("ai:fontsize")}
                    isModified={isModified("ai:fontsize", aiFontsize)}
                >
                    <SliderControl
                        value={Number(aiFontsize)}
                        onChange={makeSetter("ai:fontsize") as (v: number) => void}
                        min={10}
                        max={24}
                        step={1}
                    />
                </SettingControl>
                <SettingControl
                    settingKey="ai:fixedfontsize"
                    label="Code Font Size"
                    description=""
                    value={aiFixedFontsize as number}
                    defaultValue={DEFAULTS["ai:fixedfontsize"]}
                    onChange={makeOnChange("ai:fixedfontsize")}
                    isModified={isModified("ai:fixedfontsize", aiFixedFontsize)}
                >
                    <SliderControl
                        value={Number(aiFixedFontsize)}
                        onChange={makeSetter("ai:fixedfontsize") as (v: number) => void}
                        min={8}
                        max={20}
                        step={1}
                    />
                </SettingControl>
            </SubSection>
        </div>
    );
});

DisplaySettings.displayName = "DisplaySettings";
