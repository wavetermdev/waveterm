// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    ConfigBooleanField,
    ConfigFontSizeField,
    ConfigNumberField,
    ConfigSection,
    ConfigSelectField,
    ConfigStringField,
} from "@/app/configui/configwidgets";
import { getEffectiveConfigValue, isConfigValueOverridden } from "@/app/configui/configvalidation";
import { DefaultFullConfig } from "@/preview/mock/defaultconfig";
import type { Dispatch, SetStateAction } from "react";
import { useMemo, useState } from "react";

const DefaultSettings = DefaultFullConfig.settings;

const InitialSettings: SettingsType = {
    "term:fontsize": 16,
    "term:cursorblink": false,
    "preview:defaultsort": "modtime",
    "conn:localhostdisplayname": "",
    "window:magnifiedblocksize": 0.95,
};

const FocusFollowsCursorOptions = [
    { value: "off", label: "Off" },
    { value: "on", label: "All blocks" },
    { value: "term", label: "Terminal blocks only" },
];

const CursorOptions = [
    { value: "block", label: "Block" },
    { value: "underline", label: "Underline" },
    { value: "bar", label: "Bar" },
];

const PreviewSortOptions = [
    { value: "name", label: "Name" },
    { value: "modtime", label: "Modified time" },
];

function setSettingsValue<Key extends keyof SettingsType>(
    setSettings: Dispatch<SetStateAction<SettingsType>>,
    key: Key,
    value: SettingsType[Key]
) {
    setSettings((prev) => {
        const next = { ...prev };
        if (value == null) {
            delete next[key];
            return next;
        }
        next[key] = value;
        return next;
    });
}

function formatPercent(value: number): string {
    return `${Math.round(value * 100)}%`;
}

function formatNullableString(value: string): string {
    if (value === "") {
        return "(empty string)";
    }
    return value;
}

function getEffectiveSetting<Key extends keyof SettingsType>(settings: SettingsType, key: Key): NonNullable<SettingsType[Key]> {
    return getEffectiveConfigValue(settings[key] as any, DefaultSettings[key] as any);
}

