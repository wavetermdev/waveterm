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
import type { Dispatch, SetStateAction } from "react";
import { useMemo, useState } from "react";

const InitialSettings: SettingsType = {
    "app:hideaibutton": false,
    "app:focusfollowscursor": "off",
    "term:cursor": "block",
    "term:scrollback": 2000,
    "term:fontsize": 13,
    "term:fontfamily": "JetBrains Mono",
    "term:cursorblink": false,
    "preview:showhiddenfiles": true,
    "preview:defaultsort": "name",
    "web:defaultsearch": "https://www.google.com/search?q={query}",
    "conn:localhostdisplayname": "My Laptop",
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

export function ConfiguiPreview() {
    const [settings, setSettings] = useState<SettingsType>(InitialSettings);

    const previewJson = useMemo(() => JSON.stringify(settings, null, 2), [settings]);
    const terminalFontSize = settings["term:fontsize"] ?? 13;
    const fontFamily = settings["term:fontfamily"] || "system-ui";
    const sampleLabel = settings["conn:localhostdisplayname"] ?? "localhost";

    return (
        <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 p-6">
            <div className="flex flex-col gap-2">
                <h1 className="text-2xl font-semibold text-foreground">Config UI preview</h1>
                <p className="max-w-3xl text-sm text-muted">
                    Preview-only form controls for JSON-backed config keys. These widgets are not wired into production yet; they only demonstrate how a sample settings editor could feel.
                </p>
                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={() => setSettings(InitialSettings)}
                        className="rounded bg-accent/80 px-3 py-1.5 text-sm text-primary transition-colors hover:bg-accent cursor-pointer"
                    >
                        Restore sample values
                    </button>
                    <button
                        type="button"
                        onClick={() => setSettings({})}
                        className="rounded border border-border px-3 py-1.5 text-sm text-muted transition-colors hover:bg-hover cursor-pointer"
                    >
                        Clear all keys
                    </button>
                </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
                <div className="flex flex-col gap-6">
                    <ConfigSection
                        title="Application"
                        description="Booleans and enum-style dropdowns mapped from `settings.json` keys described in the docs."
                    >
                        <ConfigBooleanField
                            configKey="app:hideaibutton"
                            label="Hide Wave AI button"
                            description="When enabled, the AI button is hidden from the tab bar."
                            value={settings["app:hideaibutton"]}
                            onValueChange={(value) => setSettingsValue(setSettings, "app:hideaibutton", value)}
                            clearable
                            onClear={() => setSettingsValue(setSettings, "app:hideaibutton", undefined)}
                        />
                        <ConfigSelectField
                            configKey="app:focusfollowscursor"
                            label="Focus follows cursor"
                            description="Controls whether cursor movement also changes the focused block."
                            value={settings["app:focusfollowscursor"]}
                            options={FocusFollowsCursorOptions}
                            onValueChange={(value) => setSettingsValue(setSettings, "app:focusfollowscursor", value)}
                            clearable
                            onClear={() => setSettingsValue(setSettings, "app:focusfollowscursor", undefined)}
                        />
                        <ConfigStringField
                            configKey="conn:localhostdisplayname"
                            label="Localhost display name"
                            description="An empty string is meaningful here and hides the hostname label in the UI."
                            value={settings["conn:localhostdisplayname"]}
                            blankValue=""
                            placeholder="My Laptop"
                            validation={{ maxLength: 40 }}
                            onValueChange={(value) => setSettingsValue(setSettings, "conn:localhostdisplayname", value)}
                            hint="Blank is allowed and will still be written as an empty string"
                            clearable
                            onClear={() => setSettingsValue(setSettings, "conn:localhostdisplayname", undefined)}
                        />
                    </ConfigSection>

                    <ConfigSection
                        title="Terminal"
                        description="Example controls for booleans, numbers, enums, freeform strings, and font-size settings."
                    >
                        <ConfigSelectField
                            configKey="term:cursor"
                            label="Cursor style"
                            description="Valid values are `block`, `underline`, and `bar`."
                            value={settings["term:cursor"]}
                            options={CursorOptions}
                            onValueChange={(value) => setSettingsValue(setSettings, "term:cursor", value)}
                            clearable
                            onClear={() => setSettingsValue(setSettings, "term:cursor", undefined)}
                        />
                        <ConfigBooleanField
                            configKey="term:cursorblink"
                            label="Cursor blink"
                            description="Enables blinking for the terminal cursor."
                            value={settings["term:cursorblink"]}
                            onValueChange={(value) => setSettingsValue(setSettings, "term:cursorblink", value)}
                            clearable
                            onClear={() => setSettingsValue(setSettings, "term:cursorblink", undefined)}
                        />
                        <ConfigNumberField
                            configKey="term:scrollback"
                            label="Scrollback buffer"
                            description="Integer-only numeric editor with range validation."
                            value={settings["term:scrollback"]}
                            validation={{ min: 128, max: 10000, integer: true }}
                            onValueChange={(value) => setSettingsValue(setSettings, "term:scrollback", value)}
                            clearable
                            onClear={() => setSettingsValue(setSettings, "term:scrollback", undefined)}
                        />
                        <ConfigStringField
                            configKey="term:fontfamily"
                            label="Font family"
                            description="Freeform string input with a simple length cap."
                            value={settings["term:fontfamily"]}
                            placeholder="JetBrains Mono"
                            validation={{ maxLength: 80 }}
                            onValueChange={(value) => setSettingsValue(setSettings, "term:fontfamily", value)}
                            clearable
                            onClear={() => setSettingsValue(setSettings, "term:fontfamily", undefined)}
                        />
                        <ConfigFontSizeField
                            configKey="term:fontsize"
                            label="Terminal font size"
                            description="Float-friendly font-size editor with preset chips and a live sample."
                            value={settings["term:fontsize"]}
                            onValueChange={(value) => setSettingsValue(setSettings, "term:fontsize", value)}
                            clearable
                            onClear={() => setSettingsValue(setSettings, "term:fontsize", undefined)}
                        />
                    </ConfigSection>

                    <ConfigSection
                        title="Preview and web"
                        description="Additional examples of enum widgets, booleans, and custom string validation."
                    >
                        <ConfigBooleanField
                            configKey="preview:showhiddenfiles"
                            label="Show hidden files"
                            description="Toggles whether preview directory listings include hidden files."
                            value={settings["preview:showhiddenfiles"]}
                            onValueChange={(value) => setSettingsValue(setSettings, "preview:showhiddenfiles", value)}
                            clearable
                            onClear={() => setSettingsValue(setSettings, "preview:showhiddenfiles", undefined)}
                        />
                        <ConfigSelectField
                            configKey="preview:defaultsort"
                            label="Preview default sort"
                            description="Enum-style dropdown backed by the documented sort values."
                            value={settings["preview:defaultsort"]}
                            options={PreviewSortOptions}
                            onValueChange={(value) => setSettingsValue(setSettings, "preview:defaultsort", value)}
                            clearable
                            onClear={() => setSettingsValue(setSettings, "preview:defaultsort", undefined)}
                        />
                        <ConfigStringField
                            configKey="web:defaultsearch"
                            label="Default search template"
                            description="Validated string input requiring a `{query}` placeholder."
                            value={settings["web:defaultsearch"]}
                            placeholder="https://www.google.com/search?q={query}"
                            validation={{
                                required: true,
                                validate: (value) => (!value.includes("{query}") ? "Must include {query}" : undefined),
                            }}
                            onValueChange={(value) => setSettingsValue(setSettings, "web:defaultsearch", value)}
                            clearable
                            onClear={() => setSettingsValue(setSettings, "web:defaultsearch", undefined)}
                        />
                    </ConfigSection>
                </div>

                <div className="flex flex-col gap-6">
                    <ConfigSection title="Rendered sample" description="A lightweight card showing a few of the edited values applied together.">
                        <div className="rounded-lg border border-border bg-background/50 p-4">
                            <div className="mb-3 text-xs uppercase tracking-wide text-muted">Terminal sample</div>
                            <div className="rounded-md border border-border bg-panel p-4">
                                <div className="mb-2 text-xs text-muted">
                                    {sampleLabel === "" ? "localhost label hidden" : `connection label: ${sampleLabel}`}
                                </div>
                                <div className="text-muted" style={{ fontFamily, fontSize: terminalFontSize }}>
                                    <div>$ echo &quot;waveterm config preview&quot;</div>
                                    <div>cursor: {settings["term:cursor"] ?? "unset"}</div>
                                    <div>blink: {String(settings["term:cursorblink"] ?? false)}</div>
                                    <div>scrollback: {settings["term:scrollback"] ?? "unset"}</div>
                                </div>
                            </div>
                        </div>
                    </ConfigSection>

                    <ConfigSection title="JSON output" description="The sample editor keeps a sparse settings object, so cleared values are removed from the output.">
                        <pre className="max-h-[720px] overflow-auto rounded-lg border border-border bg-panel p-4 text-xs text-foreground">
                            {previewJson}
                        </pre>
                    </ConfigSection>
                </div>
            </div>
        </div>
    );
}