export function ConfiguiPreview() {
    const [settings, setSettings] = useState<SettingsType>(InitialSettings);

    const overriddenEntries = useMemo(() => Object.entries(settings).sort(([a], [b]) => a.localeCompare(b)), [settings]);
    const previewJson = useMemo(() => JSON.stringify(settings, null, 2), [settings]);

    const hideAiButton = getEffectiveSetting(settings, "app:hideaibutton");
    const focusFollowsCursor = getEffectiveSetting(settings, "app:focusfollowscursor");
    const cursorStyle = getEffectiveSetting(settings, "term:cursor");
    const cursorBlink = getEffectiveSetting(settings, "term:cursorblink");
    const terminalFontSize = getEffectiveSetting(settings, "term:fontsize");
    const fontFamily = getEffectiveSetting(settings, "term:fontfamily");
    const previewSort = getEffectiveSetting(settings, "preview:defaultsort");
    const defaultSearch = getEffectiveSetting(settings, "web:defaultsearch");
    const sampleLabel = getEffectiveSetting(settings, "conn:localhostdisplayname");
    const magnifiedBlockSize = getEffectiveSetting(settings, "window:magnifiedblocksize");
    const magnifiedBlockOpacity = getEffectiveSetting(settings, "window:magnifiedblockopacity");

    return (
        <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-6 p-6">
            <div className="flex flex-col gap-2">
                <h1 className="text-2xl font-semibold text-foreground">Config UI preview</h1>
                <p className="max-w-4xl text-sm text-muted">
                    Preview-only form controls for JSON-backed config keys, with explicit support for inherited defaults versus user overrides. A key being unset means the default still applies, even if the default happens to match an override value.
                </p>
                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={() => setSettings(InitialSettings)}
                        className="rounded bg-accent/80 px-3 py-1.5 text-sm text-primary transition-colors hover:bg-accent cursor-pointer"
                    >
                        Restore sample overrides
                    </button>
                    <button
                        type="button"
                        onClick={() => setSettings({})}
                        className="rounded border border-border px-3 py-1.5 text-sm text-muted transition-colors hover:bg-hover cursor-pointer"
                    >
                        Use defaults for everything
                    </button>
                </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
                <div className="flex flex-col gap-6">
                    <ConfigSection
                        title="Application"
                        description="Booleans and enums can explicitly choose Default, which keeps the key out of the user config while still showing the effective value."
                    >
                        <ConfigBooleanField
                            configKey="app:hideaibutton"
                            label="Hide Wave AI button"
                            description="When enabled, the AI button is hidden from the tab bar."
                            value={settings["app:hideaibutton"]}
                            defaultValue={DefaultSettings["app:hideaibutton"]}
                            onValueChange={(value) => setSettingsValue(setSettings, "app:hideaibutton", value)}
                            trueLabel="True"
                            falseLabel="False"
                        />
                        <ConfigSelectField
                            configKey="app:focusfollowscursor"
                            label="Focus follows cursor"
                            description="Controls whether cursor movement also changes the focused block."
                            value={settings["app:focusfollowscursor"]}
                            defaultValue={DefaultSettings["app:focusfollowscursor"]}
                            options={FocusFollowsCursorOptions}
                            onValueChange={(value) => setSettingsValue(setSettings, "app:focusfollowscursor", value)}
                        />
                        <ConfigStringField
                            configKey="conn:localhostdisplayname"
                            label="Localhost display name"
                            description="An empty string is a valid explicit override, which is different from leaving the key unset."
                            value={settings["conn:localhostdisplayname"]}
                            defaultValue={DefaultSettings["conn:localhostdisplayname"]}
                            blankValue=""
                            valueFormatter={formatNullableString}
                            placeholder="My Laptop"
                            validation={{ maxLength: 40 }}
                            onValueChange={(value) => setSettingsValue(setSettings, "conn:localhostdisplayname", value)}
                            hint="This preview starts with an explicit empty-string override to show that it is distinct from inheriting the default label"
                        />
                    </ConfigSection>

                    <ConfigSection
                        title="Terminal"
                        description="Overridden badges stay visible even when the explicit value matches the default."
                    >
                        <ConfigSelectField
                            configKey="term:cursor"
                            label="Cursor style"
                            description="Valid values are `block`, `underline`, and `bar`."
                            value={settings["term:cursor"]}
                            defaultValue={DefaultSettings["term:cursor"]}
                            options={CursorOptions}
                            onValueChange={(value) => setSettingsValue(setSettings, "term:cursor", value)}
                        />
                        <ConfigBooleanField
                            configKey="term:cursorblink"
                            label="Cursor blink"
                            description="This preview starts with an explicit `false` override, even though the default is also false."
                            value={settings["term:cursorblink"]}
                            defaultValue={DefaultSettings["term:cursorblink"]}
                            onValueChange={(value) => setSettingsValue(setSettings, "term:cursorblink", value)}
                            trueLabel="On"
                            falseLabel="Off"
                        />
                        <ConfigFontSizeField
                            configKey="term:fontsize"
                            label="Terminal font size"
                            description="Float-friendly font-size editor with preset chips and a live sample."
                            value={settings["term:fontsize"]}
                            defaultValue={DefaultSettings["term:fontsize"]}
                            onValueChange={(value) => setSettingsValue(setSettings, "term:fontsize", value)}
                        />
                    </ConfigSection>

                    <ConfigSection
                        title="Preview, web, and window"
                        description="Examples of inherited values, changed overrides, and an override that exactly matches the default."
                    >
                        <ConfigSelectField
                            configKey="preview:defaultsort"
                            label="Preview default sort"
                            description="This preview starts with a real override that differs from the default."
                            value={settings["preview:defaultsort"]}
                            defaultValue={DefaultSettings["preview:defaultsort"]}
                            options={PreviewSortOptions}
                            onValueChange={(value) => setSettingsValue(setSettings, "preview:defaultsort", value)}
                        />
                        <ConfigStringField
                            configKey="web:defaultsearch"
                            label="Default search template"
                            description="Validated string input requiring a `{query}` placeholder."
                            value={settings["web:defaultsearch"]}
                            defaultValue={DefaultSettings["web:defaultsearch"]}
                            placeholder="https://www.google.com/search?q={query}"
                            validation={{
                                required: true,
                                validate: (value) => (!value.includes("{query}") ? "Must include {query}" : undefined),
                            }}
                            onValueChange={(value) => setSettingsValue(setSettings, "web:defaultsearch", value)}
                        />
                        <ConfigNumberField
                            configKey="window:magnifiedblocksize"
                            label="Magnified block size"
                            description="This starts overridden to the same numeric value as the default so the badge can show the difference between `0.95` and unset."
                            value={settings["window:magnifiedblocksize"]}
                            defaultValue={DefaultSettings["window:magnifiedblocksize"]}
                            valueFormatter={formatPercent}
                            validation={{ min: 0.5, max: 1 }}
                            step={0.01}
                            onValueChange={(value) => setSettingsValue(setSettings, "window:magnifiedblocksize", value)}
                            hint="Even when the effective value is 95%, an explicit override should still be visibly different from using the default"
                        />
                        <ConfigNumberField
                            configKey="window:magnifiedblockopacity"
                            label="Magnified block opacity"
                            description="An inherited numeric default with a visible effective value."
                            value={settings["window:magnifiedblockopacity"]}
                            defaultValue={DefaultSettings["window:magnifiedblockopacity"]}
                            valueFormatter={formatPercent}
                            validation={{ min: 0, max: 1 }}
                            step={0.05}
                            onValueChange={(value) => setSettingsValue(setSettings, "window:magnifiedblockopacity", value)}
                        />
                    </ConfigSection>
                </div>

                <div className="flex flex-col gap-6">
                    <ConfigSection
                        title="Override summary"
                        description="This shows exactly which keys would be written to `settings.json`. Badges in the form show the same distinction inline."
                    >
                        <div className="rounded-lg border border-border bg-background/50 p-4">
                            <div className="mb-3 text-xs uppercase tracking-wide text-muted">
                                {overriddenEntries.length} overridden {overriddenEntries.length === 1 ? "key" : "keys"}
                            </div>
                            {overriddenEntries.length === 0 ? (
                                <div className="text-sm text-muted">Everything is inheriting from the shipped defaults.</div>
                            ) : (
                                <div className="flex flex-col gap-2">
                                    {overriddenEntries.map(([key, value]) => (
                                        <div key={key} className="flex items-center justify-between gap-3 rounded border border-border bg-panel px-3 py-2 text-xs">
                                            <span className="font-mono text-accent">{key}</span>
                                            <span className="font-mono text-foreground">{JSON.stringify(value)}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </ConfigSection>

                    <ConfigSection title="Rendered sample" description="Effective values are what the app would use after merging user settings with the default config.">
                        <div className="rounded-lg border border-border bg-background/50 p-4">
                            <div className="mb-3 text-xs uppercase tracking-wide text-muted">Effective settings sample</div>
                            <div className="rounded-md border border-border bg-panel p-4">
                                <div className="mb-2 text-xs text-muted">
                                    {sampleLabel === "" ? "connection label hidden by explicit empty-string override" : `connection label: ${sampleLabel}`}
                                </div>
                                <div className="mb-3 text-xs text-muted">
                                    hide AI button: {String(hideAiButton)} · focus follows cursor: {focusFollowsCursor}
                                </div>
                                <div className="text-muted" style={{ fontFamily, fontSize: terminalFontSize }}>
                                    <div>$ echo &quot;waveterm config preview&quot;</div>
                                    <div>cursor: {cursorStyle}</div>
                                    <div>blink: {String(cursorBlink)}</div>
                                    <div>preview sort: {previewSort}</div>
                                    <div>magnified block size: {formatPercent(magnifiedBlockSize)}</div>
                                    <div>magnified block opacity: {formatPercent(magnifiedBlockOpacity)}</div>
                                    <div>default search: {defaultSearch}</div>
                                </div>
                            </div>
                        </div>
                    </ConfigSection>

                    <ConfigSection title="JSON output" description="Only overridden values are written here. Using Default removes the key from the output entirely.">
                        <pre className="max-h-[720px] overflow-auto rounded-lg border border-border bg-panel p-4 text-xs text-foreground">
                            {previewJson}
                        </pre>
                    </ConfigSection>

                    <ConfigSection title="Value source examples" description="A quick comparison of inherited versus explicit values, including when the effective value is the same.">
                        <div className="grid gap-2 text-xs text-muted">
                            <div className="rounded border border-border bg-panel px-3 py-2">
                                term:cursorblink → effective {String(cursorBlink)} · source{" "}
                                {isConfigValueOverridden(settings["term:cursorblink"]) ? "override" : "default"}
                            </div>
                            <div className="rounded border border-border bg-panel px-3 py-2">
                                window:magnifiedblocksize → effective {formatPercent(magnifiedBlockSize)} · source{" "}
                                {isConfigValueOverridden(settings["window:magnifiedblocksize"]) ? "override" : "default"}
                            </div>
                        </div>
                    </ConfigSection>
                </div>
            </div>
        </div>
    );
}
